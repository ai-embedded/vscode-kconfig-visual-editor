// Copyright 2025 Kconfig VSCode Extension Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as fs from "fs";
import * as path from "path";
import { glob, hasMagic } from "glob";
import { Menu, menuType } from "./Menu";
import { MenuNode } from "./MenuNode";
import { ExpressionParser } from "./ExpressionParser";
import { Logger } from "../logger/logger";
import { VisibilityManager } from "./VisibilityManager";
import { formatHelpText } from "./helpTextFormatter";
import { ConcurrentFileProcessor } from "./ConcurrentFileProcessor";
// import { DependencyScanner } from "./DependencyScanner";
// import * as vscode from "vscode";

export interface KconfigParserOptions {
    workspaceFolder: string;
    mainKconfigFile: string;
}

/**
 * KconfigParser - Refactored version using MenuNode tree structure.
 * 
 * This implementation matches Kconfiglib's behavior:
 * 1. Builds a complete node tree including if nodes
 * 2. Flattens nodes without prompts (structural flattening)
 * 3. Removes if nodes after flattening
 * 4. Creates implicit submenus based on dependencies
 * 5. Calculates indentation dynamically through parent chain
 */
export class KconfigParser {
    private static readonly SOURCE_PREFETCH_BATCH_SIZE = 16;
    private static readonly SOURCE_PREFETCH_MAX_DEPTH = 2;

    private workspaceFolder: string;
    private mainKconfigFile: string;
    private currentId: number = 0;
    private visibilityManager: VisibilityManager;
    private exprParser: ExpressionParser;
    private variables: Map<string, { value: string; isRecursive: boolean }> = new Map();
    private srctreeRoot: string;

    // Performance optimization: File caching
    private fileContentCache: Map<string, string[]> = new Map();
    private expandedVariableCache: Map<string, string> = new Map();
    private allParsedFiles: Set<string> = new Set();
    private dependencyExprCache: Map<string, ReturnType<ExpressionParser["parse"]>> = new Map();
    private scheduledPrefetchFiles: Set<string> = new Set();
    private prefetchTasks: Set<Promise<void>> = new Set();
    private sourcePrefetchQueue: Array<{ filePath: string; depth: number }> = [];
    private sourcePrefetchWorkerRunning = false;
    private allowBackgroundPrefetch = false;
    
    // Performance optimization: Concurrent file processor
    private concurrentProcessor: ConcurrentFileProcessor;
    
    // File opening tracking
    private fileOpenCounter: number = 0;
    private openedFilesList: Array<{index: number, file: string, directive: string, time: Date}> = [];
    private activeParsingFiles: Set<string> = new Set();

    /**
     * Static factory method to create a fully initialized parser
     */
    public static async create(options: KconfigParserOptions): Promise<KconfigParser> {
        const parser = new KconfigParser(options);
        return parser;
    }

    constructor(options: KconfigParserOptions) {
        this.workspaceFolder = options.workspaceFolder;
        this.mainKconfigFile = options.mainKconfigFile;
        this.visibilityManager = new VisibilityManager();
        this.exprParser = new ExpressionParser();

        // Initialize concurrent file processor
        this.concurrentProcessor = new ConcurrentFileProcessor(32);

        const srctreeEnv = process.env.srctree || process.env.SRCTREE;
        if (srctreeEnv) {
            this.srctreeRoot = path.isAbsolute(srctreeEnv)
                ? srctreeEnv
                : path.resolve(this.workspaceFolder, srctreeEnv);
        } else {
            this.srctreeRoot = path.dirname(this.mainKconfigFile);
        }
    }

    /**
     * Get the visibility manager instance
     */
    public getVisibilityManager(): VisibilityManager {
        return this.visibilityManager;
    }

    public getParsedFiles(): string[] {
        return Array.from(this.allParsedFiles);
    }

    /**
     * Main parse method - builds tree and converts to Menu array
     */
    public async parse(): Promise<Menu[]> {
        Logger.info(() => `Starting Kconfig parsing from: ${this.mainKconfigFile}`);
        const _startTime = Date.now();
        const normalizedMain = path.normalize(this.mainKconfigFile);
        this.activeParsingFiles.clear();
        this.activeParsingFiles.add(normalizedMain);
        this.allParsedFiles.clear();
        this.allParsedFiles.add(normalizedMain);
        this.dependencyExprCache.clear();
        this.scheduledPrefetchFiles.clear();
        this.prefetchTasks.clear();
        this.sourcePrefetchQueue = [];
        this.sourcePrefetchWorkerRunning = false;
        this.allowBackgroundPrefetch = true;
        
        try {
            // Step 1: Build complete node tree (including if nodes)
            const root = await this.buildNodeTree(this.mainKconfigFile);
            Logger.debugParser('After buildNodeTree - structure built');

            // Step 2: Build select relationships to identify which configs are selected
            // This must be done before flattening to preserve the select information
            this.buildSelectRelationshipsInTree(root);
            Logger.debugParser('After buildSelectRelationshipsInTree - relationships built');

            // Step 3: Flatten nodes without prompts (structural operation)
            // But preserve nodes that are selected even if they have no prompt
            this.flatten(root);
            Logger.debugParser('After flatten - structure flattened');

            // Step 4: Remove if nodes (already flattened)
            this.removeIfs(root);
            Logger.debugParser('After removeIfs - conditional nodes processed');

            // Step 5: Propagate menu 'visible if' and 'depends on'
            this.propagateMenuConditions(root);
            Logger.debugParser('After propagateMenuConditions - menu conditions propagated');

            // Step 6: Create implicit submenus based on dependencies
            this.createImplicitMenus(root);
            Logger.debugParser('After createImplicitMenus - implicit menus created');
            
            // Step 7: Convert to Menu array with dynamic indent calculation
            const menus = this.convertToMenuArray(root);
            
            // Step 8: Build reverse select relationships in Menu array
            this.buildSelectRelationships(menus);
            
            const _endTime = Date.now();
            Logger.info(() => `Parsing completed in ${_endTime - _startTime}ms`);
            Logger.info(() => `Total menus parsed: ${menus.length}`);
            
            return menus;
        } catch (error) {
            Logger.error(`Error parsing Kconfig: ${error}`);
            throw error;
        } finally {
            this.allowBackgroundPrefetch = false;
            this.sourcePrefetchQueue = [];
            this.activeParsingFiles.clear();
        }
    }

    /**
     * Build a complete node tree from Kconfig files.
     * This creates MenuNode objects including if nodes.
     */
    private async buildNodeTree(filepath: string): Promise<MenuNode> {
        const root = new MenuNode();
        root.is_menuconfig = true; // Root is treated as menuconfig
        root.node_type = 'menuconfig';
        
        // Read and parse the main file
        const lines = await this.readFile(filepath);
        await this.parseLines(lines, root, filepath);
        
        return root;
    }

