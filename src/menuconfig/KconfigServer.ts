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
    private menuLoader?: KconfigMenuLoader;
    
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
        this.menuLoader = loader; // Save the loader instance for reuse
        this.kconfigMenus = await loader.loadKconfigMenus();
        
        // Save default values from Kconfig
        this.saveDefaultValues(this.kconfigMenus);
        
        // Load existing config values if available
        if (fs.existsSync(this.configFile)) {
            await this.loadConfigValues();
        }
        
        // Initialize visibility manager with loaded menus
        Logger.info(`[KCONFIG_SERVER] Initializing visibility manager with ${this.kconfigMenus.length} menus`);
        this.visibilityManager.initialize(this.kconfigMenus);

        // Debug: Check DFS_USING_POSIX status after initialization
        const findMenuByName = (menus: Menu[], name: string): Menu | null => {
            for (const menu of menus) {
                if (menu.name === name) return menu;
                if (menu.children) {
                    const found = findMenuByName(menu.children, name);
                    if (found) return found;
                }
            }
            return null;
        };

        const dfsUsingPosix = findMenuByName(this.kconfigMenus, 'DFS_USING_POSIX');
        const rtUsingPosixFs = findMenuByName(this.kconfigMenus, 'RT_USING_POSIX_FS');
        const rtUsingHookList = findMenuByName(this.kconfigMenus, 'RT_USING_HOOKLIST');
        const rtUsingSmallMem = findMenuByName(this.kconfigMenus, 'RT_USING_SMALL_MEM');
        const rtUsingSlab = findMenuByName(this.kconfigMenus, 'RT_USING_SLAB');
        const rtUsingSmallMemAsHeap = findMenuByName(this.kconfigMenus, 'RT_USING_SMALL_MEM_AS_HEAP');
        const rtUsingFdt = findMenuByName(this.kconfigMenus, 'RT_USING_FDT');
        const rtUsingFdtLib = findMenuByName(this.kconfigMenus, 'RT_USING_FDTLIB');
        const rtUsingSlabAsHeap = findMenuByName(this.kconfigMenus, 'RT_USING_SLAB_AS_HEAP');

        Logger.info(`[KCONFIG_SERVER] After initialize:`);
        if (dfsUsingPosix) {
            Logger.info(`[KCONFIG_SERVER]   DFS_USING_POSIX:`);
            Logger.info(`[KCONFIG_SERVER]     - value: ${dfsUsingPosix.value}`);
            Logger.info(`[KCONFIG_SERVER]     - selectedBy: [${dfsUsingPosix.selectedBy?.join(', ') || 'none'}]`);
            Logger.info(`[KCONFIG_SERVER]     - isReadonly: ${dfsUsingPosix.isReadonly}`);
            Logger.info(`[KCONFIG_SERVER]     - readonlyReason: ${dfsUsingPosix.readonlyReason || 'none'}`);
        } else {
            Logger.info(`[KCONFIG_SERVER]   DFS_USING_POSIX: NOT FOUND`);
        }
        if (rtUsingSmallMem || rtUsingSlab) {
            Logger.info(`[KCONFIG_SERVER]   Memory allocators:`);
            if (rtUsingSmallMem) Logger.info(`[KCONFIG_SERVER]     - RT_USING_SMALL_MEM: ${rtUsingSmallMem.value}`);
            if (rtUsingSlab) Logger.info(`[KCONFIG_SERVER]     - RT_USING_SLAB: ${rtUsingSlab.value}`);
            if (rtUsingSmallMemAsHeap) Logger.info(`[KCONFIG_SERVER]     - RT_USING_SMALL_MEM_AS_HEAP: ${rtUsingSmallMemAsHeap.value}`);
            if (rtUsingSlabAsHeap) Logger.info(`[KCONFIG_SERVER]     - RT_USING_SLAB_AS_HEAP: ${rtUsingSlabAsHeap.value}`);
            const heapChoice = this.findParentChoice('RT_USING_SMALL_MEM_AS_HEAP') || this.findParentChoice('RT_USING_SLAB_AS_HEAP');
            if (heapChoice) {
                Logger.info(`[KCONFIG_SERVER]     - HEAP CHOICE selected: ${heapChoice.value}`);
            }
        }

        if (rtUsingPosixFs) {
            Logger.info(`[KCONFIG_SERVER]   RT_USING_POSIX_FS:`);
            Logger.info(`[KCONFIG_SERVER]     - value: ${rtUsingPosixFs.value}`);
            Logger.info(`[KCONFIG_SERVER]     - select: [${rtUsingPosixFs.select?.join(', ') || 'none'}]`);
        } else {
            Logger.info(`[KCONFIG_SERVER]   RT_USING_POSIX_FS: NOT FOUND`);
        }

        if (rtUsingHookList) {
            Logger.info(`[KCONFIG_SERVER]   RT_USING_HOOKLIST:`);
            Logger.info(`[KCONFIG_SERVER]     - value: ${rtUsingHookList.value}`);
            Logger.info(`[KCONFIG_SERVER]     - selectedBy: [${rtUsingHookList.selectedBy?.join(', ') || 'none'}]`);
            Logger.info(`[KCONFIG_SERVER]     - isReadonly: ${rtUsingHookList.isReadonly}`);
            Logger.info(`[KCONFIG_SERVER]     - readonlyReason: ${rtUsingHookList.readonlyReason || 'none'}`);
        }

        if (rtUsingFdt || rtUsingFdtLib) {
            Logger.info(`[KCONFIG_SERVER]   FDT legacy block (before visibility update):`);
            if (rtUsingFdt) Logger.info(`[KCONFIG_SERVER]     - RT_USING_FDT: value=${rtUsingFdt.value}, dependsOn=${rtUsingFdt.dependsOn || 'y'}`);
            if (rtUsingFdtLib) Logger.info(`[KCONFIG_SERVER]     - RT_USING_FDTLIB: value=${rtUsingFdtLib.value}, dependsOn=${rtUsingFdtLib.dependsOn || 'y'}`);
        }

        // Apply initial visibility calculations
        Logger.info(`[KCONFIG_SERVER] Calling updateValue("", null) for initial visibility`);

        // Check if menus are the same reference
        const beforeUpdate = this.kconfigMenus;
        const afterUpdate = this.visibilityManager.updateValue("", null);

        Logger.info(`[KCONFIG_SERVER] Menu reference check:`);
        Logger.info(`[KCONFIG_SERVER]   - Same reference: ${beforeUpdate === afterUpdate}`);
        Logger.info(`[KCONFIG_SERVER]   - beforeUpdate length: ${beforeUpdate.length}`);
        Logger.info(`[KCONFIG_SERVER]   - afterUpdate length: ${afterUpdate.length}`);

        // Use the updated menus (they should be the same reference, but let's be safe)
        this.kconfigMenus = afterUpdate;

        // Debug: Check DFS_USING_POSIX status after updateValue
        const dfsUsingPosixAfter = findMenuByName(this.kconfigMenus, 'DFS_USING_POSIX');
        const rtUsingPosixFsAfter = findMenuByName(this.kconfigMenus, 'RT_USING_POSIX_FS');
        const rtUsingHookListAfter = findMenuByName(this.kconfigMenus, 'RT_USING_HOOKLIST');
        const smallMemAfter = findMenuByName(this.kconfigMenus, 'RT_USING_SMALL_MEM');
        const slabAfter = findMenuByName(this.kconfigMenus, 'RT_USING_SLAB');
        const smallMemHeapAfter = findMenuByName(this.kconfigMenus, 'RT_USING_SMALL_MEM_AS_HEAP');
        const slabHeapAfter = findMenuByName(this.kconfigMenus, 'RT_USING_SLAB_AS_HEAP');
        const rtUsingFdtAfter = findMenuByName(this.kconfigMenus, 'RT_USING_FDT');
        const rtUsingFdtLibAfter = findMenuByName(this.kconfigMenus, 'RT_USING_FDTLIB');

        Logger.info(`[KCONFIG_SERVER] After updateValue("", null):`);
        if (dfsUsingPosixAfter) {
            Logger.info(`[KCONFIG_SERVER]   DFS_USING_POSIX:`);
            Logger.info(`[KCONFIG_SERVER]     - value: ${dfsUsingPosixAfter.value}`);
            Logger.info(`[KCONFIG_SERVER]     - selectedBy: [${dfsUsingPosixAfter.selectedBy?.join(', ') || 'none'}]`);
            Logger.info(`[KCONFIG_SERVER]     - isReadonly: ${dfsUsingPosixAfter.isReadonly}`);
            Logger.info(`[KCONFIG_SERVER]     - readonlyReason: ${dfsUsingPosixAfter.readonlyReason || 'none'}`);
        }

        if (rtUsingPosixFsAfter) {
            Logger.info(`[KCONFIG_SERVER]   RT_USING_POSIX_FS:`);
            Logger.info(`[KCONFIG_SERVER]     - value: ${rtUsingPosixFsAfter.value}`);
            Logger.info(`[KCONFIG_SERVER]     - select: [${rtUsingPosixFsAfter.select?.join(', ') || 'none'}]`);
        }

        if (rtUsingHookListAfter) {
            Logger.info(`[KCONFIG_SERVER]   RT_USING_HOOKLIST:`);
            Logger.info(`[KCONFIG_SERVER]     - value: ${rtUsingHookListAfter.value}`);
            Logger.info(`[KCONFIG_SERVER]     - selectedBy: [${rtUsingHookListAfter.selectedBy?.join(', ') || 'none'}]`);
            Logger.info(`[KCONFIG_SERVER]     - isReadonly: ${rtUsingHookListAfter.isReadonly}`);
            Logger.info(`[KCONFIG_SERVER]     - readonlyReason: ${rtUsingHookListAfter.readonlyReason || 'none'}`);
        }

        if (rtUsingFdtAfter || rtUsingFdtLibAfter) {
            Logger.info(`[KCONFIG_SERVER]   FDT legacy block (after visibility update):`);
            if (rtUsingFdtAfter) Logger.info(`[KCONFIG_SERVER]     - RT_USING_FDT: value=${rtUsingFdtAfter.value}`);
            if (rtUsingFdtLibAfter) Logger.info(`[KCONFIG_SERVER]     - RT_USING_FDTLIB: value=${rtUsingFdtLibAfter.value}`);
        }
        if (smallMemAfter || slabAfter) {
            Logger.info(`[KCONFIG_SERVER]   Memory allocators (after update):`);
            if (smallMemAfter) Logger.info(`[KCONFIG_SERVER]     - RT_USING_SMALL_MEM: ${smallMemAfter.value}`);
            if (slabAfter) Logger.info(`[KCONFIG_SERVER]     - RT_USING_SLAB: ${slabAfter.value}`);
            if (smallMemHeapAfter) Logger.info(`[KCONFIG_SERVER]     - RT_USING_SMALL_MEM_AS_HEAP: ${smallMemHeapAfter.value}`);
            if (slabHeapAfter) Logger.info(`[KCONFIG_SERVER]     - RT_USING_SLAB_AS_HEAP: ${slabHeapAfter.value}`);
            const heapChoiceAfter = this.findParentChoice('RT_USING_SMALL_MEM_AS_HEAP') || this.findParentChoice('RT_USING_SLAB_AS_HEAP');
            if (heapChoiceAfter) {
                Logger.info(`[KCONFIG_SERVER]     - HEAP CHOICE selected: ${heapChoiceAfter.value}`);
            }
        }

        // Defensive fix: ensure top-level menu blocks (no deps) are visible
        // The refactor to the new parser introduced cases where some menu nodes
        // (e.g., "RT-Thread Kernel", "RT-Thread Components", "General Drivers Configuration")
        // were incorrectly marked invisible. These top-level containers should
        // always be visible when they have a prompt and no explicit dependency.
        const forceTopLevelMenusVisible = (menus: Menu[]) => {
            menus.forEach((m) => {
                if (m.type === menuType.menu && m.hasPrompt && (!m.dependsOn || m.dependsOn.trim() === "")) {
                    m.isVisible = true;
                    // Acts as a container in the UI
                    (m as any).isContainerVisible = true;
                }
            });
        };
        forceTopLevelMenusVisible(this.kconfigMenus);

        // Final check of DFS_USING_POSIX status
        const dfsUsingPosixFinal = findMenuByName(this.kconfigMenus, 'DFS_USING_POSIX');
        const rtUsingHookListFinal = findMenuByName(this.kconfigMenus, 'RT_USING_HOOKLIST');
        if (dfsUsingPosixFinal) {
            Logger.info(`[KCONFIG_SERVER] Final DFS_USING_POSIX status:`);
            Logger.info(`[KCONFIG_SERVER]   - isReadonly: ${dfsUsingPosixFinal.isReadonly}`);
            Logger.info(`[KCONFIG_SERVER]   - selectedBy: [${dfsUsingPosixFinal.selectedBy?.join(', ') || 'none'}]`);
        }

        if (rtUsingHookListFinal) {
            Logger.info(`[KCONFIG_SERVER] Final RT_USING_HOOKLIST status:`);
            Logger.info(`[KCONFIG_SERVER]   - isReadonly: ${rtUsingHookListFinal.isReadonly}`);
            Logger.info(`[KCONFIG_SERVER]   - selectedBy: [${rtUsingHookListFinal.selectedBy?.join(', ') || 'none'}]`);
            Logger.info(`[KCONFIG_SERVER]   - value: ${rtUsingHookListFinal.value}`);
        }

        Logger.info(`[KCONFIG_SERVER] Initialized with ${this.kconfigMenus.length} menus and visibility manager`);
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
    
    public updateValue(updatedMenu: Menu): void {
        // Logger.info(`[UPDATE_VALUE] ========== UPDATE VALUE START ==========`);
        // Logger.info(`[UPDATE_VALUE] Updating menu item: ${updatedMenu.id}`);
        // Logger.info(`[UPDATE_VALUE] Menu name: ${updatedMenu.name}`);
        // Logger.info(`[UPDATE_VALUE] Menu type: ${updatedMenu.type}`);
        // Logger.info(`[UPDATE_VALUE] New value: ${updatedMenu.value}`);
        // Logger.info(`[UPDATE_VALUE] Value type: ${typeof updatedMenu.value}`);
        // Logger.info(`[UPDATE_VALUE] Timestamp: ${new Date().toISOString()}`);
        
        this.unsavedChanges = true;
        
        // Update the value in the menu structure
        const updateMenuValue = (menus: Menu[]): boolean => {
            for (const menu of menus) {
                if (menu.id === updatedMenu.id) {
                    const _oldValue = menu.value;
                    // Logger.info(`[UPDATE_VALUE] Found menu item ${menu.id}, old value: ${oldValue}`);
                    // Logger.info(`[UPDATE_VALUE] Menu item details - name: ${menu.name}, type: ${menu.type}`);
                    
                    // 验证值是否在允许的范围内（针对int和hex类型）
                    let newValue = updatedMenu.value;
                    if ((menu.type === menuType.int || menu.type === menuType.hex) && menu.range && menu.range.length >= 2) {
                        const min = menu.range[0];
                        const max = menu.range[1];
                        const numValue = typeof newValue === 'number' ? newValue : parseInt(newValue.toString(), 10);
                        
                        if (!isNaN(numValue)) {
                            if (numValue < min) {
                                // Logger.warn(`[UPDATE_VALUE] Value ${numValue} is below minimum ${min}, adjusting to ${min}`);
                                newValue = min;
                            } else if (numValue > max) {
                                // Logger.warn(`[UPDATE_VALUE] Value ${numValue} is above maximum ${max}, adjusting to ${max}`);
                                newValue = max;
                            }
                        }
                    }
                    
                    menu.value = newValue;
                    
                    // Logger.info(`[UPDATE_VALUE] Updated ${menu.id} from ${oldValue} to ${menu.value}`);
                    // Logger.info(`[UPDATE_VALUE] Menu item after update - name: ${menu.name}, type: ${menu.type}, value: ${menu.value}`);
                    
                    // Logger.info(`[UPDATE_VALUE] About to update visibility with new value: ${newValue}`);
                    // Save current menus state以便比较自动更新的值与可见性
                    const menusBeforeVisibilityUpdate = JSON.parse(JSON.stringify(this.kconfigMenus));
                    
                    // Update visibility based on the new value
                    this.kconfigMenus = this.visibilityManager.updateValue(menu.id, newValue);
                    // Logger.info(`[UPDATE_VALUE] Visibility update complete`);
                    
                    // Debug select relationships after value update
                    if (process.env.NODE_ENV === 'development') {
                        // Logger.info(`[UPDATE_VALUE] After updating ${menu.name} to ${newValue}:`);
                        // Add debug logging for select relationships
                        // Logger.info(`[UPDATE_VALUE] Debugging select relationships...`);
                    }
                    
                    // Check if visibility actually changed
                    const visibilityChanges = this.collectVisibilityChanges(menusBeforeVisibilityUpdate, this.kconfigMenus);
                    
                    // Logger.info(`[UPDATE_VALUE] Emitting valueChanged event with menu: ${menu.name} = ${menu.value}`);
                    this.emit("valueChanged", menu);

                    // 自动检测其它配置项的值是否因默认值/级联而发生了变化
                    const additionalValueChanges = this.collectValueChanges(menusBeforeVisibilityUpdate, this.kconfigMenus, menu.id);
                    for (const changedMenu of additionalValueChanges) {
                        this.emit("valueChanged", changedMenu);
                    }
                    
                    // Only emit visibilityChanged if visibility actually changed
                    if (visibilityChanges.length > 0) {
                        this.emit("visibilityChanged", visibilityChanges);
                    }
                    
                    // Logger.info(`[UPDATE_VALUE] ========== UPDATE VALUE END ==========`);
                    return true;
                }
                if (menu.children && updateMenuValue(menu.children)) {
                    return true;
                }
            }
            return false;
        };
        
        const found = updateMenuValue(this.kconfigMenus);
        if (!found) {
            // Logger.warn(`[UPDATE_VALUE] Could not find menu item with id: ${updatedMenu.id}`);
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
        this.kconfigMenus = this.visibilityManager.updateValue("", null);

        // Ensure top-level container menus remain visible after recalculation.
        const forceTopLevelMenusVisible = (menus: Menu[]) => {
            menus.forEach((menu) => {
                if (menu.type === menuType.menu && menu.hasPrompt && (!menu.dependsOn || menu.dependsOn.trim() === "")) {
                    menu.isVisible = true;
                    (menu as any).isContainerVisible = true;
                }
                if (menu.children && menu.children.length > 0) {
                    forceTopLevelMenusVisible(menu.children);
                }
            });
        };
        forceTopLevelMenusVisible(this.kconfigMenus);

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

        this.unsavedChanges = false;
        // Logger.info("[DISCARD] Discard changes completed");
        this.emit("changesDiscarded", this.kconfigMenus);
    }
    
    private async loadConfigValues(): Promise<void> {
        try {
            const configContent = await fs.promises.readFile(this.configFile, "utf8");
            const configLines = configContent.split("\n");

            Logger.info(`[LOAD_CONFIG] Reading config file: ${this.configFile}`);
            Logger.info(`[LOAD_CONFIG] Total lines in config: ${configLines.length}`);

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
                        const updateResult = this.updateMenuValueByName(_configName, "n");
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

                    const updateResult = this.updateMenuValueByName(_configName, configValue);
                    if (updateResult) {
                        _processedLines++;
                    }
                    continue;
                }

                _skippedLines++;
            }

            Logger.info(`[LOAD_CONFIG] Processed ${_processedLines} config lines, skipped ${_skippedLines} lines`);

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
                Logger.info(`[LOAD_CONFIG]   choice(System Heap) selected: ${heapChoice.value}`);
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
                        Logger.info(`[CHOICE_RECONCILE] Choice "${menu.title || menu.name}" selected <- ${selected}`);
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
        let found = false;
        
        const updateValue = (menus: Menu[]): void => {
            for (const menu of menus) {
                if (menu.name === name) {
                    const _oldValue = menu.value;
                    // Logger.info(`[UPDATE_VALUE] Found menu item: ${name}, type: ${menu.type}, old value: ${oldValue}, new value: ${value}`);
                    
                    // Parse value based on type
                    switch (menu.type) {
                        case menuType.bool: {
                            menu.value = value === "y";
                            // If this bool belongs to a choice, update the parent choice selection accordingly
                            const parentChoice = this.findParentChoice(name);
                            if (parentChoice) {
                                if (menu.value === true) {
                                    parentChoice.value = name;
                                    // normalize siblings
                                    for (const sibling of parentChoice.children || []) {
                                        if (sibling.name !== name && sibling.type === menuType.bool) {
                                            sibling.value = false;
                                        }
                                    }
                                    Logger.info(`[LOAD_CONFIG] Set parent choice "${parentChoice.title || parentChoice.name}" <- ${name}`);
                                } else if (parentChoice.value === name) {
                                    // If this child is set to n and was the selected one, clear selection
                                    parentChoice.value = null as any;
                                }
                            }
                            // Logger.info(`[UPDATE_VALUE] Bool: ${name} = ${menu.value} (from ${value})`);
                            break;
                        }
                        case menuType.tristate: {
                            let normalized: "y" | "m" | "n" = "n";
                            if (typeof value === "string") {
                                const lower = value.toLowerCase();
                                if (lower === "y") {
                                    normalized = "y";
                                } else if (lower === "m") {
                                    normalized = "m";
                                } else if (lower === "1") {
                                    normalized = "m";
                                } else if (lower === "2") {
                                    normalized = "y";
                                } else {
                                    normalized = "n";
                                }
                            } else if (typeof value === "number") {
                                if (value >= 2) {
                                    normalized = "y";
                                } else if (value === 1) {
                                    normalized = "m";
                                }
                            } else if (typeof value === "boolean") {
                                normalized = value ? "y" : "n";
                            }
                            menu.value = normalized;
                            break;
                        }
                        case menuType.int:
                            menu.value = parseInt(value, 10);
                            // Logger.info(`[UPDATE_VALUE] Int: ${name} = ${menu.value} (from ${value})`);
                            break;
                        case menuType.hex:
                            menu.value = value;
                            // Logger.info(`[UPDATE_VALUE] Hex: ${name} = ${menu.value} (from ${value})`);
                            break;
                        case menuType.string:
                            // Remove quotes from string values
                            menu.value = value.replace(/^"(.*)"$/, "$1");
                            // Logger.info(`[UPDATE_VALUE] String: ${name} = "${menu.value}" (from ${value})`);
                            break;
                        case menuType.choice:
                            // For choice type, the value should be the name of the selected option
                            menu.value = value === "y" ? name : null;
                            // Logger.info(`[UPDATE_VALUE] Choice: ${name} = ${menu.value} (from ${value})`);
                            break;
                        default:
                            menu.value = value;
                            // Logger.info(`[UPDATE_VALUE] Default: ${name} = ${menu.value} (from ${value})`);
                    }
                    
                    found = true;
                }
                if (menu.children) {
                    updateValue(menu.children);
                }
            }
        };
        
        updateValue(this.kconfigMenus);
        return found;
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
        const findParent = (menus: Menu[]): Menu | null => {
            for (const menu of menus) {
                if (menu.type === menuType.choice && menu.children) {
                    for (const child of menu.children) {
                        if (child.name === childName) {
                            return menu;
                        }
                    }
                }
                if (menu.children) {
                    const result = findParent(menu.children);
                    if (result) return result;
                }
            }
            return null;
        };
        
        return findParent(this.kconfigMenus);
    }
    
    private hasVisibilityChanges(oldMenus: Menu[], newMenus: Menu[]): boolean {
        const compareVisibility = (oldItems: Menu[], newItems: Menu[]): boolean => {
            if (oldItems.length !== newItems.length) {
                // Logger.info(`[VISIBILITY_CHECK] Length changed: ${oldItems.length} -> ${newItems.length}`);
                return true;
            }
            
            for (let i = 0; i < oldItems.length; i++) {
                const oldItem = oldItems[i];
                const newItem = newItems[i];
                
                if (oldItem.id !== newItem.id) {
                    // Logger.info(`[VISIBILITY_CHECK] Item order changed at index ${i}: ${oldItem.id} -> ${newItem.id}`);
                    return true;
                }
                
                if (oldItem.isVisible !== newItem.isVisible) {
                    // Logger.info(`[VISIBILITY_CHECK] Visibility changed for ${oldItem.name || oldItem.id}: ${oldItem.isVisible} -> ${newItem.isVisible}`);
                    return true;
                }
                
                // Recursively check children
                if (oldItem.children && newItem.children) {
                    if (compareVisibility(oldItem.children, newItem.children)) {
                        return true;
                    }
                } else if (oldItem.children || newItem.children) {
                    // Logger.info(`[VISIBILITY_CHECK] Children structure changed for ${oldItem.name || oldItem.id}`);
                    return true;
                }
            }
            
            return false;
        };
        
        const hasChanges = compareVisibility(oldMenus, newMenus);
        // Logger.info(`[VISIBILITY_CHECK] Overall visibility changes detected: ${hasChanges}`);
        return hasChanges;
    }

    private collectValueChanges(oldMenus: Menu[], newMenus: Menu[], excludeId?: string): Menu[] {
        const beforeMap = new Map<string, { value: any; type: menuType }>();

        const collectBefore = (menus: Menu[]) => {
            for (const menu of menus) {
                beforeMap.set(menu.id, { value: menu.value, type: menu.type });
                if (menu.children && menu.children.length > 0) {
                    collectBefore(menu.children);
                }
            }
        };

        collectBefore(oldMenus);

        const changed: Menu[] = [];

        const compareAfter = (menus: Menu[]) => {
            for (const menu of menus) {
                if (excludeId && menu.id === excludeId) {
                    if (menu.children && menu.children.length > 0) {
                        compareAfter(menu.children);
                    }
                    continue;
                }

                const before = beforeMap.get(menu.id);
                if (!before || !this.areMenuValuesEqual(before.value, menu.value, before.type)) {
                    changed.push(menu);
                }

                if (menu.children && menu.children.length > 0) {
                    compareAfter(menu.children);
                }
            }
        };

        compareAfter(newMenus);

        return changed;
    }

    private collectVisibilityChanges(oldMenus: Menu[], newMenus: Menu[]): Array<{
        id: string;
        isVisible?: boolean;
        isContainerVisible?: boolean;
        isReadonly?: boolean;
        readonlyReason?: string | undefined;
        selectedBy?: string[] | undefined;
        autoSelectedValue?: boolean | undefined;
        autoImpliedValue?: 'y' | 'm' | boolean | undefined;
        value?: any;
    }> {
        const beforeMap = new Map<string, {
            isVisible?: boolean;
            isContainerVisible?: boolean;
            isReadonly?: boolean;
            readonlyReason?: string;
            selectedBy?: string[];
            autoSelectedValue?: boolean;
            autoImpliedValue?: 'y' | 'm' | boolean;
            value?: any;
        }>();

        const collectBefore = (menus: Menu[]) => {
            for (const menu of menus) {
                beforeMap.set(menu.id, {
                    isVisible: menu.isVisible,
                    isContainerVisible: (menu as any).isContainerVisible,
                    isReadonly: menu.isReadonly,
                    readonlyReason: menu.readonlyReason,
                    selectedBy: menu.selectedBy ? [...menu.selectedBy] : undefined,
                    autoSelectedValue: menu.autoSelectedValue,
                    autoImpliedValue: menu.autoImpliedValue,
                    value: menu.value
                });
                if (menu.children && menu.children.length > 0) {
                    collectBefore(menu.children);
                }
            }
        };

        collectBefore(oldMenus);

        const changes: Array<{
            id: string;
            isVisible?: boolean;
            isContainerVisible?: boolean;
            isReadonly?: boolean;
            readonlyReason?: string | undefined;
            selectedBy?: string[] | undefined;
            autoSelectedValue?: boolean | undefined;
            autoImpliedValue?: 'y' | 'm' | boolean | undefined;
            value?: any;
        }> = [];

        const compareAfter = (menus: Menu[]) => {
            for (const menu of menus) {
                const before = beforeMap.get(menu.id);
                if (!before) {
                    changes.push({
                        id: menu.id,
                        isVisible: menu.isVisible,
                        isContainerVisible: (menu as any).isContainerVisible,
                        isReadonly: menu.isReadonly,
                        readonlyReason: menu.readonlyReason,
                        selectedBy: menu.selectedBy ? [...menu.selectedBy] : undefined,
                        autoSelectedValue: menu.autoSelectedValue,
                        autoImpliedValue: menu.autoImpliedValue,
                        value: menu.value
                    });
                } else {
                    const visibilityDiff = before.isVisible !== menu.isVisible;
                    const containerDiff = before.isContainerVisible !== (menu as any).isContainerVisible;
                    const readonlyDiff = before.isReadonly !== menu.isReadonly;
                    const reasonDiff = before.readonlyReason !== menu.readonlyReason;
                    const selectedByDiff = this.arrayChanged(before.selectedBy, menu.selectedBy);
                    const autoSelectedDiff = before.autoSelectedValue !== menu.autoSelectedValue;
                    const autoImpliedDiff = before.autoImpliedValue !== menu.autoImpliedValue;
                    const valueDiff = before.value !== menu.value && (menu.type === menuType.bool || menu.type === menuType.tristate);

                    if (visibilityDiff || containerDiff || readonlyDiff || reasonDiff || selectedByDiff || autoSelectedDiff || autoImpliedDiff || valueDiff) {
                        changes.push({
                            id: menu.id,
                            isVisible: menu.isVisible,
                            isContainerVisible: (menu as any).isContainerVisible,
                            isReadonly: menu.isReadonly,
                            readonlyReason: menu.readonlyReason,
                            selectedBy: menu.selectedBy ? [...menu.selectedBy] : undefined,
                            autoSelectedValue: menu.autoSelectedValue,
                            autoImpliedValue: menu.autoImpliedValue,
                            value: valueDiff ? menu.value : undefined
                        });
                    }
                }

                if (menu.children && menu.children.length > 0) {
                    compareAfter(menu.children);
                }
            }
        };

        compareAfter(newMenus);

        return changes;
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
    
    public async loadVirtualNodeContent(nodeId: string): Promise<Menu[]> {
        try {
            Logger.info(`[KCONFIG_SERVER] Loading virtual node content for: ${nodeId}`);
            
            if (!this.isRunning) {
                throw new Error("KconfigServer is not running");
            }
            
            // Use the saved menu loader instance to expand the virtual node
            if (!this.menuLoader) {
                throw new Error("MenuLoader not initialized - ensure KconfigServer.start() has been called");
            }
            const loadedChildren = await this.menuLoader.expandPackageNode(nodeId, this.kconfigMenus);
            
            if (loadedChildren.length === 0) {
                Logger.warn(`[KCONFIG_SERVER] No content loaded for virtual node: ${nodeId}`);
                return this.kconfigMenus;
            }
            
            // Find the virtual node in the menu tree and replace its children
            const updateVirtualNode = (menus: Menu[]): boolean => {
                for (const menu of menus) {
                    if (menu.id === nodeId && menu.isVirtual) {
                        Logger.info(`[KCONFIG_SERVER] Found virtual node ${nodeId}, replacing with ${loadedChildren.length} children`);
                        
                        // Replace placeholder children with actual loaded content
                        menu.children = loadedChildren;
                        menu.childrenParsed = true;
                        menu.isVirtual = false; // No longer virtual after loading
                        
                        // Mark all loaded children as visible by default
                        const markChildrenVisible = (children: Menu[]) => {
                            children.forEach(child => {
                                child.isVisible = true;
                                if (child.children) {
                                    markChildrenVisible(child.children);
                                }
                            });
                        };
                        markChildrenVisible(loadedChildren);
                        
                        // 🔑 关键修复：正确设置懒加载内容的折叠状态
                        const applyCorrectCollapseState = (children: Menu[]) => {
                            children.forEach(child => {
                                if (child.isMenuconfig) {
                                    // menuconfig: value=false 时必须折叠，value=true 时展开
                                    child.isCollapsed = child.value !== true;
                                    Logger.info(`[KCONFIG_SERVER] 设置 menuconfig "${child.title}" 折叠状态: ${child.isCollapsed} (value=${child.value})`);
                                } else if (child.type === 'menu') {
                                    // 普通 menu: 默认折叠
                                    child.isCollapsed = child.isCollapsed ?? true;
                                    Logger.info(`[KCONFIG_SERVER] 设置 menu "${child.title}" 折叠状态: ${child.isCollapsed}`);
                                }
                                
                                // 递归处理子节点
                                if (child.children && child.children.length > 0) {
                                    applyCorrectCollapseState(child.children);
                                }
                            });
                        };
                        applyCorrectCollapseState(loadedChildren);
                        
                        return true;
                    }
                    
                    if (menu.children && updateVirtualNode(menu.children)) {
                        return true;
                    }
                }
                return false;
            };
            
            const found = updateVirtualNode(this.kconfigMenus);
            
            if (!found) {
                Logger.warn(`[KCONFIG_SERVER] Virtual node not found in menu tree: ${nodeId}`);
                return this.kconfigMenus;
            }
            
            // Update visibility manager with the new content
            this.visibilityManager.initialize(this.kconfigMenus);
            this.kconfigMenus = this.visibilityManager.updateValue("", null);

            // Keep the same visibility guard for top-level menus after updates
            const forceTopLevelMenusVisible = (menus: Menu[]) => {
                menus.forEach((m) => {
                    if (m.type === menuType.menu && m.hasPrompt && (!m.dependsOn || m.dependsOn.trim() === "")) {
                        m.isVisible = true;
                        (m as any).isContainerVisible = true;
                    }
                });
            };
            forceTopLevelMenusVisible(this.kconfigMenus);
            
            Logger.info(`[KCONFIG_SERVER] Successfully loaded virtual node: ${nodeId}`);
            return this.kconfigMenus;
            
        } catch (error) {
            Logger.error(`[KCONFIG_SERVER] Failed to load virtual node ${nodeId}`, error as Error);
            throw error;
        }
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
