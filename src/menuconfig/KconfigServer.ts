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

import { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";
import { Menu, menuType } from "./Menu";
import { KconfigMenuLoader } from "./KconfigMenuLoader";
import { createMenuDetailPayload, MenuDetailPayload } from "./MenuTransferSerializer";
import { Logger } from "../logger/logger";
import { VisibilityManager } from "./VisibilityManager";
import { FileWatcher } from "./fileWatcher";
import { KconfigWriter, SymbolAssignment } from "./KconfigWriter";

interface KconfigServerOptions {
    workspaceFolder: vscode.Uri;
    kconfigFile: string;
    configFile?: string;
}

export interface KconfigValue {
    name: string;
    value: string | number | boolean;
    type: menuType;
}

interface MenuStateSnapshot {
    type: menuType;
    value: any;
    isVisible?: boolean;
    isContainerVisible?: boolean;
    isReadonly?: boolean;
    readonlyReason?: string;
    selectedBy?: string[];
    autoSelectedValue?: boolean;
    autoImpliedValue?: 'y' | 'm' | boolean;
}

interface MenuDeltaChange {
    id: string;
    isVisible?: boolean;
    isContainerVisible?: boolean;
    isReadonly?: boolean;
    readonlyReason?: string;
    selectedBy?: string[];
    autoSelectedValue?: boolean;
    autoImpliedValue?: 'y' | 'm' | boolean;
    value?: any;
}

export class KconfigServer extends EventEmitter {
    private static instance: KconfigServer | null = null;
    
    private serverProcess: ChildProcess | null = null;
    private receivedDataBuffer: string = "";
    private kconfigMenus: Menu[] = [];
    private defaultValues: Map<string, any> = new Map();
    private workspaceFolder: vscode.Uri;
    private kconfigFile: string;
    private configFile: string;
    private isRunning: boolean = false;
    private unsavedChanges: boolean = false;
    private visibilityManager: VisibilityManager;
    private kconfigWriter: KconfigWriter;
    private menuIndex: Map<string, Menu> = new Map();
    private menuNameIndex: Map<string, Menu[]> = new Map();
    private choiceParentByChildId: Map<string, Menu> = new Map();
    private menuParentByChildId: Map<string, string | null> = new Map();
    private menuStateCache: Map<string, MenuStateSnapshot> = new Map();
    
    constructor(options: KconfigServerOptions) {
        super();
        this.workspaceFolder = options.workspaceFolder;
        this.kconfigFile = options.kconfigFile;

        // If no configFile specified, default to .config in the same directory as the Kconfig file
        if (options.configFile) {
            this.configFile = options.configFile;
        } else {
            const kconfigDir = path.dirname(options.kconfigFile);
            this.configFile = path.join(kconfigDir, ".config");
        }

        this.visibilityManager = new VisibilityManager();
        // Pass the visibility manager's evaluator to the writer so it uses the same context
        this.kconfigWriter = new KconfigWriter(this.defaultValues, this.visibilityManager.getEvaluator());
    }
    
    public static async init(options: KconfigServerOptions): Promise<KconfigServer> {
        if (KconfigServer.instance) {
            KconfigServer.instance.dispose();
        }
        
        KconfigServer.instance = new KconfigServer(options);
        await KconfigServer.instance.start();
        return KconfigServer.instance;
    }
    
    public static getInstance(): KconfigServer | null {
        return KconfigServer.instance;
    }
    
    public async start(): Promise<void> {
        // For now, use a simple implementation that reads Kconfig files directly
        // In the future, this could be replaced with a Python-based Kconfig server
        // using kconfiglib or similar tools
        
        this.isRunning = true;
        
        // Load Kconfig structure using the specific file
        const targetFile = vscode.Uri.file(this.kconfigFile);
        const loader = new KconfigMenuLoader(this.workspaceFolder, targetFile);
        this.kconfigMenus = await loader.loadKconfigMenus();
        
        // Save default values from Kconfig
        this.saveDefaultValues(this.kconfigMenus);
        this.rebuildMenuCaches();
        
        // Load existing config values if available
        if (fs.existsSync(this.configFile)) {
            await this.loadConfigValues();
        }
        
        // Initialize visibility manager with loaded menus
        Logger.info(() => `[KCONFIG_SERVER] Initializing visibility manager with ${this.kconfigMenus.length} menus`);
        this.visibilityManager.initialize(this.kconfigMenus);
        this.forceTopLevelMenusVisible(this.kconfigMenus);

        this.rebuildMenuCaches();
        Logger.info(() => `[KCONFIG_SERVER] Initialized with ${this.kconfigMenus.length} menus and visibility manager`);
        this.emit("ready", this.kconfigMenus);
    }
    
    public getMenus(): Menu[] {
        return this.kconfigMenus;
    }
    
    public getVisibilityManager(): VisibilityManager {
        return this.visibilityManager;
    }
    
    public hasUnsavedChanges(): boolean {
        return this.unsavedChanges;
    }

    public getMenuDetailById(id: string): MenuDetailPayload | null {
        const menu = this.menuIndex.get(id);
        if (!menu) {
            return null;
        }
        const detail = createMenuDetailPayload(menu);
        if (!detail.prompt) {
            detail.prompt = menu.title || menu.name || "";
        }
        if (!detail.directDepExpr && menu.dependsOn && menu.dependsOn.trim() !== "" && menu.dependsOn.trim() !== "y") {
            detail.directDepExpr = menu.dependsOn;
        }
        if (!detail.menuPath) {
            detail.menuPath = this.buildMenuPath(id);
        }
        return detail;
    }
    
    public updateValue(updatedMenu: Menu): void {
        this.unsavedChanges = true;

        const targetMenu = this.menuIndex.get(updatedMenu.id);
        if (!targetMenu) {
            return;
        }

        // Validate and clamp numeric-like values against range constraints.
        let newValue = updatedMenu.value;
        if ((targetMenu.type === menuType.int || targetMenu.type === menuType.hex) && targetMenu.range && targetMenu.range.length >= 2) {
            const min = targetMenu.range[0];
            const max = targetMenu.range[1];
            const numValue = typeof newValue === 'number' ? newValue : parseInt(newValue.toString(), 10);

            if (!isNaN(numValue)) {
                if (numValue < min) {
                    newValue = min;
                } else if (numValue > max) {
                    newValue = max;
                }
            }
        }

        targetMenu.value = newValue;
        this.kconfigMenus = this.visibilityManager.updateValue(targetMenu.id, newValue);

        const affectedIds = this.visibilityManager.consumeLastAffectedMenuIds();
        const visibilityChanges = this.collectChangesForAffectedMenus(affectedIds);
        if (visibilityChanges.length > 0) {
            this.emit("visibilityChanged", visibilityChanges);
        }
    }
    
    public async saveConfig(): Promise<void> {
        this.logCurrentValues("[SAVE] Values before save");

        try {
            const assignments: SymbolAssignment[] = this.kconfigWriter.collectAssignments(this.kconfigMenus);

            const headerPath = await this.resolveHeaderPath();

            // 通知 FileWatcher 忽略内部写入导致的变更
            FileWatcher.getInstance()?.ignoreNextChange();

            await this.kconfigWriter.write({
                menus: this.kconfigMenus,
                assignments,
                configOut: this.configFile,
                headerOut: headerPath || undefined,
                configHeader: undefined,
                headerHeader: headerPath ? this.getAutoHeader() : undefined,
                saveOld: true,
            });

            this.unsavedChanges = false;
            this.emit("configSaved");
        } catch (error) {
            Logger.error("Failed to save configuration", error as Error);
            vscode.window.showErrorMessage(`Failed to save configuration: ${error}`);
        }
    }
    
    public async saveDefconfig(filepath?: string): Promise<void> {
        const defconfigPath = filepath || path.join(this.workspaceFolder.fsPath, "defconfig");
        const assignments: SymbolAssignment[] = this.kconfigWriter.collectAssignments(this.kconfigMenus);

        try {
            const defconfigDir = path.dirname(defconfigPath);
            await fs.promises.mkdir(defconfigDir, { recursive: true });

            await this.kconfigWriter.write({
                menus: this.kconfigMenus,
                assignments,
                defconfigOut: defconfigPath,
                configHeader: undefined,
                saveOld: false,
            });

            vscode.window.showInformationMessage(`Default configuration saved to ${defconfigPath}`);
        } catch (error) {
            Logger.error("Failed to save defconfig", error as Error);
            vscode.window.showErrorMessage(`Failed to save defconfig: ${error}`);
        }
    }
    
    public async resetToDefaults(): Promise<void> {
        // Logger.info("[RESET] Starting reset to defaults operation");
        // Logger.info(`[RESET] Default values stored: ${this.defaultValues.size}`);
        // Logger.info(`[RESET] Config file path: ${this.configFile}`);

        // 通知 FileWatcher 忽略接下来的文件变化（删除操作触发的）
        FileWatcher.getInstance()?.ignoreNextChange();

        // Delete .config file if it exists
        if (fs.existsSync(this.configFile)) {
            try {
                await fs.promises.unlink(this.configFile);
                // Logger.info("[RESET] Successfully deleted .config file");
            } catch (error) {
                // Logger.warn(`[RESET] Failed to delete .config file: ${error}`);
            }
        } else {
            // Logger.info("[RESET] .config file does not exist, nothing to delete");
        }
        
        // Log all stored default values
        // for (const [name, value] of this.defaultValues.entries()) {
        //     Logger.info(`[RESET] Default value: ${name} = ${value}`);
        // }
        
        // Reset all values to their default values from Kconfig
        const resetMenuValues = (menus: Menu[], depth = 0) => {
            const _indent = "  ".repeat(depth);
            
            for (const menu of menus) {
                if (menu.type !== menuType.menu && menu.name) {
                    const _oldValue = menu.value;
                    // Restore the default value from saved defaults
                    const defaultValue = this.defaultValues.get(menu.name);
                    menu.value = defaultValue !== undefined ? defaultValue : null;
                    
                    // Logger.info(`[RESET] ${indent}${menu.name} (${menu.type}): ${oldValue} -> ${menu.value} (default: ${defaultValue})`);
                }
                if (menu.children) {
                    resetMenuValues(menu.children, depth + 1);
                }
            }
        };
        
        resetMenuValues(this.kconfigMenus);

        // After resetting values, recompute visibility/read-only states
        // so that the menu tree reflects the freshly restored defaults.
        this.visibilityManager.initialize(this.kconfigMenus);
        this.forceTopLevelMenusVisible(this.kconfigMenus);
        this.rebuildMenuCaches();

        this.unsavedChanges = true;
        
        // Logger.info("[RESET] Reset to defaults completed");
        this.emit("configReset", this.kconfigMenus);
    }
    
    public async discardChanges(): Promise<void> {
        // Logger.info("[DISCARD] Starting discard changes operation");
        // Logger.info(`[DISCARD] Config file path: ${this.configFile}`);
        // Logger.info(`[DISCARD] Config file exists: ${fs.existsSync(this.configFile)}`);

        // 通知 FileWatcher 忽略接下来的文件变化（discard 操作可能触发的）
        FileWatcher.getInstance()?.ignoreNextChange();

        // Log current values before discard
        this.logCurrentValues("[DISCARD] Values before discard");

        // First reset to Kconfig defaults
        // Logger.info("[DISCARD] Resetting to Kconfig defaults");
        await this.resetToDefaults();

        // Log values after reset
        this.logCurrentValues("[DISCARD] Values after reset to defaults");

        // Then load config file values if it exists
        if (fs.existsSync(this.configFile)) {
            // Logger.info("[DISCARD] Loading config file values");
            await this.loadConfigValues();

            // Log values after loading config
            // this.logCurrentValues("[DISCARD] Values after loading config file");
        } else {
            // Logger.warn("[DISCARD] Config file does not exist, keeping default values");
        }

        this.rebuildMenuCaches();
        this.unsavedChanges = false;
        // Logger.info("[DISCARD] Discard changes completed");
        this.emit("changesDiscarded", this.kconfigMenus);
    }
    
    private async loadConfigValues(): Promise<void> {
        try {
            const configContent = await fs.promises.readFile(this.configFile, "utf8");
            const configLines = configContent.split("\n");

            Logger.info(() => `[LOAD_CONFIG] Reading config file: ${this.configFile}`);
            Logger.info(() => `[LOAD_CONFIG] Total lines in config: ${configLines.length}`);

            let _processedLines = 0;
            let _skippedLines = 0;

            for (const line of configLines) {
                const trimmedLine = line.trim();

                if (!trimmedLine) {
                    _skippedLines++;
                    continue;
                }

                // First handle commented out CONFIG lines: "# CONFIG_NAME is not set"
                if (trimmedLine.startsWith("#")) {
                    const commentMatch = trimmedLine.match(/^#\s*CONFIG_([A-Z0-9_]+)\s+is\s+not\s+set$/);
                    if (commentMatch) {
                        const _configName = commentMatch[1];
                        const updateResult = this.updateIndexedMenuValues(_configName, "n");
                        if (updateResult) {
                            _processedLines++;
                        }
                        continue;
                    }
                    _skippedLines++;
                    continue;
                }

                // Parse CONFIG_NAME=value lines
                const configMatch = trimmedLine.match(/^CONFIG_([A-Z0-9_]+)=(.+)$/);
                if (configMatch) {
                    const _configName = configMatch[1];
                    const configValue = configMatch[2];

                    const updateResult = this.updateIndexedMenuValues(_configName, configValue);
                    if (updateResult) {
                        _processedLines++;
                    }
                    continue;
                }

                _skippedLines++;
            }

            Logger.info(() => `[LOAD_CONFIG] Processed ${_processedLines} config lines, skipped ${_skippedLines} lines`);

            // After loading raw values, reconcile choice containers from children values
            this.reconcileChoicesFromChildren();

            // Extra debug for memory allocator related symbols
            const logVal = (name: string) => {
                const menu = this.findMenuByName(name);
                return menu ? `name=${name}, value=${menu.value}` : `name=${name} not found`;
            };
            Logger.info("[LOAD_CONFIG] Memory allocator status after load:");
            Logger.info("[LOAD_CONFIG]   " + logVal("RT_USING_SMALL_MEM"));
            Logger.info("[LOAD_CONFIG]   " + logVal("RT_USING_SLAB"));
            Logger.info("[LOAD_CONFIG]   " + logVal("RT_USING_SMALL_MEM_AS_HEAP"));
            Logger.info("[LOAD_CONFIG]   " + logVal("RT_USING_SLAB_AS_HEAP"));
            const heapChoice = this.findParentChoice("RT_USING_SMALL_MEM_AS_HEAP") || this.findParentChoice("RT_USING_SLAB_AS_HEAP");
            if (heapChoice) {
                Logger.info(() => `[LOAD_CONFIG]   choice(System Heap) selected: ${heapChoice.value}`);
            }
        } catch (error) {
            Logger.error("Failed to load config values", error as Error);
        }
    }

    /**
     * Reconcile choice container values based on their children's boolean values.
     * Kconfiglib semantics: if a child bool within a choice is 'y', that child is the selection.
     * When multiple children are 'y' (shouldn't happen), prefer the last 'y' encountered.
     */
    private reconcileChoicesFromChildren(): void {
        const process = (menus: Menu[]) => {
            for (const menu of menus) {
                if (menu.type === menuType.choice && menu.children && menu.children.length > 0) {
                    let selected: string | null = null;
                    for (const child of menu.children) {
                        if (child.type === menuType.bool && child.value === true) {
                            selected = child.name;
                        }
                    }
                    if (selected) {
                        // Apply selection to the choice container and normalize siblings
                        menu.value = selected;
                        for (const child of menu.children) {
                            child.value = child.name === selected;
                        }
                        Logger.info(() => `[CHOICE_RECONCILE] Choice "${menu.title || menu.name}" selected <- ${selected}`);
                    }
                }
                if (menu.children && menu.children.length > 0) {
                    process(menu.children);
                }
            }
        };
        process(this.kconfigMenus);
    }
    
    private updateMenuValueByName(name: string, value: string): boolean {
        return this.updateIndexedMenuValues(name, value);
    }
    
    private async resolveHeaderPath(): Promise<string | null> {
        const config = vscode.workspace.getConfiguration("kconfig");
        let headerPath = config.get<string>("autoHeaderPath", "config.h")?.trim() || "";

        if (!headerPath) {
            return null;
        }

        if (!path.isAbsolute(headerPath)) {
            const configDir = path.dirname(this.configFile);
            headerPath = path.join(configDir, headerPath);
        }

        await fs.promises.mkdir(path.dirname(headerPath), { recursive: true });
        return headerPath;
    }

    private getConfigHeader(): string {
        return "#\n# Automatically generated file; DO NOT EDIT.\n#\n\n";
    }

    private getAutoHeader(): string {
        return "/*\n * Automatically generated file; DO NOT EDIT.\n */\n\n";
    }
    
    private saveDefaultValues(menus: Menu[]): void {
        // Logger.info("[SAVE_DEFAULTS] Starting to save default values");
        
        const saveValues = (menus: Menu[], depth = 0) => {
            const _indent = "  ".repeat(depth);
            
            for (const menu of menus) {
                if (menu.type !== menuType.menu && menu.name) {
                    // 保存所有有name的菜单项的默认值，包括值为null或undefined的
                    this.defaultValues.set(menu.name, menu.value);
                    // Logger.info(`[SAVE_DEFAULTS] ${indent}Saved default: ${menu.name} (${menu.type}) = ${menu.value}`);
                }
                if (menu.children) {
                    saveValues(menu.children, depth + 1);
                }
            }
        };
        
        saveValues(menus);
        // Logger.info(`[SAVE_DEFAULTS] Saved ${this.defaultValues.size} default values`);
    }

    /**
     * Find a menu by its symbol name in the current menu tree
     */
    private findMenuByName(name: string): Menu | null {
        const dfs = (menus: Menu[]): Menu | null => {
            for (const m of menus) {
                if (m.name === name) return m;
                if (m.children && m.children.length > 0) {
                    const found = dfs(m.children);
                    if (found) return found;
                }
            }
            return null;
        };
        return dfs(this.kconfigMenus);
    }
    
    /**
     * Format a single config as a C #define statement
     * (deprecated: retained for backward compatibility)
     */
    private formatHeaderLine(_: Menu, __: unknown): string {
        return "";
    }

    /**
     * Escapes string for .config file output, matching Kconfiglib behavior
     * Backslashes must be escaped before quotes to avoid double escaping
     */
    private findParentChoice(childName: string): Menu | null {
        const byName = this.menuNameIndex.get(childName) || [];
        for (const target of byName) {
            const parentChoice = this.choiceParentByChildId.get(target.id);
            if (parentChoice) {
                return parentChoice;
            }
        }
        return null;
    }
    
    private rebuildMenuCaches(): void {
        const nextIndex = new Map<string, Menu>();
        const nextNameIndex = new Map<string, Menu[]>();
        const nextChoiceParent = new Map<string, Menu>();
        const nextParentByChildId = new Map<string, string | null>();
        const nextState = new Map<string, MenuStateSnapshot>();
        const stack: Array<{ menu: Menu; parentId: string | null }> =
            this.kconfigMenus.map((menu) => ({ menu, parentId: null }));

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current || !current.menu) {
                continue;
            }
            const menu = current.menu;

            nextIndex.set(menu.id, menu);
            nextParentByChildId.set(menu.id, current.parentId);
            nextState.set(menu.id, this.snapshotMenuState(menu));
            if (menu.name) {
                const siblings = nextNameIndex.get(menu.name) || [];
                siblings.push(menu);
                nextNameIndex.set(menu.name, siblings);
            }
            if (menu.type === menuType.choice && menu.children && menu.children.length > 0) {
                for (const child of menu.children) {
                    nextChoiceParent.set(child.id, menu);
                }
            }

            if (menu.children && menu.children.length > 0) {
                for (let i = 0; i < menu.children.length; i++) {
                    stack.push({
                        menu: menu.children[i],
                        parentId: menu.id,
                    });
                }
            }
        }

        this.menuIndex = nextIndex;
        this.menuNameIndex = nextNameIndex;
        this.choiceParentByChildId = nextChoiceParent;
        this.menuParentByChildId = nextParentByChildId;
        this.menuStateCache = nextState;
    }

    private buildMenuPath(menuId: string): string {
        const segments: string[] = [];
        let parentId = this.menuParentByChildId.get(menuId) ?? null;

        while (parentId) {
            const parent = this.menuIndex.get(parentId);
            if (!parent) {
                break;
            }
            const label = (parent.title || parent.prompt || parent.name || "").trim();
            if (label) {
                segments.unshift(label);
            }
            parentId = this.menuParentByChildId.get(parentId) ?? null;
        }

        if (segments.length === 0) {
            return "(Top)";
        }
        return `(Top) -> ${segments.join(" -> ")}`;
    }

    private updateIndexedMenuValues(name: string, rawValue: string): boolean {
        const targets = this.menuNameIndex.get(name);
        if (!targets || targets.length === 0) {
            return false;
        }

        for (const menu of targets) {
            this.applyConfigValueToMenu(menu, rawValue);
        }
        return true;
    }

    private applyConfigValueToMenu(menu: Menu, rawValue: string): void {
        switch (menu.type) {
            case menuType.bool: {
                menu.value = rawValue === "y";
                const parentChoice = this.choiceParentByChildId.get(menu.id);
                if (parentChoice) {
                    if (menu.value === true) {
                        parentChoice.value = menu.name;
                        for (const sibling of parentChoice.children || []) {
                            if (sibling.name !== menu.name && sibling.type === menuType.bool) {
                                sibling.value = false;
                            }
                        }
                        Logger.info(() => `[LOAD_CONFIG] Set parent choice "${parentChoice.title || parentChoice.name}" <- ${menu.name}`);
                    } else if (parentChoice.value === menu.name) {
                        parentChoice.value = null as any;
                    }
                }
                return;
            }
            case menuType.tristate: {
                let normalized: "y" | "m" | "n" = "n";
                const lower = rawValue.toLowerCase();
                if (lower === "y" || lower === "2") {
                    normalized = "y";
                } else if (lower === "m" || lower === "1") {
                    normalized = "m";
                }
                menu.value = normalized;
                return;
            }
            case menuType.int:
                menu.value = parseInt(rawValue, 10);
                return;
            case menuType.hex:
                menu.value = rawValue;
                return;
            case menuType.string:
                menu.value = rawValue.replace(/^"(.*)"$/, "$1");
                return;
            case menuType.choice:
                menu.value = rawValue === "y" ? menu.name : null;
                return;
            default:
                menu.value = rawValue;
                return;
        }
    }

    private forceTopLevelMenusVisible(menus: Menu[]): void {
        menus.forEach((menu) => {
            if (menu.type === menuType.menu && menu.hasPrompt && (!menu.dependsOn || menu.dependsOn.trim() === "")) {
                menu.isVisible = true;
                (menu as any).isContainerVisible = true;
            }
            if (menu.children && menu.children.length > 0) {
                this.forceTopLevelMenusVisible(menu.children);
            }
        });
    }

    private snapshotMenuState(menu: Menu): MenuStateSnapshot {
        return {
            type: menu.type,
            value: menu.value,
            isVisible: menu.isVisible,
            isContainerVisible: (menu as any).isContainerVisible,
            isReadonly: menu.isReadonly,
            readonlyReason: menu.readonlyReason,
            selectedBy: menu.selectedBy ? [...menu.selectedBy] : undefined,
            autoSelectedValue: menu.autoSelectedValue,
            autoImpliedValue: menu.autoImpliedValue,
        };
    }

    private collectChangesForAffectedMenus(affectedIds: Iterable<string>): MenuDeltaChange[] {
        const visibilityChanges: MenuDeltaChange[] = [];

        for (const id of affectedIds) {
            const menu = this.menuIndex.get(id);
            if (!menu) {
                continue;
            }

            const before = this.menuStateCache.get(id);
            const current = this.snapshotMenuState(menu);

            const valueDiff = !before || !this.areMenuValuesEqual(before.value, current.value, current.type);
            const visibilityDiff = !before || (
                before.isVisible !== current.isVisible ||
                before.isContainerVisible !== current.isContainerVisible ||
                before.isReadonly !== current.isReadonly ||
                before.readonlyReason !== current.readonlyReason ||
                this.arrayChanged(before.selectedBy, current.selectedBy) ||
                before.autoSelectedValue !== current.autoSelectedValue ||
                before.autoImpliedValue !== current.autoImpliedValue
            );

            if (!before || visibilityDiff || valueDiff) {
                visibilityChanges.push({
                    id: menu.id,
                    isVisible: current.isVisible,
                    isContainerVisible: current.isContainerVisible,
                    isReadonly: current.isReadonly,
                    readonlyReason: current.readonlyReason,
                    selectedBy: current.selectedBy ? [...current.selectedBy] : undefined,
                    autoSelectedValue: current.autoSelectedValue,
                    autoImpliedValue: current.autoImpliedValue,
                    value: valueDiff || !before ? menu.value : undefined
                });
            }

            this.menuStateCache.set(id, current);
        }

        return visibilityChanges;
    }

    private areMenuValuesEqual(previous: any, current: any, type: menuType): boolean {
        switch (type) {
            case menuType.int:
                return Number(previous) === Number(current);
            case menuType.hex:
                if (previous === undefined && current === undefined) return true;
                return String(previous || '').toLowerCase() === String(current || '').toLowerCase();
            default:
                return previous === current;
        }
    }

    private arrayChanged(a?: string[], b?: string[]): boolean {
        if (!a && !b) {
            return false;
        }
        if (!a || !b) {
            return true;
        }
        if (a.length !== b.length) {
            return true;
        }
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return true;
            }
        }
        return false;
    }

    private logCurrentValues(_prefix: string): void {
        const logMenuValues = (menus: Menu[], depth = 0) => {
            const _indent = "  ".repeat(depth);

            for (const menu of menus) {
                if (menu.name && menu.value !== null && menu.value !== undefined) {
                    // Logger.info(`${prefix} ${indent}${menu.name} (${menu.type}): ${menu.value}`);
                }
                
                if (menu.children && menu.children.length > 0) {
                    logMenuValues(menu.children, depth + 1);
                }
            }
        };
        
        // Logger.info(`${prefix} - Current configuration values:`);
        logMenuValues(this.kconfigMenus);
    }
    
    public dispose(): void {
        if (this.serverProcess) {
            this.serverProcess.kill();
            this.serverProcess = null;
        }
        this.isRunning = false;
        this.removeAllListeners();
        
        if (KconfigServer.instance === this) {
            KconfigServer.instance = null;
        }
    }
}