    /**
     * Parse lines and build node tree
     */
    private async parseLines(
        lines: string[], 
        parent: MenuNode, 
        currentFile: string,
        startIndex: number = 0,
        endToken: string | null = null
    ): Promise<number> {
        let i = startIndex;
        while (i < lines.length) {
            const line = lines[i].trim();
            
            
            // Skip empty lines and comments
            if (!line || line.startsWith('#')) {
                i++;
                continue;
            }
            // Check for end token
            // Note: endmenu/endif/endchoice might have comments after them
            if (endToken && (line === endToken || line.startsWith(endToken + ' ') || line.startsWith(endToken + '\t'))) {
                Logger.debugParser(`Found endToken '${endToken}' at line ${i} (current file: ${currentFile}), returning ${i + 1}`);
                return i + 1;
            }
            
            // Handle variable assignments (e.g., RTT_DIR := ../../..)
            const assignmentMatch = line.match(/^([A-Za-z0-9_]+)\s*(?::=|\+=|=)\s*(.*)$/);
            if (assignmentMatch) {
                const [, varName, rawValue] = assignmentMatch;
                const operator = line.includes(':=') ? ':='
                    : line.includes('+=') ? '+='
                    : '=';
                let value = rawValue.trim();

                if (operator === '+=') {
                    const existing = this.variables.get(varName);
                    const separator = existing && existing.value && !existing.value.endsWith(' ') ? ' ' : '';
                    const appended = existing ? `${existing.value}${separator}${value}` : value;
                    this.variables.set(varName, {
                        value: appended,
                        isRecursive: existing ? existing.isRecursive : true,
                    });
                    Logger.debugParser(`Append variable: ${varName} += ${value} -> ${appended}`);
                } else {
                    if (operator === ':=') {
                        value = this.expandKconfigString(value);
                    }
                    this.variables.set(varName, {
                        value,
                        isRecursive: operator === '=',
                    });
                    Logger.debugParser(`Set variable: ${varName} ${operator} ${value}`);
                }

                i++;
                continue;
            }

            // Handle menu-level properties: 'visible if' and 'depends on'
            // Only valid when we're inside a 'menu' block
            if (parent.node_type === 'menu') {
                if (line.startsWith('visible if ')) {
                    const cond = line.substring('visible if '.length).trim();
                    if (parent.visibility) {
                        // add parentheses if needed for OR precedence
                        parent.visibility = this.andExpr(parent.visibility, cond);
                    } else {
                        parent.visibility = cond;
                    }
                    i++;
                    continue;
                }
                if (line.startsWith('depends on ')) {
                    const dep = line.substring('depends on '.length).trim();
                    if (parent.dep) {
                        parent.dep = this.andExpr(parent.dep, dep);
                    } else {
                        parent.dep = dep;
                    }
                    // 同步写入 Menu（容器）自身的 dependsOn，便于可见性评估
                    if (parent.item) {
                        const combined = this.andExpr(parent.dep, parent.visibility || undefined) || parent.dep || '';
                        parent.item.dependsOn = combined;
                    }
                    i++;
                    continue;
                }
            }
            
            // Handle mainmenu statement
            if (line.startsWith('mainmenu ')) {
                const title = this.extractQuotedString(line.substring(9));
                Logger.debugParser(`Found mainmenu: "${title}"`);
                
                // Set the root node's title
                if (!parent.prompt) {
                    parent.prompt = [title, 'y'];
                    parent.item = this.createMenu({
                        name: '',
                        title: title,
                        type: menuType.menu,
                        isMenuconfig: false,  // FIX: mainmenu is NOT a menuconfig, just a title container
                        isVisible: true,
                        hasPrompt: true,
                        isMainMenu: true,
                    });
                    Logger.debugParser(`Created mainmenu item: title="${title}", type=menu, isMenuconfig=false, isVisible=true`);
                }
                i++;
                continue;
            }
            
            
            // Handle if blocks
            if (line.startsWith('if ')) {
                const condition = line.substring(3).trim();

                // Create if node
                const ifNode = new MenuNode();
                ifNode.node_type = 'if';
                ifNode.item = null; // if nodes have no item
                ifNode.prompt = null; // if nodes have no prompt
                ifNode.dep = condition;
                ifNode.parent = parent;
                ifNode.filename = currentFile;
                ifNode.linenr = i + 1;

                parent.addChild(ifNode);

                // Parse if block contents recursively
                const nextIndex = await this.parseLines(lines, ifNode, currentFile, i + 1, 'endif');
                i = nextIndex;
                continue;
            }
            
            // Handle menu blocks
            if (line.startsWith('menu ')) {
                const title = this.extractQuotedString(line.substring(5));

                const menuNode = new MenuNode();
                menuNode.node_type = 'menu';
                menuNode.is_menuconfig = false;  // FIX: menu is NOT menuconfig!
                menuNode.prompt = [title, 'y'];
                menuNode.filename = currentFile;
                menuNode.linenr = i + 1;

                // Create associated Menu object
                menuNode.item = this.createMenu({
                    name: '',
                    title: title,
                    type: menuType.menu,
                    isMenuconfig: false,  // FIX: menu should have isMenuconfig = false
                    isVisible: true,  // Menu nodes should always be visible
                    hasPrompt: true,  // Menu nodes have a title, so they have a prompt
                });

                parent.addChild(menuNode);

                // Parse menu contents
                i = await this.parseLines(lines, menuNode, currentFile, i + 1, 'endmenu');
                continue;
            }

            // Handle comment entries
            if (line.startsWith('comment ')) {
                const commentNode = await this.parseComment(lines, i, currentFile);
                if (commentNode) {
                    parent.addChild(commentNode);
                    i = commentNode.nextIndex || i + 1;
                } else {
                    i++;
                }
                continue;
            }
            
            // Handle choice blocks
            if (line.startsWith('choice')) {
                // Extract choice name if present (e.g., "choice BSP_ROOTFS_TYPE" vs just "choice")
                const choiceName = line.trim() === 'choice' ? null : line.substring(6).trim();
                const choiceNode = await this.parseChoice(lines, i, currentFile, choiceName);
                if (choiceNode) {
                    parent.addChild(choiceNode);
                    i = choiceNode.nextIndex || i + 1;
                } else {
                    i++;
                }
                continue;
            }
            
            // Handle config/menuconfig
            if (line.startsWith('config ') || line.startsWith('menuconfig ')) {
////console.log(`parseLines: Found config at line ${i}: '${line}'`);
                const configNode = await this.parseConfig(lines, i, currentFile);
                if (configNode) {
                    parent.addChild(configNode);
////console.log(`parseLines: parseConfig returned, next index is ${configNode.nextIndex}`);
                    i = configNode.nextIndex || i + 1;
                } else {
                    i++;
                }
                continue;
            }
            
            // Handle source/rsource/osource/orsource directives
            if (line.startsWith('source ') || line.startsWith('rsource ') ||
                line.startsWith('osource ') || line.startsWith('orsource ')) {
                const sourceResult = await this.parseSource(line, currentFile);
                if (sourceResult) {
                    const sourceFiles = this.deduplicateSourceFiles(sourceResult.files);
                    await this.preloadSourceFiles(sourceFiles, line);
////console.log(`[parseLines] Loading ${sourceFiles.length} file(s) from source directive`);
                    for (const sourceFile of sourceFiles) {
                        const normalizedSource = path.normalize(sourceFile);
                        if (this.activeParsingFiles.has(normalizedSource)) {
                            Logger.warn(`Detected recursive source include, skipping: ${normalizedSource}`);
                            continue;
                        }
                        this.fileOpenCounter++;
                        this.openedFilesList.push({
                            index: this.fileOpenCounter,
                            file: normalizedSource,
                            directive: line,
                            time: new Date(),
                        });
                        this.allParsedFiles.add(normalizedSource);
////console.log(`[parseLines] Loading source file: ${normalizedSource}`);
                        const sourceLines = await this.readFile(normalizedSource);
////console.log(`[parseLines] Read ${sourceLines.length} lines from ${normalizedSource}`);
                        if (sourceLines.length === 0) {
                            if (!sourceResult.optional) {
                                Logger.warn(`Source file not found or empty: ${normalizedSource}`);
                            }
                            continue;
                        }
                        this.activeParsingFiles.add(normalizedSource);
                        try {
                            await this.parseLines(sourceLines, parent, normalizedSource);
                        } finally {
                            this.activeParsingFiles.delete(normalizedSource);
                        }
                    }
                } else {
                    Logger.warn(`Source directive failed: ${line}`);
                }
                i++;
                continue;
            }
            
            i++;
        }
        
        return i;
    }

    /**
     * Parse a config or menuconfig item
     */
    private async parseConfig(lines: string[], startIndex: number, currentFile: string): Promise<MenuNode | null> {
        const firstLine = lines[startIndex].trim();
        const isMenuconfig = firstLine.startsWith('menuconfig ');
        const match = firstLine.match(/^(?:menu)?config\s+([A-Z0-9_]+)/);
        
        if (!match) {
            return null;
        }
        
        const _configName = match[1];
        
        // Debug log for config/menuconfig parsing
        if (isMenuconfig) {
////console.log('[MENUCONFIG_PARSER_DEBUG] ========================================');
////console.log('[MENUCONFIG_PARSER_DEBUG] Found menuconfig at line', startIndex + 1, 'in file:', currentFile);
////console.log('[MENUCONFIG_PARSER_DEBUG] Name:', configName);
////console.log('[MENUCONFIG_PARSER_DEBUG] Type: menuconfig (with checkbox!)');
////console.log('[MENUCONFIG_PARSER_DEBUG] ========================================');
        }
        
        const node = new MenuNode();
        node.node_type = isMenuconfig ? 'menuconfig' : 'config';
        node.is_menuconfig = isMenuconfig;
        node.filename = currentFile;
        node.linenr = startIndex + 1;

        // Create associated Menu object
        const menu: Menu = this.createMenu({
            name: _configName,
            title: '',
            type: menuType.bool, // Default, will be updated
            isMenuconfig: isMenuconfig,
            linenr: startIndex + 1,
        });
        
        node.item = menu;
        
        // Parse config properties
        let i = startIndex + 1;
        let hasPrompt = false;
        
        while (i < lines.length) {
            const line = lines[i].trim();
            
            
            if (!line || line.startsWith('#')) {
                i++;
                continue;
            }
            
            // Check for new top-level statement
            // We break on new config/menu/choice/if statements
            // and also on source directives. This is critical because
            // rsource/source/osource/orsource must be handled by the
            // outer parseLines() loop instead of being consumed inside
            // a config block. Otherwise files like components/libc/Kconfig
            // that contain rsource "posix/Kconfig" within a menu would be
            // swallowed by the preceding config parser and never loaded,
            // causing select relationships (e.g. RT_USING_POSIX_FS ->
            // DFS_USING_POSIX) to be missing.
            // Note: choice can be standalone (anonymous) or have a name.
            if (
                line.match(/^(config|menuconfig|menu|if|comment)\s/) ||
                line === 'choice' ||
                line.startsWith('choice ') ||
                line.startsWith('source ') ||
                line.startsWith('rsource ') ||
                line.startsWith('osource ') ||
                line.startsWith('orsource ')
            ) {
                Logger.debugParser(`[CONFIG_PARSER] Breaking at top-level directive within config ${_configName}: '${line}'`);
                break;
            }
            
            // Break on end tokens that belong to parent scopes
            // We need to leave these for the parent parseLines to handle
            // Note: end tokens might have comments after them
            if (line === 'endif' || line === 'endmenu' || line === 'endchoice' ||
                line.startsWith('endif ') || line.startsWith('endmenu ') || line.startsWith('endchoice ')) {
                break;
            }
            
            // Parse type and prompt
            const typeMatch = line.match(/^(bool|tristate|string|int|hex)(?:\s+(.*))?$/);
            if (typeMatch) {
                const [, typeKeyword, rest] = typeMatch;
                menu.type = typeKeyword as menuType;

                if (rest) {
                    const promptMatch = rest.match(/"([^"]+)"/);
                    if (promptMatch) {
                        menu.title = promptMatch[1];
                        const firstQuote = rest.indexOf('"');
                        const secondQuote = rest.indexOf('"', firstQuote + 1);
                        let cond = 'y';
                        if (secondQuote !== -1) {
                            const after = rest.substring(secondQuote + 1).trim();
                            if (after.startsWith('if ')) {
                                cond = after.substring(3).trim();
                            }
                        }
                        node.prompt = [promptMatch[1], cond];
                        hasPrompt = true;
                    }
                }
                i++;
                continue;
            }
            
            // Parse depends on
            if (line.startsWith('depends on ')) {
                const dep = line.substring(11).trim();
                // Store explicit depends on separately
                if (node.explicit_dep) {
                    node.explicit_dep = `(${node.explicit_dep}) && (${dep})`;
                } else {
                    node.explicit_dep = dep;
                }
                // Also add to general dependencies
                if (node.dep) {
                    node.dep = `(${node.dep}) && (${dep})`;
                } else {
                    node.dep = dep;
                }
                menu.dependsOn = node.dep;
            }

            const defBoolMatch = line.match(/^def_bool\s+(.+)$/);
            if (defBoolMatch) {
                const defLine = defBoolMatch[1].trim();
                const ifIndex = defLine.indexOf(' if ');
                let defaultValue: string;
                let condition: string | undefined;

                if (ifIndex > -1) {
                    defaultValue = defLine.substring(0, ifIndex).trim();
                    condition = defLine.substring(ifIndex + 4).trim();
                    Logger.debugParser(`[DEFAULT_PARSER] ${_configName} -> def_bool "${defaultValue}" if ${condition}`);
                } else {
                    defaultValue = defLine.trim();
                    Logger.debugParser(`[DEFAULT_PARSER] ${_configName} -> def_bool "${defaultValue}"`);
                }

                defaultValue = this.expandDefaultValue(defaultValue);

                menu.type = menuType.bool;
                if (!menu.defaults) {
                    menu.defaults = [];
                }
                menu.defaults.push({ value: defaultValue, condition });
                i++;
                continue;
            }
            
            // Parse default value (support: default VALUE [if CONDITION])
            if (line.startsWith('default ')) {
                const defaultLine = line.substring(8).trim();
                const ifIndex = defaultLine.indexOf(' if ');
                let defaultValue: string;
                let condition: string | undefined;

                if (ifIndex > -1) {
                    defaultValue = defaultLine.substring(0, ifIndex).trim();
                    condition = defaultLine.substring(ifIndex + 4).trim();
                    Logger.debugParser(`[DEFAULT_PARSER] ${_configName} -> default "${defaultValue}" if ${condition}`);
                } else {
                    defaultValue = defaultLine.trim();
                    Logger.debugParser(`[DEFAULT_PARSER] ${_configName} -> default "${defaultValue}"`);
                }

                defaultValue = this.expandDefaultValue(defaultValue);

                // 收集到 defaults 列表，按照出现顺序保存（Kconfig 语义为最后一个命中的 default 生效）
                if (!menu.defaults) {
                    menu.defaults = [];
                }
                menu.defaults.push({ value: defaultValue, condition });
            }

            if (line.startsWith('option ')) {
                const optionContent = line.substring(7).trim();
                if (optionContent.startsWith('env')) {
                    const envMatch = optionContent.match(/env\s*=\s*"?([A-Za-z0-9_]+)"?/);
                    if (envMatch) {
                        menu.optionEnvVar = envMatch[1];
                        Logger.debugParser(`[OPTION_PARSER] ${_configName} -> option env="${menu.optionEnvVar}"`);
                    }
                } else if (optionContent === 'defconfig_list') {
                    menu.optionDefconfigList = true;
                    Logger.debugParser(`[OPTION_PARSER] ${_configName} marked as defconfig_list`);
                } else if (optionContent === 'modules') {
                    menu.optionModules = true;
                    Logger.debugParser(`[OPTION_PARSER] ${_configName} marked as modules symbol`);
                }
                i++;
                continue;
            }

            // Parse select statements
            if (line.startsWith('select ')) {
                // 支持：select TARGET [if COND]
                const raw = line.substring(7).trim();
                let selectTarget = raw;
                let cond: string | undefined;
                const ifIdx = raw.indexOf(' if ');
                if (ifIdx > -1) {
                    selectTarget = raw.substring(0, ifIdx).trim();
                    cond = raw.substring(ifIdx + 4).trim();
                }
                if (!menu.select) {
                    menu.select = [];
                }
                menu.select.push(selectTarget);
                if (cond) {
                    if (!menu.selectConditions) menu.selectConditions = {};
                    menu.selectConditions[selectTarget] = cond;
                }
                if (!node.item) {
                    Logger.error(`[SELECT_PARSE] ERROR: node.item is null for ${_configName}`);
                }
            }

            if (line.startsWith('imply ')) {
                const raw = line.substring(6).trim();
                let target = raw;
                let cond: string | undefined;
                const ifIdx = raw.indexOf(' if ');
                if (ifIdx > -1) {
                    target = raw.substring(0, ifIdx).trim();
                    cond = raw.substring(ifIdx + 4).trim();
                }
                if (!menu.implies) {
                    menu.implies = [];
                }
                menu.implies.push(target);
                if (cond) {
                    if (!menu.implyConditions) {
                        menu.implyConditions = {};
                    }
                    menu.implyConditions[target] = cond;
                }
                Logger.debugParser(`[IMPLY_PARSER] ${_configName} implies ${target}${cond ? ` if ${cond}` : ''}`);
                i++;
                continue;
            }

            // Parse range
            if (line.startsWith('range ')) {
                const rangeMatch = line.match(/range\s+(\d+)\s+(\d+)/);
                if (rangeMatch) {
                    menu.range = [parseInt(rangeMatch[1]), parseInt(rangeMatch[2])];
                }
            }
            
            // Parse help text
            if (line.startsWith('help') || line.startsWith('---help---')) {
                const helpLines: string[] = [];
                i++;
                
                // Find the first non-blank line to determine base indentation
                let baseIndent = -1;
                while (i < lines.length) {
                    const helpLine = lines[i];
                    if (helpLine.trim()) {
                        // Found non-blank line, measure its indentation
                        baseIndent = helpLine.length - helpLine.trimStart().length;
                        helpLines.push(helpLine);
                        i++;
                        break;
                    }
                    // Skip blank lines at the start of help
                    i++;
                }
                
                // If we found a base indentation, continue reading help text
                if (baseIndent >= 0) {
                    while (i < lines.length) {
                        const helpLine = lines[i];
                        // Empty lines are part of help text
                        if (!helpLine.trim()) {
                            helpLines.push(helpLine);
                            i++;
                            continue;
                        }
                        // Check indentation level
                        const currentIndent = helpLine.length - helpLine.trimStart().length;
                        if (currentIndent < baseIndent) {
                            // Less indented line found - end of help text
                            break;
                        }
                        helpLines.push(helpLine);
                        i++;
                    }
                }
                
                menu.help = formatHelpText(helpLines.join('\n').trim());
                // Don't increment i here - we want to process the less-indented line next
                continue;
            }
            
            i++;
        }
        
        // Set visibility
        menu.hasPrompt = hasPrompt;
        if (node.dep && !menu.dependsOn) {
            menu.dependsOn = node.dep;
        }
        // For menuconfig nodes, they should always be visible as they are menu items
        // For regular config nodes, visibility depends on having a prompt
        menu.isVisible = isMenuconfig ? true : hasPrompt;
        
        node.nextIndex = i;
        return node;
    }

    /**
     * Parse a comment entry.
     * Supports:
     *   comment "text" [if CONDITION]
     *   depends on CONDITION
     */
    private async parseComment(lines: string[], startIndex: number, currentFile: string): Promise<MenuNode | null> {
        const firstLine = lines[startIndex].trim();
        if (!firstLine.startsWith("comment ")) {
            return null;
        }

        const title = this.extractQuotedString(firstLine.substring("comment ".length));

        const node = new MenuNode();
        node.node_type = "comment";
        node.is_menuconfig = false;
        node.filename = currentFile;
        node.linenr = startIndex + 1;

        const menu: Menu = this.createMenu({
            name: "",
            title,
            prompt: title,
            type: menuType.comment,
            isMenuconfig: false,
            hasPrompt: true,
            isVisible: true,
            linenr: startIndex + 1,
        });
        node.item = menu;

        const firstQuote = firstLine.indexOf('"');
        const secondQuote = firstLine.indexOf('"', firstQuote + 1);
        let promptCond = "y";
        if (secondQuote !== -1) {
            const after = firstLine.substring(secondQuote + 1).trim();
            if (after.startsWith("if ")) {
                promptCond = after.substring(3).trim();
            }
        }
        node.prompt = [title, promptCond];
        if (promptCond !== "y") {
            node.dep = promptCond;
            menu.dependsOn = promptCond;
        }

        let i = startIndex + 1;
        while (i < lines.length) {
            const line = lines[i].trim();

            if (!line || line.startsWith("#")) {
                i++;
                continue;
            }

            if (
                line.match(/^(config|menuconfig|menu|if|comment)\s/) ||
                line === "choice" ||
                line.startsWith("choice ") ||
                line.startsWith("source ") ||
                line.startsWith("rsource ") ||
                line.startsWith("osource ") ||
                line.startsWith("orsource ")
            ) {
                break;
            }

            if (
                line === "endif" ||
                line === "endmenu" ||
                line === "endchoice" ||
                line.startsWith("endif ") ||
                line.startsWith("endmenu ") ||
                line.startsWith("endchoice ")
            ) {
                break;
            }

            if (line.startsWith("depends on ")) {
                const dep = line.substring("depends on ".length).trim();
                node.dep = this.andExpr(node.dep, dep) ?? dep;
                menu.dependsOn = node.dep || "";
                i++;
                continue;
            }

            i++;
        }

        node.nextIndex = i;
        return node;
    }

    /**
     * Parse a choice block
     */
    private async parseChoice(lines: string[], startIndex: number, currentFile: string, choiceName?: string | null): Promise<MenuNode | null> {
        const node = new MenuNode();
        node.node_type = 'choice';
        node.is_menuconfig = true; // Choices act like menuconfigs
        node.filename = currentFile;
        node.linenr = startIndex + 1;
        
        // Create associated Menu object
        // Use the provided choice name if available, otherwise generate one
        const menu: Menu = this.createMenu({
            name: choiceName || `choice_${this.currentId++}`,
            title: 'Choice', // Default title, will be updated if prompt is found
            type: menuType.choice,
            isMenuconfig: true,
        });
        
        // Debug logging for choice parsing
////console.log('[CHOICE_PARSER_DEBUG] ========================================');
////console.log('[CHOICE_PARSER_DEBUG] Found choice at line', startIndex + 1, 'in file:', currentFile);
////console.log('[CHOICE_PARSER_DEBUG] Choice name:', choiceName || '(anonymous)');
////console.log('[CHOICE_PARSER_DEBUG] Menu name:', menu.name);
////console.log('[CHOICE_PARSER_DEBUG] Menu type:', menu.type);
////console.log('[CHOICE_PARSER_DEBUG] isMenuconfig:', menu.isMenuconfig);
////console.log('[CHOICE_PARSER_DEBUG] ========================================');
        
        node.item = menu;
        
        // Parse choice block
        let i = startIndex + 1;
        let hasPrompt = false;
        
        while (i < lines.length) {
            const line = lines[i].trim();
            
            if (line === 'endchoice') {
                node.nextIndex = i + 1;
                break;
            }
            
            if (!line || line.startsWith('#')) {
                i++;
                continue;
            }
            
            // Parse prompt
            if (line.startsWith('prompt ')) {
                const promptMatch = line.match(/prompt\s+"([^"]+)"/);
                if (promptMatch) {
////console.log(`[CHOICE_PARSER_DEBUG] Found prompt: "${promptMatch[1]}"`);
                    menu.title = promptMatch[1];
                    // 解析 prompt 行上的 if 条件
                    const firstQuote = line.indexOf('"');
                    const secondQuote = line.indexOf('"', firstQuote + 1);
                    let cond = 'y';
                    if (secondQuote !== -1) {
                        const after = line.substring(secondQuote + 1).trim();
                        if (after.startsWith('if ')) {
                            cond = after.substring(3).trim();
                        }
                    }
                    node.prompt = [promptMatch[1], cond];
                    hasPrompt = true;
                }
                i++;
                continue;
            }
            // Parse depends on
            if (line.startsWith('depends on ')) {
                const dep = line.substring('depends on '.length).trim();
                node.dep = this.andExpr(node.dep, dep) ?? dep;
                menu.dependsOn = node.dep || '';
                i++;
                continue;
            }

            // Parse default (support "default VALUE [if CONDITION]")
            if (line.startsWith('default ')) {
                const defaultLine = line.substring(8).trim();
                const ifIndex = defaultLine.indexOf(' if ');
                let defaultValue: string;
                let condition: string | undefined;

                if (ifIndex > -1) {
                    defaultValue = defaultLine.substring(0, ifIndex).trim();
                    condition = defaultLine.substring(ifIndex + 4).trim();
                } else {
                    defaultValue = defaultLine.trim();
                }

                // 收集 choice 的默认值列表，保留顺序（与 Kconfig 语义一致，后匹配覆盖先匹配）
                if (!menu.defaults) {
                    menu.defaults = [];
                }
                menu.defaults.push({ value: defaultValue, condition });

                // 不在解析阶段确定最终默认值，交由可见性管理器按语义（最后一个命中的 default 生效）评估

                i++;
                continue;
            }
            
            // Parse choice options (config items within choice)
            if (line.startsWith('config ')) {
                const optionNode = await this.parseConfig(lines, i, currentFile);
                if (optionNode) {
                    node.addChild(optionNode);
                    i = optionNode.nextIndex || i + 1;
                } else {
                    i++;
                }
                continue;
            }

            if (line.startsWith('comment ')) {
                const commentNode = await this.parseComment(lines, i, currentFile);
                if (commentNode) {
                    node.addChild(commentNode);
                    i = commentNode.nextIndex || i + 1;
                } else {
                    i++;
                }
                continue;
            }
            
            i++;
        }
        
        if (node.dep) {
            menu.dependsOn = node.dep;
        }

        menu.hasPrompt = hasPrompt;
        // Choice blocks should always be visible as they are selection elements
        menu.isVisible = true;
        
        // Final debug logging
////console.log('[CHOICE_PARSER_DEBUG] Final choice state:');
////console.log(`[CHOICE_PARSER_DEBUG]   - name: "${menu.name}"`);
////console.log(`[CHOICE_PARSER_DEBUG]   - title: "${menu.title}"`);
////console.log(`[CHOICE_PARSER_DEBUG]   - hasPrompt: ${menu.hasPrompt}`);
////console.log(`[CHOICE_PARSER_DEBUG]   - isVisible: ${menu.isVisible}`);
////console.log(`[CHOICE_PARSER_DEBUG]   - isMenuconfig: ${menu.isMenuconfig}`);
////console.log(`[CHOICE_PARSER_DEBUG]   - type: ${menu.type}`);
////console.log('[CHOICE_PARSER_DEBUG] ========================================');
        
        return node;
    }

    // 注意：if 节点仅用于依赖传播，不应引入额外缩进层级。

    /**
     * Flatten nodes without prompts (structural flattening).
     * This matches Kconfiglib's _flatten function.
     */
    private flatten(node: MenuNode): void {
        // Use two-pass approach to avoid modifying the list while traversing
        const nodesToFlatten: MenuNode[] = [];
        
        // First pass: Recursively process all children and collect nodes to flatten
        let current = node.list;
        while (current) {
            // Recursively flatten children first
            if (current.list) {
                this.flatten(current);
            }
            
            // Collect nodes that need flattening
            if (current.shouldFlatten()) {
                nodesToFlatten.push(current);
            }
            
            current = current.next;
        }
        
        // Second pass: Flatten the collected nodes
        for (const nodeToFlatten of nodesToFlatten) {
            this.flattenNode(nodeToFlatten);
        }
    }
    
    /**
     * Flatten a single node by promoting its children to the parent level.
     * Updates dependencies and reconnects the node chain.
     * IMPORTANT: Preserves if block indentation levels for correct display.
     */
    private flattenNode(nodeToFlatten: MenuNode): void {
        if (!nodeToFlatten.list || !nodeToFlatten.parent) {
            return;
        }

        const parent = nodeToFlatten.parent;
        const firstChild = nodeToFlatten.list;

        // Update all children
        let child: MenuNode | null = firstChild;
        let lastChild: MenuNode = firstChild;
        while (child) {
            // Update parent pointer
            child.parent = parent;

            // Handle dependency merging based on the type of node being flattened
            if (nodeToFlatten.dep) {
                if (nodeToFlatten.isIfNode()) {
                    // If 节点：仅传播依赖，不产生额外缩进
                    // Store if dependency separately
                    if (child.if_dep) {
                        // Merge with existing if_dep
                        if (child.if_dep.includes('||') || nodeToFlatten.dep.includes('||')) {
                            child.if_dep = `(${child.if_dep}) && (${nodeToFlatten.dep})`;
                        } else {
                            child.if_dep = `${child.if_dep} && ${nodeToFlatten.dep}`;
                        }
                    } else {
                        child.if_dep = nodeToFlatten.dep;
                    }

                    // Also update general dep for visibility calculations
                    if (child.dep) {
                        if (child.dep.includes('||') || nodeToFlatten.dep.includes('||')) {
                            child.dep = `(${child.dep}) && (${nodeToFlatten.dep})`;
                        } else {
                            child.dep = `${child.dep} && ${nodeToFlatten.dep}`;
                        }
                    } else {
                        child.dep = nodeToFlatten.dep;
                    }

                    // 不递归增加任何 if 缩进层级
                } else {
                    // Non-if node flattening (rare case)
                    Logger.debugParser(`[FLATTEN_NON_IF] Flattening non-if node, merging dep: ${nodeToFlatten.dep}`);

                    // Merge dependency conditions normally
                    if (child.dep) {
                        // Only add parentheses when necessary (e.g., when there are OR operations)
                        if (child.dep.includes('||') || nodeToFlatten.dep.includes('||')) {
                            child.dep = `(${child.dep}) && (${nodeToFlatten.dep})`;
                        } else {
                            child.dep = `${child.dep} && ${nodeToFlatten.dep}`;
                        }
                    } else {
                        child.dep = nodeToFlatten.dep;
                    }
                }

                // Update Menu object's dependsOn
                if (child.item) {
                    child.item.dependsOn = child.dep;
                    Logger.debugParser(`[FLATTEN] Updated menu "${child.item.title || child.item.name}" dependsOn to: ${child.dep}`);
                }
            }

            lastChild = child;
            child = child.next;
        }

        // Reconnect the node chain
        if (parent.list === nodeToFlatten) {
            // nodeToFlatten is the first child of parent
            parent.list = firstChild;
        } else {
            // Find the previous sibling
            let prev = parent.list;
            while (prev && prev.next !== nodeToFlatten) {
                prev = prev.next;
            }
            if (prev) {
                prev.next = firstChild;
            }
        }
        
        // Connect the last child to nodeToFlatten's next sibling
        lastChild.next = nodeToFlatten.next;
        
        // Clear the flattened node
        nodeToFlatten.list = null;
        nodeToFlatten.next = null;
    }

    /**
     * Remove if nodes after flattening.
     * This matches Kconfiglib's _remove_ifs function.
     */
    private removeIfs(node: MenuNode): void {
        // First, recursively process children
        let current = node.list;
        while (current) {
            if (current.list) {
                this.removeIfs(current);
            }
            current = current.next;
        }
        
        // Now remove if nodes from this level
        let prev: MenuNode | null = null;
        current = node.list;
        
        while (current) {
            const next = current.next;
            
            if (current.isIfNode()) {
                // Remove this if node from the chain
                if (prev) {
                    prev.next = next;
                } else {
                    node.list = next;
                }
            } else {
                prev = current;
            }
            
            current = next;
        }
    }

    /**
     * Propagate menu-level 'visible if' and 'depends on' to children.
     * - 'visible if' only influences prompts of symbols/choices (AND in)
     * - 'depends on' is propagated to child.dep and also AND into child prompts
     * This mirrors Kconfiglib's _propagate_deps + visible_if propagation.
     */
    private propagateMenuConditions(root: MenuNode): void {
        const rec = (node: MenuNode, inheritedVisible?: string | null): void => {
            // Accumulate visible-if from parent menus
            const curVisible = this.andExpr(inheritedVisible || undefined, node.node_type === 'menu' ? node.visibility || undefined : undefined);

            let child = node.list;
            while (child) {
                // Propagate 'depends on' from parent menu to child dep
                if (node.node_type === 'menu' && node.dep) {
                    child.dep = this.andExpr(child.dep || undefined, node.dep) || child.dep || node.dep;
                }

                const promptCond = child.prompt ? (child.prompt[1] || 'y') : 'y';
                const menuVisible = child.node_type === 'menu' ? child.visibility || undefined : undefined;
                const inheritedVisible = curVisible || undefined;

                let combinedCondition = this.andExpr(promptCond, inheritedVisible);
                combinedCondition = this.andExpr(combinedCondition || undefined, menuVisible);
                combinedCondition = this.andExpr(combinedCondition || undefined, child.dep || undefined);

                if (child.item && child.prompt) {
                    child.prompt = [child.prompt[0], combinedCondition || 'y'];
                }

                if (child.item) {
                    if (combinedCondition) {
                        child.item.dependsOn = combinedCondition;
                    } else if (!child.item.dependsOn) {
                        child.item.dependsOn = '';
                    }
                }

                const nextInherited = combinedCondition || curVisible || null;
                if (child.list) rec(child, nextInherited);
                child = child.next as MenuNode | null;
            }
        };

        rec(root, null);
    }

    /**
     * Helper: AND two expressions with safe parentheses when needed.
     */
    private andExpr(a?: string | null, b?: string | null): string | null {
        const norm = (s?: string | null) => (s && s.trim().length > 0 ? s.trim() : null);
        const A = norm(a);
        const B = norm(b);
        if (!A) return B;
        if (!B) return A;
        const wrap = (s: string) => (s.includes('||') ? `(${s})` : s);
        return `${wrap(A)} && ${wrap(B)}`;
    }

    /**
     * Create implicit submenus based on dependencies.
     * This matches Kconfiglib's implicit menu creation logic.
     * IMPORTANT: Only processes CONSECUTIVE nodes that depend on the current node.
     * This preserves the original file order (matching kconfiglib.py:_finalize_node).
     *
     * ENHANCED: Special handling for menuconfig nodes to ensure proper indentation
     * of dependent config items (e.g., items from "if MENUCONFIG" blocks).
     */
    private createImplicitMenus(node: MenuNode): void {
        Logger.debugParser(`[IMPLICIT_MENU] Processing node: ${node.toString()}`);

        // Process each child of this node
        let child = node.list;
        while (child) {
            // For each child, check if consecutive following siblings should become its children
            // This matches kconfiglib.py line 3587-3600
            if (child.item && child.item.name) {
                let cur = child;
                const dependencyOwners = new Set<string>();
                if (child.item && child.item.name) {
                    dependencyOwners.add(child.item.name);
                }

                // Check consecutive nodes that immediately follow
                while (cur.next) {
                    const nextNode = cur.next;

                    // Get the dependency to check
                    // Priority: prompt condition > general dep > explicit dep
                    let dependency: string | null = null;
                    if (nextNode.prompt) {
                        const promptCond = nextNode.prompt[1];
                        if (promptCond && promptCond !== 'y') {
                            dependency = promptCond;
                        }
                    }
                    if (!dependency) {
                        dependency = nextNode.dep || nextNode.explicit_dep || null;
                    }

                    let shouldBecomeChild = false;
                    if (dependency && dependencyOwners.size > 0) {
                        try {
                            const cacheKey = dependency.trim();
                            let expr = this.dependencyExprCache.get(cacheKey);
                            if (!expr) {
                                expr = this.exprParser.parse(cacheKey);
                                this.dependencyExprCache.set(cacheKey, expr);
                            }
                            for (const owner of dependencyOwners) {
                                if (this.exprParser.exprDependsOn(expr, owner)) {
                                    shouldBecomeChild = true;
                                    break;
                                }
                            }
                        } catch (error) {
                            Logger.warn(`[IMPLICIT_MENU] Failed to parse dependency expression "${dependency}": ${error}`);
                        }
                    }

                    if (shouldBecomeChild) {
                        if (nextNode.item && nextNode.item.name) {
                            dependencyOwners.add(nextNode.item.name);
                        }
                        cur = nextNode; // Move to next to continue checking
                    } else {
                        // Not dependent on current block, stop checking
                        break;
                    }
                }

                // If we found consecutive dependent nodes, move them under child
                if (cur !== child) {
                    // Move nodes from child.next to cur (inclusive) under child
                    const firstDependent = child.next;
                    const lastDependent = cur;
                    const afterLast = cur.next;

                    // Update parent pointers
                    let temp = firstDependent;
                    while (temp) {
                        temp.parent = child;
                        if (temp === lastDependent) break;
                        temp = temp.next;
                    }

                    // Reconnect the sibling chain
                    child.next = afterLast;

                    // Set up child's children
                    child.list = firstDependent;
                    lastDependent!.next = null;
                }
            }

            // Recursively process this child's children (including newly created implicit children)
            if (child.list) {
                this.createImplicitMenus(child);
            }

            child = child.next;
        }
    }

    /**
     * Convert node tree to Menu array with proper indentation.
     * Indentation is calculated dynamically based on parent chain.
     */
    private convertToMenuArray(root: MenuNode): Menu[] {
        const menus: Menu[] = [];
        
        // Debug: Log root node status
////console.log('\n[convertToMenuArray] Root node check:');
////console.log('  root.item exists:', !!root.item);
////console.log('  root.prompt:', root.prompt);
        if (root.item) {
////console.log('  root.item.title:', root.item.title);
////console.log('  root.item.name:', root.item.name);
        }
        
        // If root has a mainmenu (item), handle it specially
        if (root.item && root.prompt) {
////console.log('[MAINMENU_CONVERT] Creating main menu tree from root');
            const mainMenu = root.item;
            mainMenu.indentLevel = 0;
            mainMenu.children = [];
            mainMenu.isCollapsed = false;  // Mainmenu should always be expanded
            
////console.log('[MAINMENU_CONVERT] Mainmenu details:');
////console.log(`[MAINMENU_CONVERT]   - Title: "${mainMenu.title}"`);
////console.log(`[MAINMENU_CONVERT]   - Type: ${mainMenu.type}`);
////console.log(`[MAINMENU_CONVERT]   - isMenuconfig: ${mainMenu.isMenuconfig}`);
////console.log(`[MAINMENU_CONVERT]   - isVisible: ${mainMenu.isVisible}`);
            
            // Process all children of the root as children of mainmenu
            let child: MenuNode | null = root.list;
            let _childCount = 0;
            while (child) {
                if (child.item) {
////console.log(`  Processing child ${_childCount}: ${child.item.title || child.item.name}`);
                    // Special handling for top-level menu items like RT-Thread Kernel
                    // These should be collapsible menu containers, not normal config items
                    if (child.item.type === 'menu' || child.item.isMenuconfig) {
                        child.item.isCollapsed = child.item.isCollapsed ?? true; // Default to collapsed
////console.log(`    Setting ${child.item.title} as collapsible menu, isCollapsed: ${child.item.isCollapsed}`);
                    }
                    this.convertChildNode(child, mainMenu.children);
                    _childCount++;
                }
                child = child.next as MenuNode | null;
            }
            
            // Push the mainmenu itself as the top-level container with all its children
            // This will show the mainmenu title at the top of the UI
            menus.push(mainMenu);
////console.log(`[MAINMENU_CONVERT] Added mainMenu "${mainMenu.title}" to menus array as top-level container`);
////console.log(`[MAINMENU_CONVERT]   - Children count: ${mainMenu.children.length}`);
            if (mainMenu.children.length > 0) {
////console.log(`[MAINMENU_CONVERT]   - First child: ${mainMenu.children[0].title || mainMenu.children[0].name}`);
            }
        } else {
////console.log('[convertToMenuArray] No mainmenu, processing children as top-level');
            // No mainmenu, process children as top-level items
            this.convertNode(root, menus, true);
        }
        
////console.log(`[convertToMenuArray] Returning ${menus.length} menu(s)`);
        if (menus.length > 0) {
////console.log(`  First menu: name="${menus[0].name}", title="${menus[0].title}", type="${menus[0].type}", isMenuconfig="${menus[0].isMenuconfig}"`);
            if (menus[0].children) {
////console.log(`  First menu has ${menus[0].children.length} children`);
            }
        }
        
        return menus;
    }

    /**
     * Recursively convert nodes to Menu array
     */
    private convertNode(node: MenuNode, menus: Menu[], isRoot: boolean = false): void {
        // Skip the root node itself
        if (!isRoot && node.item) {
            this.convertChildNode(node, menus);
        } else if (isRoot) {
            // For root, just process its children
            let child: MenuNode | null = node.list;
            while (child) {
                this.convertNode(child, menus, false);
                child = child.next as MenuNode | null;
            }
        }
    }
    
    /**
     * Convert child nodes recursively without adding to flat array
     */
    private convertChildNode(node: MenuNode, parentChildren: Menu[]): void {
        if (node.item) {
            const menu = node.item;

            // Calculate indentation dynamically
            menu.indentLevel = node.calculateIndent();

            // CRITICAL FIX: Set shouldIndentChildren for nodes with children
            // This is required for proper indentation in the frontend
            if (node.list) {
                // For menuconfig and config nodes with children, enable child indentation
                menu.shouldIndentChildren = true;
            } else {
                menu.shouldIndentChildren = false;
            }

            // Ensure isCollapsed is properly set for menuconfig items
            if (menu.isMenuconfig) {
                menu.isCollapsed = menu.isCollapsed ?? false;
            }

            // Add to parent's children array
            parentChildren.push(menu);

            // Process children as nested items
            if (node.list) {
                menu.children = [];
                let child: MenuNode | null = node.list;
                while (child) {
                    if (child.item) {
                        // Recursively process child
                        this.convertChildNode(child, menu.children);
                    }
                    child = child.next as MenuNode | null;
                }
            }
        }
    }

    // ========== Helper Methods ==========

    /**
     * Create a Menu object with default values
     */
    private createMenu(options: Partial<Menu>): Menu {
        return {
            id: `menu-${this.currentId++}`,
            name: options.name || '',
            title: options.title || '',
            type: options.type || menuType.bool,
            value: options.value ?? null,
            help: options.help || '',
            range: options.range || [],
            isVisible: options.isVisible ?? true,
            isCollapsed: options.isCollapsed ?? false,
            isMenuconfig: options.isMenuconfig ?? false,
            hasPrompt: options.hasPrompt ?? false,
            dependsOn: options.dependsOn || '',
            select: options.select || [],
            selectedBy: options.selectedBy || [],
            children: options.children || [],
            indentLevel: options.indentLevel ?? 0,
            isMainMenu: options.isMainMenu ?? false,
            optionEnvVar: options.optionEnvVar ?? null,
            optionDefconfigList: options.optionDefconfigList ?? false,
            optionModules: options.optionModules ?? false,
            implies: options.implies ? [...options.implies] : [],
            implyConditions: options.implyConditions ? { ...options.implyConditions } : undefined,
            autoImpliedValue: options.autoImpliedValue,
            allowedTristateValues: options.allowedTristateValues ? [...options.allowedTristateValues] : undefined,
            // Enhanced help information
            linenr: options.linenr,
            menuPath: options.menuPath,
            directDepValue: options.directDepValue,
            directDepExpr: options.directDepExpr,
            prompt: options.prompt || options.title || '',
            selectInfo: options.selectInfo,
            selectedByInfo: options.selectedByInfo,
            implyInfo: options.implyInfo,
        };
    }

    /**
     * Read a file and return its lines
     */
    private async readFile(filepath: string): Promise<string[]> {
        // Check cache first
        if (this.fileContentCache.has(filepath)) {
            return this.fileContentCache.get(filepath)!;
        }
        
        try {
            const content = await fs.promises.readFile(filepath, 'utf-8');
            const lines = content.split('\n');
            
            // Cache the content
            this.fileContentCache.set(filepath, lines);
            this.scheduleSourcePrefetch(lines, filepath, 0);
            
            return lines;
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err && err.code === "ENOENT") {
                return [];
            }
            Logger.warn(`Failed to read file ${filepath}: ${error}`);
            return [];
        }
    }

    /**
     * Parse source directive and return resolved file paths
     */
    private async parseSource(
        line: string,
        currentFile: string,
        options?: { suppressWarnings?: boolean }
    ): Promise<{ files: string[]; optional: boolean } | null> {
        const match = line.match(/^(source|rsource|osource|orsource)\s+"?([^"]+)"?/);
        if (!match) {
            return null;
        }
        
        const directive = match[1];
        let sourcePath = match[2];
        const optional = directive.startsWith('o');
        const isRelativeDirective = directive === 'rsource' || directive === 'orsource';
        const srctreeRoot = this.srctreeRoot;
        
        // Expand variables in the path
        sourcePath = this.expandVariables(sourcePath);
////console.log(`[parseSource] Processing ${directive} "${match[2]}"`);
////console.log(`[parseSource] After variable expansion: ${sourcePath}`);
////console.log(`[parseSource] Current file: ${currentFile}`);
        
        // 计算解析基准路径
        const baseDir = path.isAbsolute(sourcePath)
            ? ''
            : (isRelativeDirective ? path.dirname(currentFile) : srctreeRoot);
        const resolvedPattern = path.join(baseDir, sourcePath);
////console.log(`[parseSource] Resolved path: ${resolvedPattern}`);
        
        // 判断是否包含通配符
        if (hasMagic(sourcePath)) {
            try {
                const files = this.deduplicateSourceFiles((await glob(resolvedPattern, { nodir: true }))
                    .map(file => path.normalize(file))
                    .sort((a, b) => a.localeCompare(b)));
                
                if (files.length === 0 && !optional && !options?.suppressWarnings) {
                    Logger.warn(`Source directive matched zero files: ${resolvedPattern}`);
                    return null;
                }
                return { files, optional };
            } catch (error) {
                if (!optional && !options?.suppressWarnings) {
                    Logger.warn(`Failed to glob ${resolvedPattern}: ${error}`);
                }
                return null;
            }
        } else {
            // Single file
            const normalizedPath = path.normalize(resolvedPattern);
            return { files: this.deduplicateSourceFiles([normalizedPath]), optional };
        }
    }

    private collectSourceDirectives(lines: string[]): string[] {
        if (!lines || lines.length === 0) {
            return [];
        }

        const directives: string[] = [];
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (
                line &&
                (line.startsWith("source ") || line.startsWith("rsource ") || line.startsWith("osource ") || line.startsWith("orsource ")) &&
                !line.includes("$(")
            ) {
                directives.push(line);
            }
        }
        return directives;
    }

    private scheduleSourcePrefetch(lines: string[], currentFile: string, depth: number): void {
        if (!this.allowBackgroundPrefetch) {
            return;
        }
        if (!lines || lines.length === 0 || depth >= KconfigParser.SOURCE_PREFETCH_MAX_DEPTH) {
            return;
        }

        const directives = this.collectSourceDirectives(lines);
        if (directives.length === 0) {
            return;
        }

        const task = (async () => {
            const nextDepth = depth + 1;
            for (const directive of directives) {
                const sourceResult = await this.parseSource(directive, currentFile, { suppressWarnings: true });
                if (!sourceResult || !sourceResult.files || sourceResult.files.length === 0) {
                    continue;
                }
                for (const sourceFile of sourceResult.files) {
                    const normalized = path.normalize(sourceFile);
                    if (this.fileContentCache.has(normalized)) {
                        continue;
                    }
                    if (this.scheduledPrefetchFiles.has(normalized)) {
                        continue;
                    }
                    this.scheduledPrefetchFiles.add(normalized);
                    this.sourcePrefetchQueue.push({ filePath: normalized, depth: nextDepth });
                }
            }
            this.ensureSourcePrefetchWorker();
        })().catch((error) => {
            Logger.debugSource(() => `[SOURCE_PREFETCH] Failed to schedule prefetch for ${currentFile}: ${error}`);
        });

        this.prefetchTasks.add(task);
        task.finally(() => {
            this.prefetchTasks.delete(task);
        }).catch(() => undefined);
    }

    private ensureSourcePrefetchWorker(): void {
        if (this.sourcePrefetchWorkerRunning || !this.allowBackgroundPrefetch) {
            return;
        }

        const task = (async () => {
            this.sourcePrefetchWorkerRunning = true;
            try {
                while (this.allowBackgroundPrefetch && this.sourcePrefetchQueue.length > 0) {
                    const batch = this.sourcePrefetchQueue.splice(0, KconfigParser.SOURCE_PREFETCH_BATCH_SIZE);
                    const filePaths = batch.map((entry) => entry.filePath);
                    const depthByFile = new Map<string, number>();
                    for (const entry of batch) {
                        const previousDepth = depthByFile.get(entry.filePath);
                        if (previousDepth === undefined || entry.depth < previousDepth) {
                            depthByFile.set(entry.filePath, entry.depth);
                        }
                    }

                    const preloaded = await this.concurrentProcessor.readFilesAsync(filePaths);
                    if (!this.allowBackgroundPrefetch) {
                        break;
                    }
                    for (const [filePath, content] of preloaded.entries()) {
                        if (this.fileContentCache.has(filePath)) {
                            continue;
                        }
                        const lines = content.split("\n");
                        this.fileContentCache.set(filePath, lines);

                        const currentDepth = depthByFile.get(filePath) ?? KconfigParser.SOURCE_PREFETCH_MAX_DEPTH;
                        if (currentDepth < KconfigParser.SOURCE_PREFETCH_MAX_DEPTH) {
                            this.scheduleSourcePrefetch(lines, filePath, currentDepth);
                        }
                    }
                }
            } finally {
                this.sourcePrefetchWorkerRunning = false;
                if (this.allowBackgroundPrefetch && this.sourcePrefetchQueue.length > 0) {
                    this.ensureSourcePrefetchWorker();
                }
            }
        })();

        this.prefetchTasks.add(task);
        task.finally(() => {
            this.prefetchTasks.delete(task);
        }).catch(() => undefined);
    }

    private deduplicateSourceFiles(files: string[]): string[] {
        if (!files || files.length <= 1) {
            return files;
        }
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const file of files) {
            const normalized = path.normalize(file);
            if (seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            deduped.push(normalized);
        }
        return deduped;
    }

    private async preloadSourceFiles(files: string[], directive: string): Promise<void> {
        if (!files || files.length <= 1) {
            return;
        }
        const uncachedFiles = files.filter(file => !this.fileContentCache.has(file));
        if (uncachedFiles.length <= 1) {
            return;
        }
        try {
            const preloaded = await this.concurrentProcessor.readFilesAsync(uncachedFiles);
            preloaded.forEach((content, filePath) => {
                if (!this.fileContentCache.has(filePath)) {
                    const lines = content.split('\n');
                    this.fileContentCache.set(filePath, lines);
                    this.scheduleSourcePrefetch(lines, filePath, 1);
                }
            });
            Logger.debugParser(`[SOURCE_PRELOAD] Preloaded ${preloaded.size}/${uncachedFiles.length} files for directive: ${directive}`);
        } catch (error) {
            Logger.warn(`Failed to preload source files for directive "${directive}": ${error}`);
        }
    }

    /**
     * Extract quoted string from a line
     */
    private extractQuotedString(line: string): string {
        const match = line.match(/"([^"]+)"/);
        return match ? match[1] : line.trim();
    }

    /**
     * Parse default value based on type
     */
    private parseDefaultValue(value: string, type: menuType): any {
        value = value.replace(/"/g, '').trim();
        
        switch (type) {
            case menuType.bool: {
                const lower = value.toLowerCase();
                return lower === 'y' || lower === 'true' || lower === '1';
            }
            case menuType.tristate: {
                const lower = value.toLowerCase();
                if (lower === 'y' || lower === 'm' || lower === 'n') {
                    return lower;
                }
                if (lower === 'true') {
                    return 'y';
                }
                if (lower === 'false') {
                    return 'n';
                }
                if (lower === '2') {
                    return 'y';
                }
                if (lower === '1') {
                    return 'm';
                }
                if (lower === '0') {
                    return 'n';
                }
                return lower || 'n';
            }
            case menuType.int:
                return parseInt(value) || 0;
            case menuType.hex:
                return value;
            case menuType.string:
            default:
                return value;
        }
    }

    /**
     * Expand variables in a string (e.g., $(RTT_DIR)/Kconfig -> ../../.../Kconfig)
     */
    private expandVariables(str: string): string {
        return this.expandKconfigString(str);
    }

    private expandDefaultValue(value: string): string {
        if (!value) {
            return value;
        }

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            const inner = value.substring(1, value.length - 1);
            const expanded = this.expandKconfigString(inner);
            return `${value[0]}${expanded}${value[value.length - 1]}`;
        }

        return this.expandKconfigString(value);
    }

    private expandKconfigString(value: string, visited: Set<string> = new Set()): string {
        if (!value) {
            return value;
        }

        const replace = (match: string, p1?: string, p2?: string): string => {
            const varName = (p1 || p2 || '').trim();
            if (!varName) {
                return '';
            }

            if (visited.has(varName)) {
                Logger.warn(`Detected recursive variable expansion for ${varName}`);
                return '';
            }

            visited.add(varName);
            let resolved = this.resolveVariable(varName, visited);
            visited.delete(varName);
            if (resolved === undefined) {
                resolved = '';
            }
            return resolved;
        };

        return value.replace(/\$\(([^)]+)\)|\$([A-Za-z_][A-Za-z0-9_]*)/g, replace);
    }

    private resolveVariable(varName: string, visited: Set<string>): string | undefined {
        if (varName === "PKGS_DIR") {
            const envValue = (process.env.PKGS_DIR || "").trim();
            if (envValue) {
                return envValue;
            }
        }

        const variable = this.variables.get(varName);
        if (variable) {
            if (variable.isRecursive) {
                return this.expandKconfigString(variable.value, visited);
            }
            return variable.value;
        }

        if (varName === 'srctree' || varName === 'SRCTREE') {
            return this.srctreeRoot;
        }

        const envValue = process.env[varName];
        if (envValue !== undefined) {
            return envValue;
        }

        Logger.debugParser(`Variable ${varName} not found during expansion, defaulting to empty string`);
        return '';
    }
    
    /**
     * Build select relationships in the node tree.
     * This identifies which configs are selected and marks them accordingly.
     * Must be called before flattening to preserve selected configs.
     */
    private buildSelectRelationshipsInTree(root: MenuNode): void {
        Logger.debugParser('[SELECT_RELATIONSHIPS] Building select relationships in tree...');

        // First pass: collect all nodes with their names
        const nodeMap = new Map<string, MenuNode>();

        const collectNodes = (node: MenuNode) => {
            if (node.item && node.item.name) {
                nodeMap.set(node.item.name, node);
                Logger.debugParser(`[SELECT_RELATIONSHIPS] Collected node: ${node.item.name}`);
            }

            let child = node.list;
            while (child) {
                collectNodes(child);
                child = child.next;
            }
        };

        collectNodes(root);
        Logger.debugParser(`[SELECT_RELATIONSHIPS] Collected ${nodeMap.size} nodes with names`);

        // Second pass: mark nodes that are selected
        const markSelectedNodes = (node: MenuNode) => {
            if (node.item && node.item.select) {
                Logger.debugParser(`[SELECT_RELATIONSHIPS] Processing select statements for ${node.item.name}: [${node.item.select.join(', ')}]`);

                for (const selectTarget of node.item.select) {
                    const targetNode = nodeMap.get(selectTarget);
                    if (targetNode && targetNode.item) {
                        Logger.debugParser(`[SELECT_RELATIONSHIPS] Found target node ${selectTarget}, marking as selected by ${node.item.name}`);

                        // Mark the target as being selected
                        if (!targetNode.item.selectedBy) {
                            targetNode.item.selectedBy = [];
                        }
                        if (!targetNode.item.selectedBy.includes(node.item.name)) {
                            targetNode.item.selectedBy.push(node.item.name);
                            Logger.debugParser(`[SELECT_RELATIONSHIPS] Added selectedBy relationship: ${selectTarget} is selected by ${node.item.name}`);
                        }

                        // If the target has no prompt but is selected, mark it for special handling
                        if (!targetNode.prompt && targetNode.item.selectedBy.length > 0) {
                            // This node should not have its children flattened
                            // because it needs to maintain its if block structure
                            targetNode.item.isImplicitContainer = true;
                            Logger.debugParser(`[SELECT_RELATIONSHIPS] Marked ${selectTarget} as implicit container (no prompt but selected)`);
                        }
                    } else {
                        Logger.debugParser(`[SELECT_RELATIONSHIPS] WARNING: Select target ${selectTarget} not found in node map for selector ${node.item.name}`);
                    }
                }
            }

            let child = node.list;
            while (child) {
                markSelectedNodes(child);
                child = child.next;
            }
        };

        markSelectedNodes(root);

        // Log final select relationships
        Logger.debugParser('[SELECT_RELATIONSHIPS] Final select relationships:');
        for (const [name, node] of nodeMap) {
            if (node.item && node.item.selectedBy && node.item.selectedBy.length > 0) {
                Logger.debugParser(`[SELECT_RELATIONSHIPS]   ${name} is selected by: [${node.item.selectedBy.join(', ')}]`);
            }
        }

        Logger.debugParser('[SELECT_RELATIONSHIPS] Select relationships building completed');
    }
    
    /**
     * Build reverse select relationships (selectedBy) in Menu array.
     * This is called after converting to Menu array for compatibility.
     */
    private buildSelectRelationships(menus: Menu[]): void {
        const allMenus = this.flattenMenus(menus);

        // Build menu map for quick lookup
        const menuMap = new Map<string, Menu>();
        for (const menu of allMenus) {
            if (menu.name) {
                menuMap.set(menu.name, menu);
                Logger.debugParser(`[MENU_SELECT_RELATIONSHIPS] Mapped menu: ${menu.name} (has select: ${menu.select.length > 0})`);
            }
        }

        // Build selectedBy relationships
        let selectRelationshipsFound = 0;
        for (const menu of allMenus) {
            if (menu.select.length > 0) {
                Logger.debugParser(`[MENU_SELECT_RELATIONSHIPS] Processing ${menu.name} select targets: [${menu.select.join(', ')}]`);

                for (const selectTarget of menu.select) {
                    const targetMenu = menuMap.get(selectTarget);
                    if (targetMenu) {
                        if (!targetMenu.selectedBy.includes(menu.name)) {
                            targetMenu.selectedBy.push(menu.name);
                            selectRelationshipsFound++;
                            Logger.debugParser(`[MENU_SELECT_RELATIONSHIPS] Added relation: ${selectTarget} selected by ${menu.name}`);
                        }
                    } else {
                        Logger.warn(`[MENU_SELECT_RELATIONSHIPS] WARNING: Select target ${selectTarget} not found for selector ${menu.name}`);

                        // Special warning for DFS_USING_POSIX
                        if (selectTarget === 'DFS_USING_POSIX') {
                            Logger.error(`[MENU_SELECT_RELATIONSHIPS] *** ERROR: DFS_USING_POSIX not found in menu map! ***`);
                        }
                    }
                }
            }
        }
        Logger.debugParser(`[MENU_SELECT_RELATIONSHIPS] Built ${selectRelationshipsFound} select relationships`);
    }
    
    /**
     * Flatten menu hierarchy to get all menus.
     */
    private flattenMenus(menus: Menu[]): Menu[] {
        const result: Menu[] = [];
        
        for (const menu of menus) {
            result.push(menu);
            if (menu.children && menu.children.length > 0) {
                result.push(...this.flattenMenus(menu.children));
            }
        }
        
        return result;
    }
}
