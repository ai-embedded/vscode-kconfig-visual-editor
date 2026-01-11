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

import { Menu, menuType } from "./Menu";
import { ConditionEvaluator, ConfigContext } from "./ConditionEvaluator";
import { Logger } from "../logger/logger";

/**
 * Dependency relationship between configuration items
 */
interface DependencyInfo {
    configId: string;
    dependsOn: string;
    dependents: Set<string>; // Items that depend on this config
}

/**
 * Manages dynamic visibility of menu items based on condition evaluation
 */
export class VisibilityManager {
    private evaluator: ConditionEvaluator;
    private dependencies: Map<string, DependencyInfo> = new Map();
    private configValues: ConfigContext = {};
    private allMenus: Menu[] = [];
    private menuById: Map<string, Menu> = new Map();
    private menuByName: Map<string, Menu> = new Map();
    private menusByName: Map<string, Menu[]> = new Map();
    private modulesSymbolName: string | null = null;
    private dependencyClampCache: Map<string, {
        value: any;
        isDefaultValue?: boolean;
        autoSelectedValue?: boolean;
    }> = new Map();

    constructor() {
        this.evaluator = new ConditionEvaluator();
    }

    private readonly tristateOrder: Array<'n' | 'm' | 'y'> = ['n', 'm', 'y'];

    /**
     * Initialize the visibility manager with menu data
     */
    public initialize(menus: Menu[]): void {
        Logger.debugVisibility(`Initializing with ${menus.length} menus`);
        
        this.allMenus = menus;
        this.rebuildIndexes(menus);
        this.modulesSymbolName = this.detectModulesSymbolName(menus);
        this.buildDependencyGraph(menus);
        this.extractConfigValues(menus);
        this.dependencyClampCache.clear();
        
        Logger.debugVisibility(`Config values before context update:`);
        Logger.debugVisibility(`  BSP_USING_UART: ${this.configValues['BSP_USING_UART']}`);
        Logger.debugVisibility(`  BSP_USING_UART0: ${this.configValues['BSP_USING_UART0']}`);
        
        this.evaluator.updateContext(this.configValues);

        // 在可见性计算前，先应用 config 的默认值（含条件）与 choice 的默认值
        // 这样可保证诸如 “default y if RT_USING_SMART” 按语义生效
        this.applyConfigDefaults();
        this.applyChoiceDefaults();

        // 依赖约束会限制符号的最大取值，需在处理 select 之前先行收敛
        this.enforceDependencyBounds();

        // Process initial select statements for enabled configs
        this.processInitialSelectStatements();

        // Apply imply constraints based on current selections
        this.applyImplyConstraints();

        // Sync allowed tristate ranges with latest state
        this.updateTristateAllowedValues();

        // select 可能修改符号状态，需再次根据依赖进行收敛
        this.enforceDependencyBounds();

        this.updateAllVisibility();
        
        // Update readonly states after initialization
        this.updateReadonlyStates();

        // 特例调试：初始化后输出 FDT 相关状态
        const _fdt = this.findMenuByName('RT_USING_FDT');
        const _fdtlib = this.findMenuByName('RT_USING_FDTLIB');
        if (_fdt || _fdtlib) {
            Logger.info(`[FDT_DEBUG] Initialize: RT_USING_FDT=${_fdt ? _fdt.value : 'N/A'}, RT_USING_FDTLIB=${_fdtlib ? _fdtlib.value : 'N/A'}`);
        }
        
        Logger.debugVisibility(`Initialization complete:`);
        Logger.debugVisibility(`  - Dependencies: ${this.dependencies.size}`);
        Logger.debugVisibility(`  - Config values: ${Object.keys(this.configValues).length}`);
        this.logVisibilityState();
    }

    /**
     * 依赖约束收敛：当直接依赖为假时，将符号的实际值降为禁用状态。
     * 对 bool 设置为 false，对 tristate 设置为 'n'。
     */
    private enforceDependencyBounds(): void {
        const clamp = (menu: Menu) => {
            if (menu.name && menu.dependsOn && (menu.type === menuType.bool || menu.type === menuType.tristate)) {
                let depSatisfied = true;
                try {
                    depSatisfied = this.evaluator.evaluate(menu.dependsOn);
                } catch (error) {
                    Logger.warn(`Failed to evaluate dependency bound for ${menu.name}: ${menu.dependsOn}. Error: ${error}`);
                    depSatisfied = true;
                }

                const cacheKey = menu.id || menu.name;

                if (!depSatisfied) {
                    if (cacheKey && !this.dependencyClampCache.has(cacheKey)) {
                        this.dependencyClampCache.set(cacheKey, {
                            value: menu.value,
                            isDefaultValue: menu.isDefaultValue,
                            autoSelectedValue: menu.autoSelectedValue,
                        });
                    }

                    if (menu.type === menuType.bool) {
                        const forcedValue = false;
                        if (!this.areMenuValuesEqual(menu.value, forcedValue, menu.type)) {
                            menu.value = forcedValue;
                            this.configValues[menu.name] = forcedValue;
                            this.evaluator.setValue(menu.name, forcedValue);
                        } else {
                            this.configValues[menu.name] = forcedValue;
                        }
                    } else if (menu.type === menuType.tristate) {
                        const forcedValue: 'n' = 'n';
                        if (!this.areMenuValuesEqual(menu.value, forcedValue, menu.type)) {
                            menu.value = forcedValue;
                            this.configValues[menu.name] = forcedValue;
                            this.evaluator.setValue(menu.name, forcedValue);
                        } else {
                            this.configValues[menu.name] = forcedValue;
                        }
                    }
                } else if (cacheKey && this.dependencyClampCache.has(cacheKey)) {
                    const cached = this.dependencyClampCache.get(cacheKey);
                    this.dependencyClampCache.delete(cacheKey);

                    if (cached) {
                        const restoredValue = cached.value;
                        if (!this.areMenuValuesEqual(menu.value, restoredValue, menu.type)) {
                            menu.value = restoredValue;
                            if (menu.name) {
                                this.configValues[menu.name] = restoredValue;
                                this.evaluator.setValue(menu.name, restoredValue);
                            }
                        } else if (menu.name) {
                            this.configValues[menu.name] = restoredValue;
                        }

                        if (cached.isDefaultValue !== undefined) {
                            menu.isDefaultValue = cached.isDefaultValue;
                        }
                        if (cached.autoSelectedValue !== undefined) {
                            menu.autoSelectedValue = cached.autoSelectedValue;
                        }

                        // When deps become satisfied again, re-evaluate defaults
                        // for symbols that actually define defaults.
                        if (menu.defaults && menu.defaults.length > 0) {
                            this.reapplyDefaultsForMenu(menu);
                        }
                    }
                }
            }

            if (menu.children) {
                menu.children.forEach(clamp);
            }
        };

        this.allMenus.forEach(clamp);
        this.evaluator.updateContext(this.configValues);
    }

    /**
     * 应用 choice 默认值：
     * - 按顺序评估 "default X [if COND]" 列表
     * - 选中第一个条件满足的 X；若存在无条件默认值，优先采用
     * - 若无匹配，则回退到第一个子选项
     * - 同步更新被选中子项（bool）的值到 true，其它为 false
     */
    private applyChoiceDefaults(changes?: Set<string>): void {
        const process = (menu: Menu) => {
            if (menu.type === 'choice' && menu.children && menu.children.length > 0) {
                // 如果当前值已经是合法的子项名称，保证子项布尔值与之同步即可
                const childNames = new Set(menu.children.map(c => c.name));
                let selectedName: string | null = null;
                let selectionSource: 'child' | 'value' | 'default' | 'fallback' | null = null;

                // 优先：从已有子项布尔值为 true 的项反推 choice 选择（对齐 Kconfiglib 行为）
                for (const child of menu.children) {
                    if (child.type === menuType.bool && child.value === true && childNames.has(child.name)) {
                        selectedName = child.name;
                        selectionSource = 'child';
                    }
                }
                if (selectedName) {
                    Logger.debugVisibility(`[CHOICE_DEFAULT] 从子项值反推 choice 选择: ${selectedName}`);
                }

                if (!selectedName && menu.value && typeof menu.value === 'string' && childNames.has(menu.value)) {
                    selectedName = menu.value;
                    selectionSource = 'value';
                } else if (!selectedName) {
                    // 依据 defaults 列表评估，沿用 Kconfig 语义：首个命中的 default 生效
                    if (menu.defaults && menu.defaults.length > 0) {
                        const effectiveDefault = this.selectEffectiveDefault(menu);
                        if (effectiveDefault && typeof effectiveDefault.value === 'string' && childNames.has(effectiveDefault.value)) {
                            selectedName = effectiveDefault.value;
                            selectionSource = 'default';
                        }
                    }

                    // 若依然没有，则回退到第一个子项
                    if (!selectedName) {
                        selectedName = menu.children[0].name;
                        selectionSource = 'fallback';
                    }
                }

                if (selectedName) {
                    if (menu.value !== selectedName) {
                        menu.value = selectedName;
                        if (changes) {
                            changes.add(menu.id);
                        }
                    }

                    if (selectionSource === 'child') {
                        menu.isDefaultValue = false;
                    } else if (selectionSource === 'default' || selectionSource === 'fallback') {
                        menu.isDefaultValue = true;
                    } else if (selectionSource === 'value') {
                        // 保持现状
                        if (menu.isDefaultValue === undefined) {
                            menu.isDefaultValue = false;
                        }
                    }
                }

                // 同步子项布尔值
                if (selectedName) {
                    for (const child of menu.children) {
                        const isSelected = child.name === selectedName;
                        // 仅在子项为 bool 类型时同步
                        if (child.type === menuType.bool) {
                            if (this.configValues[child.name] !== isSelected || child.value !== isSelected) {
                                this.configValues[child.name] = isSelected;
                                child.value = isSelected;
                                this.evaluator.setValue(child.name, isSelected);
                                if (selectionSource === 'child') {
                                    child.isDefaultValue = false;
                                } else if (selectionSource === 'default' || selectionSource === 'fallback') {
                                    child.isDefaultValue = isSelected;
                                }
                                if (changes) {
                                    changes.add(child.id);
                                }
                            }
                        }
                    }
                }
            }

            if (menu.children) {
                menu.children.forEach(process);
            }
        };

        this.allMenus.forEach(process);
        // 更新上下文（以便后续 select/可见性运算使用最新 choice 选择结果）
        this.evaluator.updateContext(this.configValues);
    }

    /**
     * 解析 default 值并转换为目标类型，同时处理符号引用
     */
    private parseDefaultForType(value: any, type: menuType): any {
        if (value === undefined || value === null) {
            return value;
        }

        const resolved = this.resolveDefaultReference(value);
        const v = typeof resolved === 'string' ? resolved.trim() : resolved;

        switch (type) {
            case menuType.bool:
                if (typeof resolved === 'boolean') return resolved;
                if (typeof resolved === 'number') return resolved !== 0;
                if (typeof v === 'string') {
                    const lower = v.toLowerCase();
                    if (lower === 'y' || lower === 'yes' || lower === 'true' || lower === '1') return true;
                    if (lower === 'n' || lower === 'no' || lower === 'false' || lower === '0') return false;
                }
                return Boolean(resolved);
            case menuType.tristate:
                if (typeof resolved === 'string') {
                    const lower = resolved.toLowerCase();
                    if (lower === 'y' || lower === 'm' || lower === 'n') return lower;
                    if (lower === 'true') return 'y';
                    if (lower === 'false') return 'n';
                }
                if (typeof resolved === 'boolean') {
                    return resolved ? 'y' : 'n';
                }
                if (typeof resolved === 'number') {
                    if (resolved >= 2) return 'y';
                    if (resolved === 1) return 'm';
                    return 'n';
                }
                return 'n';
            case menuType.int:
                if (typeof resolved === 'number') return resolved;
                if (typeof v === 'string') {
                    const parsed = parseInt(v, 10);
                    return Number.isNaN(parsed) ? 0 : parsed;
                }
                return 0;
            case menuType.hex:
                if (typeof v === 'string') {
                    if (v.startsWith('0x') || v.startsWith('0X')) {
                        return v;
                    }
                    const parsed = parseInt(v, 10);
                    return Number.isNaN(parsed) ? '0x0' : `0x${parsed.toString(16)}`;
                }
                if (typeof resolved === 'number') {
                    return `0x${resolved.toString(16)}`;
                }
                return '0x0';
            case menuType.string:
                if (typeof resolved === 'string') {
                    return resolved.replace(/^"(.*)"$/, '$1');
                }
                if (resolved === null || resolved === undefined) {
                    return '';
                }
                return String(resolved);
            default:
                return resolved;
        }
    }

    /**
     * 解析 default 中的符号引用
     */
    private resolveDefaultReference(rawValue: any): any {
        if (typeof rawValue !== 'string') {
            return rawValue;
        }

        const trimmed = rawValue.trim();
        if (/^".*"$/.test(trimmed)) {
            return rawValue;
        }

        if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
            if (Object.prototype.hasOwnProperty.call(this.configValues, trimmed)) {
                return this.configValues[trimmed];
            }
        }

        return rawValue;
    }

    private getFallbackValueForType(type: menuType): any {
        switch (type) {
            case menuType.bool:
                return false;
            case menuType.tristate:
                return 'n';
            case menuType.int:
                return 0;
            case menuType.hex:
                return '0x0';
            case menuType.string:
                return '';
            default:
                return null;
        }
    }

    /**
     * 返回顺序上第一条满足条件的 default 项
     */
    private selectEffectiveDefault(menu: Menu): { value: any; condition?: string } | null {
        if (!menu.defaults || menu.defaults.length === 0) {
            return null;
        }

        for (const def of menu.defaults) {
            let ok = true;
            if (def.condition && def.condition.trim().length > 0) {
                try {
                    ok = this.evaluator.evaluate(def.condition);
                } catch (e) {
                    ok = false;
                    Logger.debugVisibility(`[DEFAULT_EVAL] 评估失败: ${menu.name} default if "${def.condition}" -> ${e}`);
                }
            }
            if (ok) {
                return def;
            }
        }

        return null;
    }

    private areMenuValuesEqual(a: any, b: any, type: menuType): boolean {
        if (type === menuType.int) {
            return Number(a) === Number(b);
        }
        return a === b;
    }

    /**
     * 应用通用 config 默认值：
     * - 按出现顺序评估 default 列表，命中的第一条立即生效
     * - 记录默认来源，便于后续依赖变动重新计算
     */
    private applyConfigDefaults(): void {
        let updatedCount = 0;

        const process = (menu: Menu) => {
            if (!menu.name || menu.type === menuType.menu) {
                if (menu.children) {
                    menu.children.forEach(process);
                }
                return;
            }

            const hasDefaults = !!(menu.defaults && menu.defaults.length > 0);
            const shouldInit = menu.value === undefined || menu.value === null;

            const effectiveDefault = hasDefaults ? this.selectEffectiveDefault(menu) : null;
            const resolvedValue = effectiveDefault
                ? this.parseDefaultForType(effectiveDefault.value, menu.type)
                : this.getFallbackValueForType(menu.type);

            if (shouldInit) {
                menu.value = resolvedValue;
                this.configValues[menu.name] = resolvedValue;
                this.evaluator.setValue(menu.name, resolvedValue);
                menu.isDefaultValue = true;
                updatedCount++;
                if (effectiveDefault) {
                    Logger.debugVisibility(`[DEFAULT_APPLY] ${menu.name} <- ${JSON.stringify(resolvedValue)}${effectiveDefault.condition ? ` (if ${effectiveDefault.condition})` : ''}`);
                }
            } else if (menu.isDefaultValue === undefined) {
                menu.isDefaultValue = hasDefaults ? effectiveDefault !== null : false;
            }

            if (menu.children) {
                menu.children.forEach(process);
            }
        };

        this.allMenus.forEach(process);

        if (updatedCount > 0) {
            this.evaluator.updateContext(this.configValues);
        }

        Logger.debugVisibility(`[DEFAULT_APPLY] 已应用 ${updatedCount} 个配置项默认值`);
    }

    /**
     * 根据最新上下文尝试重新应用 default，当值发生变化时返回 true
     */
    private reapplyDefaultsForMenu(menu: Menu): boolean {
        if (!menu.name || menu.type === menuType.menu) {
            return false;
        }
        if (menu.autoSelectedValue) {
            return false;
        }
        if (menu.isDefaultValue === false) {
            return false;
        }

        const hasDefaults = !!(menu.defaults && menu.defaults.length > 0);
        const effectiveDefault = hasDefaults ? this.selectEffectiveDefault(menu) : null;
        const nextValue = effectiveDefault
            ? this.parseDefaultForType(effectiveDefault.value, menu.type)
            : this.getFallbackValueForType(menu.type);

        if (this.areMenuValuesEqual(menu.value, nextValue, menu.type)) {
            return false;
        }

        const prevValue = menu.value;
        menu.value = nextValue;
        this.configValues[menu.name] = nextValue;
        this.evaluator.setValue(menu.name, nextValue);
        menu.isDefaultValue = true;

        if (menu.type === menuType.bool) {
            this.processSelectStatements(menu, nextValue === true);
        }

        Logger.debugVisibility(`[DEFAULT_REAPPLY] ${menu.name}: ${JSON.stringify(prevValue)} -> ${JSON.stringify(nextValue)}${effectiveDefault?.condition ? ` (if ${effectiveDefault.condition})` : ''}`);
        return true;
    }

    private propagateDefaultsFrom(configId: string): Set<string> {
        const changed = new Set<string>();
        const queue: string[] = [configId];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);

            const depInfo = this.dependencies.get(current);
            if (!depInfo) {
                continue;
            }

            for (const dependentId of depInfo.dependents) {
                const dependentMenu = this.findMenuById(dependentId);
                if (!dependentMenu) {
                    continue;
                }
                const changedHere = this.reapplyDefaultsForMenu(dependentMenu);
                if (changedHere) {
                    changed.add(dependentId);
                    queue.push(dependentId);
                }
            }
        }

        return changed;
    }

    /**
     * Update a configuration value and recalculate affected visibility
     */
    public updateValue(configId: string, newValue: any): Menu[] {
        Logger.debugVisibility(`Updating value for ${configId} to ${newValue}`);
        
        // Update the value in context
        const menu = this.findMenuById(configId);
        if (menu) {
            const _oldValue = this.configValues[menu.name];
            
            menu.value = newValue;
            this.configValues[menu.name] = newValue;
            this.evaluator.setValue(menu.name, newValue);
            menu.isDefaultValue = false;
            
            // 如果用户手动修改了值，清除自动选择标记
            // 这样可以确保用户手动设置的值不会被自动取消选择逻辑影响
            if (menu.autoSelectedValue !== undefined) {
                Logger.debugVisibility(`Clearing auto-selected flag for ${menu.name} due to user modification`);
                menu.autoSelectedValue = undefined;
                menu.autoSelectedPreviousValue = undefined;
                menu.autoSelectedPreviousWasDefault = undefined;
            }

            this.syncSymbolState(menu);
            
            // Process select statements (must be done before updating readonly states)
            if (menu.type === menuType.bool) {
                const isEnabled = newValue === true;
                this.processSelectStatements(menu, isEnabled);
            }
            
            Logger.debugVisibility(`Updated ${menu.name} from ${_oldValue} to ${newValue}`);

            // 特例调试：当切换 RT_USING_FDT 时，打印其子项 RT_USING_FDTLIB 的状态
            if (menu.name === 'RT_USING_FDT') {
                const fdtlib = this.findMenuByName('RT_USING_FDTLIB');
                if (fdtlib) {
                    Logger.info(`[FDT_DEBUG] RT_USING_FDT -> ${newValue}; RT_USING_FDTLIB before visibility update: value=${fdtlib.value}, dependsOn=${fdtlib.dependsOn || 'y'}`);
                }
            }
        }

        // Find all items that depend on this configuration
        const affectedItems = this.findAffectedItems(configId);
        const defaultChanges = this.propagateDefaultsFrom(configId);
        defaultChanges.forEach(itemId => affectedItems.add(itemId));

        const choiceChanges = new Set<string>();
        this.applyChoiceDefaults(choiceChanges);
        choiceChanges.forEach(itemId => affectedItems.add(itemId));

        this.enforceDependencyBounds();
        const implyChanges = this.applyImplyConstraints();
        this.enforceDependencyBounds();
        implyChanges.forEach(itemId => affectedItems.add(itemId));

        this.updateTristateAllowedValues();

        // Recalculate visibility for affected items
        for (const itemId of affectedItems) {
            this.updateItemVisibility(itemId);
        }

        // Choice或依赖可能影响更广泛的项，进行一次全量可见性刷新以保持一致
        this.updateAllVisibility();

        // Update readonly states (must be done after select processing)
        this.updateReadonlyStates();

        Logger.debugVisibility(`Visibility update completed`);

        // 特例调试：若涉及 FDT 相关配置，更新后再次输出状态
        const maybeFdt = this.findMenuByName('RT_USING_FDT');
        const maybeFdtLib = this.findMenuByName('RT_USING_FDTLIB');
        if (maybeFdt || maybeFdtLib) {
            Logger.info(`[FDT_DEBUG] After updateValue(): RT_USING_FDT=${maybeFdt ? maybeFdt.value : 'N/A'}, RT_USING_FDTLIB=${maybeFdtLib ? maybeFdtLib.value : 'N/A'}`);
        }
        return this.allMenus;
    }

    /**
     * Get current configuration context
     */
    public getContext(): ConfigContext {
        return { ...this.configValues };
    }

    /**
     * Get the condition evaluator instance
     */
    public getEvaluator(): ConditionEvaluator {
        return this.evaluator;
    }

    /**
     * Build dependency graph from menu structure
     */
    private buildDependencyGraph(menus: Menu[]): void {
        this.dependencies.clear();

        const processMenu = (menu: Menu) => {
            // Register this menu in dependencies，保留已有的依赖者集合
            let depInfo = this.dependencies.get(menu.id);
            if (!depInfo) {
                depInfo = {
                    configId: menu.id,
                    dependsOn: menu.dependsOn || '',
                    dependents: new Set()
                };
                this.dependencies.set(menu.id, depInfo);
            } else {
                depInfo.dependsOn = menu.dependsOn || depInfo.dependsOn || '';
            }

            // If this menu has dependencies, register reverse dependencies
            if (menu.dependsOn) {
                const referencedConfigs = this.extractReferencedConfigs(menu.dependsOn);
                for (const refConfig of referencedConfigs) {
                    const referencedMenu = this.findMenuByName(refConfig);
                    if (referencedMenu) {
                        let refDepInfo = this.dependencies.get(referencedMenu.id);
                        if (!refDepInfo) {
                            refDepInfo = {
                                configId: referencedMenu.id,
                                dependsOn: referencedMenu.dependsOn || '',
                                dependents: new Set()
                            };
                            this.dependencies.set(referencedMenu.id, refDepInfo);
                        }
                        refDepInfo.dependents.add(menu.id);
                    }
                }
            }

            if (menu.defaults && menu.defaults.length > 0) {
                for (const def of menu.defaults) {
                    const refs = new Set<string>();
                    if (def.condition && def.condition.trim().length > 0) {
                        this.extractReferencedConfigs(def.condition).forEach(name => refs.add(name));
                    }
                    if (typeof def.value === 'string' && def.value.trim().length > 0) {
                        const raw = def.value.trim().replace(/^"(.*)"$/, '$1');
                        this.extractReferencedConfigs(raw).forEach(name => refs.add(name));
                    }

                    refs.forEach(refConfig => {
                        const referencedMenu = this.findMenuByName(refConfig);
                        if (!referencedMenu) {
                            return;
                        }
                        let refDepInfo = this.dependencies.get(referencedMenu.id);
                        if (!refDepInfo) {
                            refDepInfo = {
                                configId: referencedMenu.id,
                                dependsOn: referencedMenu.dependsOn || '',
                                dependents: new Set()
                            };
                            this.dependencies.set(referencedMenu.id, refDepInfo);
                        }
                        refDepInfo.dependents.add(menu.id);
                    });
                }
            }

            // Process children recursively
            if (menu.children) {
                menu.children.forEach(processMenu);
            }
        };

        menus.forEach(processMenu);
    }

    /**
     * Extract configuration values from menu structure
     */
    private extractConfigValues(menus: Menu[]): void {
        
        const extractValues = (menu: Menu) => {
            
            // Extract all configuration values, including false and 0
            if (menu.name && menu.value !== undefined && menu.value !== null) {
                this.configValues[menu.name] = menu.value;
            } else if (menu.name && menu.type !== menuType.menu) {
                // For config items without explicit values, only set defaults if truly needed
                // DO NOT override values that were set during parsing
                
                switch (menu.type) {
                    case menuType.bool:
                        // Only set default if value is truly not set
                        this.configValues[menu.name] = false; // Default bool to false for context
                        // DO NOT modify menu.value here - it may have been set during parsing
                        break;
                    case menuType.tristate:
                        this.configValues[menu.name] = 'n';
                        break;
                    case menuType.int:
                        this.configValues[menu.name] = 0; // Default int to 0 for context
                        // DO NOT modify menu.value here
                        break;
                    case menuType.string:
                        this.configValues[menu.name] = ""; // Default string to empty for context
                        // DO NOT modify menu.value here
                        break;
                    case menuType.hex:
                        this.configValues[menu.name] = "0x0"; // Default hex to 0x0 for context
                        // DO NOT modify menu.value here
                        break;
                    default:
                        this.configValues[menu.name] = null;
                }
            }
            
            if (menu.children) {
                menu.children.forEach(extractValues);
            }
        };

        menus.forEach(extractValues);
        
    }

    /**
     * Extract referenced configuration names from a condition expression
     */
    private extractReferencedConfigs(expression: string): string[] {
        const configs: Set<string> = new Set();
        
        // Match configuration variable names (letters, numbers, underscores)
        const matches = expression.match(/\b[A-Z][A-Z0-9_]*\b/g);
        if (matches) {
            matches.forEach(match => {
                // Filter out keywords and operators
                if (!this.isKeyword(match)) {
                    configs.add(match);
                }
            });
        }

        return Array.from(configs);
    }

    /**
     * Check if a string is a keyword or operator
     */
    private isKeyword(str: string): boolean {
        const keywords = new Set(['TRUE', 'FALSE', 'Y', 'N', 'M']);
        return keywords.has(str.toUpperCase());
    }

    private rebuildIndexes(menus: Menu[]): void {
        this.menuById.clear();
        this.menuByName.clear();
        this.menusByName.clear();

        const stack: Menu[] = [...menus];
        while (stack.length > 0) {
            const menu = stack.pop();
            if (!menu) {
                continue;
            }

            if (menu.id) {
                this.menuById.set(menu.id, menu);
            }

            if (menu.name) {
                if (!this.menuByName.has(menu.name)) {
                    this.menuByName.set(menu.name, menu);
                }
                const group = this.menusByName.get(menu.name) ?? [];
                group.push(menu);
                this.menusByName.set(menu.name, group);
            }

            if (menu.children && menu.children.length > 0) {
                for (let i = 0; i < menu.children.length; i++) {
                    stack.push(menu.children[i]);
                }
            }
        }
    }

    /**
     * Find menu item by ID
     */
    private findMenuById(id: string): Menu | null {
        if (!id) {
            return null;
        }
        return this.menuById.get(id) ?? null;
    }

    private detectModulesSymbolName(menus: Menu[]): string | null {
        let detected: string | null = null;

        const traverse = (items: Menu[]): void => {
            for (const item of items) {
                if (!item) {
                    continue;
                }
                if (!detected && item.name) {
                    if (item.optionModules) {
                        detected = item.name;
                        return;
                    }
                }
                if (item.children && item.children.length > 0) {
                    traverse(item.children);
                    if (detected) {
                        return;
                    }
                }
            }
        };

        traverse(menus);

        if (!detected) {
            const fallback = this.findMenuByName('MODULES');
            if (fallback && fallback.name) {
                detected = fallback.name;
            }
        }

        if (!detected) {
            Logger.debugVisibility('[MODULES] No modules symbol detected; module support disabled by default');
        } else {
            Logger.debugVisibility(`[MODULES] Using modules symbol: ${detected}`);
        }

        return detected;
    }

    /**
     * Find menu item by configuration name
     */
    private findMenuByName(name: string): Menu | null {
        if (!name) {
            return null;
        }
        return this.menuByName.get(name) ?? null;
    }

    private getMenusByName(name: string): Menu[] {
        if (!name) {
            return [];
        }
        return this.menusByName.get(name) ?? [];
    }

    private mergeSelectedByForName(name: string): string[] {
        const merged = new Set<string>();
        for (const menu of this.getMenusByName(name)) {
            if (menu.selectedBy) {
                menu.selectedBy.forEach((selector) => merged.add(selector));
            }
        }
        return Array.from(merged);
    }

    private syncSymbolState(source: Menu): void {
        if (!source.name) {
            return;
        }
        const group = this.getMenusByName(source.name);
        if (group.length <= 1) {
            return;
        }

        const selectedBy = this.mergeSelectedByForName(source.name);

        for (const menu of group) {
            if (menu === source) {
                continue;
            }
            menu.value = source.value;
            menu.isDefaultValue = source.isDefaultValue;
            menu.autoSelectedValue = source.autoSelectedValue;
            menu.autoSelectedPreviousValue = source.autoSelectedPreviousValue;
            menu.autoSelectedPreviousWasDefault = source.autoSelectedPreviousWasDefault;
            menu.selectedBy = [...selectedBy];
        }
    }

    private normalizeTristateValue(value: any): 'n' | 'm' | 'y' {
        if (typeof value === 'string') {
            const lower = value.toLowerCase();
            if (lower === 'y' || lower === 'm' || lower === 'n') {
                return lower as 'n' | 'm' | 'y';
            }
            if (lower === 'true' || lower === '2') {
                return 'y';
            }
            if (lower === '1') {
                return 'm';
            }
            return 'n';
        }
        if (typeof value === 'number') {
            if (value >= 2) {
                return 'y';
            }
            if (value === 1) {
                return 'm';
            }
            return 'n';
        }
        if (typeof value === 'boolean') {
            return value ? 'y' : 'n';
        }
        return 'n';
    }

    private clampTristateValue(allowed: Array<'n' | 'm' | 'y'>, current: 'n' | 'm' | 'y'): 'n' | 'm' | 'y' {
        const currentIndex = this.tristateOrder.indexOf(current);
        if (currentIndex === -1) {
            return allowed[0];
        }

        for (let i = currentIndex; i < this.tristateOrder.length; i++) {
            const candidate = this.tristateOrder[i];
            if (allowed.includes(candidate)) {
                return candidate;
            }
        }

        for (let i = currentIndex - 1; i >= 0; i--) {
            const candidate = this.tristateOrder[i];
            if (allowed.includes(candidate)) {
                return candidate;
            }
        }

        return allowed[0];
    }

    private getMenuTriStrength(menu: Menu | null): number {
        if (!menu) {
            return 0;
        }
        const value = menu.value;
        if (menu.type === menuType.bool) {
            if (value === true || value === 'y' || value === 2) {
                return 2;
            }
            return 0;
        }
        if (menu.type === menuType.tristate) {
            if (value === 'y' || value === true || value === 2) {
                return 2;
            }
            if (value === 'm' || value === 1) {
                return 1;
            }
            return 0;
        }
        return 0;
    }

    private setMenuStrength(menu: Menu, strength: number): void {
        if (!menu || !menu.name) {
            return;
        }

        if (menu.type === menuType.bool) {
            const nextValue = strength > 0;
            if (menu.value !== nextValue) {
                menu.value = nextValue;
                this.configValues[menu.name] = nextValue;
                this.evaluator.setValue(menu.name, nextValue);
            }
            menu.autoImpliedValue = nextValue;
            return;
        }

        if (menu.type === menuType.tristate) {
            const nextValue = strength >= 2 ? 'y' : strength === 1 ? 'm' : 'n';
            if (menu.value !== nextValue) {
                menu.value = nextValue;
                this.configValues[menu.name] = nextValue;
                this.evaluator.setValue(menu.name, nextValue);
            }
            if (strength > 0) {
                menu.autoImpliedValue = nextValue as 'y' | 'm';
            }
            return;
        }
    }

    private applyImplyConstraints(): Set<string> {
        const impliedStrength = new Map<string, number>();
        const impliedTargets = new Set<string>();
        const changedMenus = new Set<string>();

        const traverse = (menu: Menu): void => {
            if (menu.implies && menu.implies.length > 0) {
                const sourceStrength = this.getMenuTriStrength(menu);
                if (sourceStrength > 0) {
                    for (const targetName of menu.implies) {
                        const condition = menu.implyConditions?.[targetName];
                        if (condition && !this.safeEval(condition)) {
                            continue;
                        }

                        let effectiveStrength = sourceStrength;
                        if (menu.type === menuType.bool && effectiveStrength > 0) {
                            effectiveStrength = 2;
                        }

                        const existing = impliedStrength.get(targetName) ?? 0;
                        const nextStrength = Math.max(existing, effectiveStrength);
                        impliedStrength.set(targetName, nextStrength);
                        impliedTargets.add(targetName);
                    }
                }
            }

            if (menu.children) {
                menu.children.forEach(traverse);
            }
        };

        this.allMenus.forEach(traverse);

        impliedStrength.forEach((strength, targetName) => {
            const targetMenu = this.findMenuByName(targetName);
            if (!targetMenu) {
                return;
            }

            const currentStrength = this.getMenuTriStrength(targetMenu);
            if (strength > currentStrength) {
                this.setMenuStrength(targetMenu, strength);
                if (targetMenu.id) {
                    changedMenus.add(targetMenu.id);
                }
            }
        });

        // Clear auto implied marker for items no longer implied in this pass
        const clearMarker = (menu: Menu) => {
            if (menu.autoImpliedValue !== undefined && menu.name && !impliedTargets.has(menu.name)) {
                menu.autoImpliedValue = undefined;
            }
            if (menu.children) {
                menu.children.forEach(clearMarker);
            }
        };
        this.allMenus.forEach(clearMarker);

        if (changedMenus.size > 0) {
            this.evaluator.updateContext(this.configValues);
        }

        return changedMenus;
    }

    private updateTristateAllowedValues(): void {
        const modulesEnabled = this.isModulesEnabled();

        const determineAllowed = (menu: Menu): Array<'n' | 'm' | 'y'> | undefined => {
            if (menu.type !== menuType.tristate) {
                return undefined;
            }

            const allowed = new Set<'n' | 'm' | 'y'>(this.tristateOrder);

            if (!modulesEnabled) {
                allowed.delete('m');
            }

            const implied = menu.autoImpliedValue;
            let impliedState: 'y' | 'm' | undefined;

            if (typeof implied === 'string') {
                const lower = implied.toLowerCase();
                if (lower === 'y') {
                    impliedState = 'y';
                } else if (lower === 'm') {
                    impliedState = 'm';
                }
            } else if (implied === true) {
                impliedState = 'y';
            }

            if (impliedState === 'y') {
                allowed.delete('m');
            } else if (impliedState === 'm') {
                allowed.delete('n');
                allowed.add('m');
            }

            if (menu.isReadonly && menu.value === 'y') {
                allowed.delete('n');
                allowed.delete('m');
            }

            const sorted = this.tristateOrder.filter(v => allowed.has(v));
            return sorted.length > 0 ? sorted : undefined;
        };

        const apply = (menus: Menu[]) => {
            for (const menu of menus) {
                const allowed = determineAllowed(menu);
                if (allowed) {
                    menu.allowedTristateValues = allowed;
                    if (menu.name) {
                        const normalized = this.normalizeTristateValue(menu.value);
                        if (!allowed.includes(normalized)) {
                            const replacement = this.clampTristateValue(allowed, normalized);
                            if (menu.value !== replacement) {
                                Logger.debugVisibility(`[MODULES] Adjusting ${menu.name} from ${menu.value} -> ${replacement} due to modules constraints`);
                                menu.value = replacement;
                            }
                            this.configValues[menu.name] = replacement;
                            this.evaluator.setValue(menu.name, replacement);
                            if (menu.isDefaultValue !== false) {
                                menu.isDefaultValue = true;
                            }
                        }
                    }
                } else if (menu.allowedTristateValues) {
                    delete menu.allowedTristateValues;
                }

                if (menu.children) {
                    apply(menu.children);
                }
            }
        };

        apply(this.allMenus);
    }

    private isModulesEnabled(): boolean {
        if (!this.modulesSymbolName) {
            return false;
        }

        const value = this.configValues[this.modulesSymbolName];
        if (value === undefined || value === null) {
            return false;
        }

        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'number') {
            return value >= 1;
        }

        if (typeof value === 'string') {
            const lower = value.toLowerCase();
            if (lower === 'y' || lower === 'yes' || lower === 'true' || lower === '1') {
                return true;
            }
            if (lower === 'm' || lower === '2') {
                return true;
            }
            return false;
        }

        return false;
    }

    /**
     * Find all items that are affected by a configuration change
     */
    private findAffectedItems(configId: string): Set<string> {
        const affected = new Set<string>();
        const toProcess = new Set<string>([configId]);
        const processed = new Set<string>();

        while (toProcess.size > 0) {
            const currentId = toProcess.values().next().value;
            toProcess.delete(currentId);
            
            if (processed.has(currentId)) {
                continue;
            }
            processed.add(currentId);

            const depInfo = this.dependencies.get(currentId);
            if (depInfo) {
                // Add all dependents of this item
                depInfo.dependents.forEach(dependent => {
                    if (!processed.has(dependent)) {
                        affected.add(dependent);
                        toProcess.add(dependent);
                    }
                });
            }
        }

        return affected;
    }

    /**
     * Process select statements for all initially enabled configs
     */
    private processInitialSelectStatements(): void {
        Logger.debugSelect('[INITIAL_SELECT] Processing initial select statements...');

        let processedCount = 0;
        let enabledWithSelectCount = 0;

        const processMenu = (menu: Menu) => {
            processedCount++;

            // Process select statements for boolean configs that are effectively enabled
            if (menu.type === "bool" && this.isSelectorEffectivelyEnabled(menu) && menu.select && menu.select.length > 0) {
                enabledWithSelectCount++;
                Logger.debugSelect(`[INITIAL_SELECT] Processing ${menu.name} (enabled with ${menu.select.length} select targets)`);
                this.processSelectStatements(menu, true);
            } else if (menu.type === "bool" && menu.select && menu.select.length > 0) {
                Logger.debugSelect(`[INITIAL_SELECT] Skipping ${menu.name} (value=${menu.value}, deps=${menu.dependsOn || '(none)'}, has ${menu.select.length} select targets but not effectively enabled)`);
            }
            
            // 特别处理没有 prompt 但有默认值的配置项
            if (menu.type === "bool" && !menu.hasPrompt && menu.value === undefined && menu.defaults && menu.defaults.length > 0) {
                // 评估默认值条件
                for (const defaultDef of menu.defaults) {
                    if (!defaultDef.condition) {
                        // 无条件默认值
                        menu.value = defaultDef.value;
                        this.configValues[menu.name] = defaultDef.value;
                        break;
                    } else {
                        // 有条件默认值
                        try {
                            const conditionResult = this.evaluator.evaluate(defaultDef.condition);
                            if (conditionResult) {
                                menu.value = defaultDef.value;
                                this.configValues[menu.name] = defaultDef.value;
                                break;
                            }
                        } catch (error) {
                            Logger.warn(`Failed to evaluate default condition for ${menu.name}: ${defaultDef.condition}`);
                        }
                    }
                }
                
                // 如果设置了值且为true，处理select语句
                if (this.isSelectorEffectivelyEnabled(menu) && menu.select && menu.select.length > 0) {
                    this.processSelectStatements(menu, true);
                }
            }
            
            if (menu.children) {
                menu.children.forEach(processMenu);
            }
        };

        this.allMenus.forEach(processMenu);

        Logger.debugSelect(`[INITIAL_SELECT] Initial select processing completed:`);
        Logger.debugSelect(`[INITIAL_SELECT]   - Total menus processed: ${processedCount}`);
        Logger.debugSelect(`[INITIAL_SELECT]   - Enabled menus with select statements: ${enabledWithSelectCount}`);

        // Update evaluator context after processing selects
        this.evaluator.updateContext(this.configValues);

    }

    /**
     * Update visibility for a specific item
     * Visibility = hasPrompt && dependency_condition
     * Non-prompt items are never visible according to Kconfig specification
     * BUT: Implicit containers (no prompt but with visible children) should allow their children to show
     */
    private updateItemVisibility(itemId: string): void {
        const menu = this.findMenuById(itemId);
        if (!menu) {
            return;
        }

        // Ensure menu and menuconfig blocks with a prompt are always treated as having a prompt
        // Some parsers or transformations may omit hasPrompt on menu nodes even
        // when they clearly have a title. Guard against that here so container
        // menus don't disappear from the UI.
        if ((menu.type === menuType.menu || menu.isMenuconfig === true) && !!menu.title && menu.hasPrompt !== true) {
            menu.hasPrompt = true;
        }

        // Debug: 专门追踪 RT_MAIN_THREAD 和 RT_USING_USER_MAIN 相关配置项
        

        // Special handling for implicit containers
        // Following Kconfiglib's behavior: invisible symbols with visible children are shown
        if (!menu.hasPrompt) {
            // Check if this is an implicit container (no prompt but has children that could be visible)
            if (menu.isImplicitContainer) {
                // For implicit containers, we need to check if they have visible children
                // The container itself isn't visible as a config item, but it acts as a container
                menu.isVisible = false; // The config itself is not visible
                menu.isContainerVisible = true; // But it acts as a visible container for its children
            } else {
                menu.isVisible = false;
                menu.isContainerVisible = false;
            }
            // Continue to evaluate dependencies for children
        }

        const depInfo = this.dependencies.get(itemId);
        if (!depInfo || !depInfo.dependsOn) {
            // If has prompt and no dependencies -> visible
            if (menu.hasPrompt) {
                menu.isVisible = true;
                menu.isContainerVisible = true;
            }
            return;
        }

        try {
            
            // Evaluate dependencies
            const dependencyResult = this.evaluator.evaluate(depInfo.dependsOn);
            
            // Visibility depends on both having a prompt and dependency evaluation
            if (menu.hasPrompt) {
                menu.isVisible = dependencyResult;
                menu.isContainerVisible = dependencyResult;
            } else if (menu.isImplicitContainer) {
                // No prompt but is an implicit container - check if dependencies are met
                // The config itself is not visible, but it can act as a container if dependencies are met
                menu.isVisible = false;
                menu.isContainerVisible = dependencyResult; // Container is visible if dependencies are met
            } else {
                // No prompt and not an implicit container
                menu.isVisible = false;
                menu.isContainerVisible = false;
            }
            
        } catch (error) {
            Logger.warn(`Failed to evaluate visibility for ${menu.name}: ${depInfo.dependsOn}. Error: ${error}`);
            // Default to visible if evaluation fails, but only if hasPrompt is true
            menu.isVisible = menu.hasPrompt ? true : false;
            menu.isContainerVisible = menu.hasPrompt ? true : (menu.isImplicitContainer ? true : false);
        }
    }

    /**
     * Update visibility for all items
     */
    private updateAllVisibility(): void {
        const updateVisibility = (menu: Menu) => {
            this.updateItemVisibility(menu.id);
            
            if (menu.children) {
                menu.children.forEach(updateVisibility);
            }
        };

        this.allMenus.forEach(updateVisibility);
    }

    /**
     * Get dependency information for debugging
     */
    public getDependencyInfo(): Map<string, DependencyInfo> {
        return new Map(this.dependencies);
    }

    /**
     * Check if a configuration has dependents
     */
    public hasDependents(configId: string): boolean {
        const depInfo = this.dependencies.get(configId);
        return depInfo ? depInfo.dependents.size > 0 : false;
    }

    /**
     * Get all dependents of a configuration
     */
    public getDependents(configId: string): string[] {
        const depInfo = this.dependencies.get(configId);
        return depInfo ? Array.from(depInfo.dependents) : [];
    }

    /**
     * Process select statements when a config is enabled or disabled
     */
    private processSelectStatements(menu: Menu, isEnabled: boolean): void {
        // 依据 Kconfiglib 语义：仅当选择器自身值为 true 且直接依赖满足时，select 才生效
        const depsOk = !menu.dependsOn || this.safeEval(menu.dependsOn);
        const effectivelyEnabled = isEnabled && depsOk && menu.value === true && menu.type === menuType.bool;

        Logger.debugSelect(`Processing select statements for ${menu.name}, enabled: ${isEnabled}, depsOk=${depsOk}, effective=${effectivelyEnabled}`);
        Logger.debugSelect(`Menu ${menu.name} has ${menu.select?.length || 0} select targets`);
        
        if (!menu.select || menu.select.length === 0) {
            Logger.debugSelect(`No select targets for ${menu.name}, returning`);
            return;
        }
        
        Logger.debugSelect(`Select targets for ${menu.name}: ${menu.select.join(', ')}`);
        
        for (const selectTarget of menu.select) {
            // Check if there's a condition for this select statement
            const selectCondition = menu.selectConditions?.[selectTarget];
            if (selectCondition) {
                // Evaluate the condition
                const conditionMet = this.evaluator.evaluate(selectCondition);
                Logger.debugSelect(`Select ${selectTarget} has condition "${selectCondition}", evaluated to: ${conditionMet}`);
                if (!conditionMet) {
                    Logger.debugSelect(`Skipping select ${selectTarget} as condition is not met`);
                    continue;
                }
            }
            
            const targetMenu = this.findMenuByName(selectTarget);
            Logger.debugSelect(`Processing select target ${selectTarget}, found: ${targetMenu ? 'yes' : 'no'}`);
            if (targetMenu) {
                Logger.debugSelect(`Target menu ${targetMenu.name} current selectedBy: ${targetMenu.selectedBy?.join(', ') || 'none'}`);
                if (effectivelyEnabled) {
                    // 启用选择器时的处理
                    this.addSelectRelationship(menu, targetMenu);
                    this.autoSelectTarget(targetMenu, menu);
                } else {
                    // 禁用选择器时的处理
                    this.removeSelectRelationship(menu, targetMenu);
                    this.checkAutoDeselectTarget(targetMenu, menu);
                }
                Logger.debugSelect(`Target menu ${targetMenu.name} updated selectedBy: ${targetMenu.selectedBy?.join(', ') || 'none'}`);
            } else {
                Logger.debugSelect(`Select target ${selectTarget} not found for ${menu.name}`);
            }
        }
    }

    // 安全求值布尔条件（失败返回 false，避免误选）
    private safeEval(expr: string): boolean {
        try {
            return this.evaluator.evaluate(expr);
        } catch (e) {
            Logger.debugSelect(`[SELECT_EVAL] Failed to evaluate expression: ${expr}. Error: ${e}`);
            return false;
        }
    }

    /**
     * Add select relationship between selector and target
     */
    private addSelectRelationship(selector: Menu, target: Menu): void {
        if (!target.selectedBy) {
            target.selectedBy = [];
        }
        if (!target.selectedBy.includes(selector.name)) {
            target.selectedBy.push(selector.name);
            Logger.debugSelect(`Added ${selector.name} as selector for ${target.name}`);
            this.syncSymbolState(target);
        }
    }

    /**
     * Remove select relationship between selector and target
     */
    private removeSelectRelationship(selector: Menu, target: Menu): void {
        if (target.selectedBy) {
            const index = target.selectedBy.indexOf(selector.name);
            if (index > -1) {
                target.selectedBy.splice(index, 1);
                // Logger.info(`[SELECT_PROCESSOR] Removed ${selector.name} as selector for ${target.name}`);
                this.syncSymbolState(target);
            }
        }
    }

    /**
     * Auto-select target when selector is enabled
     */
    private autoSelectTarget(target: Menu, selector: Menu): void {
        if (target.type === menuType.bool) {
            Logger.debugSelect(`[SELECT_PROCESSOR] Auto-selecting ${target.name} due to ${selector.name}`);

            if (target.autoSelectedValue === undefined) {
                target.autoSelectedPreviousValue = target.value;
                target.autoSelectedPreviousWasDefault = target.isDefaultValue;
            }

            // 无论当前值如何，都确保目标被选中并标记为自动选择
            target.value = true;
            target.autoSelectedValue = true; // 标记为自动选择的值
            target.isDefaultValue = false;
            this.configValues[target.name] = true;
            this.evaluator.setValue(target.name, true);
            this.syncSymbolState(target);

            Logger.debugSelect(`[SELECT_PROCESSOR] ${target.name} set to true and marked as auto-selected`);

            // 递归处理新选择项的 select 语句
            if (target.select && target.select.length > 0) {
                Logger.debugSelect(`[SELECT_PROCESSOR] Processing ${target.name}'s select statements recursively`);
                this.processSelectStatements(target, true);
            }
        } else {
            Logger.debugSelect(`[SELECT_PROCESSOR] Skipping auto-select for ${target.name} (not bool type, is ${target.type})`);
        }
    }

    /**
     * Check if target should be auto-deselected when selector is disabled
     */
    private checkAutoDeselectTarget(target: Menu, selector: Menu): void {
        // 检查是否还有其他活跃的选择器
        const hasOtherActiveSelectors = target.selectedBy && target.selectedBy.some(selectorName => {
            if (selectorName === selector.name) return false;
            const selectorMenu = this.findMenuByName(selectorName);
            return selectorMenu && selectorMenu.value === true;
        });
        
        // 如果没有其他活跃的选择器，且当前值是自动选择的，则取消选择
        if (!hasOtherActiveSelectors && target.autoSelectedValue) {
            const previousValue = target.autoSelectedPreviousValue;
            const previousWasDefault = target.autoSelectedPreviousWasDefault;
            const fallbackValue = this.getFallbackValueForType(target.type);
            const restoredValue = previousValue !== undefined ? previousValue : fallbackValue;

            Logger.debugSelect(`[SELECT_PROCESSOR] Restoring ${target.name} to ${JSON.stringify(restoredValue)} with fallback ${JSON.stringify(fallbackValue)}`);

            target.value = restoredValue;
            target.autoSelectedValue = undefined; // 清除自动选择标记
            target.autoSelectedPreviousValue = undefined;
            target.autoSelectedPreviousWasDefault = undefined;

            if (previousWasDefault !== undefined) {
                target.isDefaultValue = previousWasDefault;
            } else if (restoredValue === fallbackValue) {
                target.isDefaultValue = true;
            } else {
                target.isDefaultValue = false;
            }

            this.configValues[target.name] = restoredValue;
            this.evaluator.setValue(target.name, restoredValue);
            
            // 递归处理被取消选择项的 select 语句或恢复用户选择
            if (target.select && target.select.length > 0 && target.type === menuType.bool) {
                const isEnabledAfterRestore = restoredValue === true;
                this.processSelectStatements(target, isEnabledAfterRestore);
            }
            this.syncSymbolState(target);
        } else if (!hasOtherActiveSelectors && target.value === true) {
            // 如果值不是自动选择的（用户手动设置），则保留当前值但记录信息
            // Logger.info(`[SELECT_PROCESSOR] ${target.name} no longer has active selectors, but keeping user-set value`);
        }
    }

    /**
     * Update readonly states for all menu items based on selectedBy relationships
     */
    private updateReadonlyStates(): void {
        Logger.debugVisibility('[READONLY_PROCESSOR] Starting readonly states update...');

        let totalProcessed = 0;
        let readonlyCount = 0;
        let selectedByCount = 0;

        const updateReadonly = (menu: Menu) => {
            totalProcessed++;

            // Reset readonly state
            const wasReadonly = menu.isReadonly;
            menu.isReadonly = false;
            menu.readonlyReason = undefined;

            // Check if this menu has selectedBy relationships
            if (menu.selectedBy && menu.selectedBy.length > 0) {
                selectedByCount++;
                Logger.debugVisibility(`[READONLY_PROCESSOR] Processing ${menu.name} with selectedBy: [${menu.selectedBy.join(', ')}]`);

                // Find all active selectors
                const activeSelectors = menu.selectedBy.filter(selectorName => {
                    const selectorMenu = this.findMenuByName(selectorName);
                    const isActive = selectorMenu ? this.isSelectorEffectivelyEnabled(selectorMenu) : false;
                    Logger.debugVisibility(`[READONLY_PROCESSOR] Checking selector ${selectorName} for ${menu.name}:`);
                    Logger.debugVisibility(`[READONLY_PROCESSOR]   - Found selector: ${!!selectorMenu}`);
                    if (selectorMenu) {
                        Logger.debugVisibility(`[READONLY_PROCESSOR]   - Selector type: ${selectorMenu.type}`);
                        Logger.debugVisibility(`[READONLY_PROCESSOR]   - Selector value: ${selectorMenu.value} (type: ${typeof selectorMenu.value})`);
                        Logger.debugVisibility(`[READONLY_PROCESSOR]   - Selector dependsOn: ${selectorMenu.dependsOn || '(none)'}`);
                        Logger.debugVisibility(`[READONLY_PROCESSOR]   - Is active (value && deps): ${isActive}`);
                    }
                    return isActive;
                });

                Logger.debugVisibility(`[READONLY_PROCESSOR] Active selectors for ${menu.name}: [${activeSelectors.join(', ')}]`);

                if (activeSelectors.length > 0) {
                    menu.isReadonly = true;
                    readonlyCount++;

                    // Provide detailed readonly reason
                    if (activeSelectors.length === 1) {
                        menu.readonlyReason = `此选项被 ${activeSelectors[0]} 自动选择`;
                    } else {
                        menu.readonlyReason = `此选项被以下配置自动选择: ${activeSelectors.join(', ')}`;
                    }

                    Logger.debugVisibility(`[READONLY_PROCESSOR] ✓ ${menu.name} is now READONLY due to active selectors: ${activeSelectors.join(', ')}`);

                    // Auto-select the item if it has active selectors
                    if (menu.type === 'bool' && menu.value !== true) {
                        Logger.debugVisibility(`[READONLY_PROCESSOR] Auto-selecting ${menu.name} due to select relationship`);
                        if (menu.autoSelectedValue === undefined) {
                            menu.autoSelectedPreviousValue = menu.value;
                            menu.autoSelectedPreviousWasDefault = menu.isDefaultValue;
                        }
                        menu.value = true;
                        menu.autoSelectedValue = true;
                        menu.isDefaultValue = false;
                        this.configValues[menu.name] = true;
                        this.evaluator.setValue(menu.name, true);
                    }
                } else {
                    Logger.debugVisibility(`[READONLY_PROCESSOR] ${menu.name} has selectedBy but no active selectors`);
                }
            }

            // Log state changes
            if (wasReadonly !== menu.isReadonly) {
                Logger.debugVisibility(`[READONLY_PROCESSOR] State changed for ${menu.name}: ${wasReadonly} → ${menu.isReadonly}`);
            }

            // Process children recursively
            if (menu.children) {
                menu.children.forEach(updateReadonly);
            }
        };

        this.allMenus.forEach(updateReadonly);

        Logger.debugVisibility(`[READONLY_PROCESSOR] Readonly states update completed:`);
        Logger.debugVisibility(`[READONLY_PROCESSOR]   - Total menus processed: ${totalProcessed}`);
        Logger.debugVisibility(`[READONLY_PROCESSOR]   - Menus with selectedBy: ${selectedByCount}`);
        Logger.debugVisibility(`[READONLY_PROCESSOR]   - Menus now readonly: ${readonlyCount}`);

        // Log specific case we're looking for
        const dfsUsingPosix = this.findMenuByName('DFS_USING_POSIX');
        if (dfsUsingPosix) {
            Logger.debugVisibility(`[READONLY_PROCESSOR] DFS_USING_POSIX status:`);
            Logger.debugVisibility(`[READONLY_PROCESSOR]   - selectedBy: [${dfsUsingPosix.selectedBy.join(', ')}]`);
            Logger.debugVisibility(`[READONLY_PROCESSOR]   - isReadonly: ${dfsUsingPosix.isReadonly}`);
            Logger.debugVisibility(`[READONLY_PROCESSOR]   - value: ${dfsUsingPosix.value}`);
            Logger.debugVisibility(`[READONLY_PROCESSOR]   - readonlyReason: ${dfsUsingPosix.readonlyReason}`);
        }

        // 额外调试：关注 RT_USING_HOOKLIST 的只读与选择来源
        const hookList = this.findMenuByName('RT_USING_HOOKLIST');
        if (hookList) {
            Logger.debugVisibility(`[READONLY_PROCESSOR] RT_USING_HOOKLIST status:`);
            Logger.debugVisibility(`[READONLY_PROCESSOR]   - selectedBy: [${hookList.selectedBy.join(', ')}]`);
            Logger.debugVisibility(`[READONLY_PROCESSOR]   - isReadonly: ${hookList.isReadonly}`);
            Logger.debugVisibility(`[READONLY_PROCESSOR]   - value: ${hookList.value}`);
            Logger.debugVisibility(`[READONLY_PROCESSOR]   - readonlyReason: ${hookList.readonlyReason}`);
        }
    }

    /**
     * Find all configs that select the given menu item
     */
    private findSelectorsForItem(targetMenu: Menu): void {
        const searchForSelectors = (menu: Menu) => {
            // Check if this menu selects the target
            if (menu.select && menu.select.includes(targetMenu.name)) {
                if (!targetMenu.selectedBy.includes(menu.name)) {
                    targetMenu.selectedBy.push(menu.name);
                }
            }
            
            // Search in children
            if (menu.children) {
                menu.children.forEach(searchForSelectors);
            }
        };
        
        this.allMenus.forEach(searchForSelectors);
    }

    /**
     * Log current visibility state for debugging
     */
    private logVisibilityState(): void {
        // Logger.info(`[VISIBILITY_STATE] Current visibility state:`);
        
        const logMenu = (menu: Menu, depth = 0) => {
            const _indent = "  ".repeat(depth);
            const _visIcon = menu.isVisible ? "👁️" : "🙈";
            const _depInfo = menu.dependsOn ? ` (depends: ${menu.dependsOn})` : " (no depends)";
            
            // Logger.info(`${indent}${visIcon} ${menu.name || menu.title}: ${menu.isVisible}${depInfo}`);
            
            // Debug dependency evaluation
            if (menu.dependsOn) {
                try {
                    const _evalResult = this.evaluator.evaluate(menu.dependsOn);
                    // Logger.info(`${indent}  -> Condition "${menu.dependsOn}" evaluates to: ${evalResult}`);
                } catch (error) {
                    // Logger.info(`${indent}  -> Condition evaluation failed: ${error}`);
                }
            }
            
            if (menu.children && menu.children.length > 0) {
                menu.children.forEach(child => logMenu(child, depth + 1));
            }
        };
        
        this.allMenus.forEach(menu => logMenu(menu));
        
        // Logger.info(`[CONFIG_VALUES] Current config values:`);
        // Object.entries(this.configValues).forEach(([key, value]) => {
        //     Logger.info(`  ${key}: ${value} (${typeof value})`);
        // });
        
        // Logger.info(`[DEPENDENCIES] Dependency graph:`);
        // this.dependencies.forEach((depInfo, configId) => {
        //     const menu = this.findMenuById(configId);
        //     const menuName = menu ? menu.name : 'unknown';
        //     Logger.info(`  ${configId} (${menuName}): depends on "${depInfo.dependsOn}", has ${depInfo.dependents.size} dependents`);
        // });
    }

    /**
     * Debug select relationships for troubleshooting
     */
    public debugSelectRelationships(): void {
        // Logger.info(`[DEBUG] Select relationships:`);
        
        const logSelectInfo = (menu: Menu, depth = 0) => {
            const _indent = "  ".repeat(depth);
            
            if (menu.name) {
                const _selectInfo = menu.select && menu.select.length > 0 ? ` selects: [${menu.select.join(', ')}]` : '';
                const _selectedByInfo = menu.selectedBy && menu.selectedBy.length > 0 ? ` selected by: [${menu.selectedBy.join(', ')}]` : '';
                const _readonlyInfo = menu.isReadonly ? ' (READONLY)' : '';
                
                // Logger.info(`${indent}${menu.name} = ${menu.value}${selectInfo}${selectedByInfo}${readonlyInfo}`);
                if (menu.readonlyReason) {
                    // Logger.info(`${indent}  -> Readonly reason: ${menu.readonlyReason}`);
                }
            }
            
            if (menu.children) {
                menu.children.forEach(child => logSelectInfo(child, depth + 1));
            }
        };
        
        this.allMenus.forEach(menu => logSelectInfo(menu));
    }

    /**
     * 判断一个带有 select 的“选择器”是否有效启用（匹配 Kconfiglib tri_value 语义的关键部分）
     * 规则：
     * - 必须是布尔类型；
     * - 其值为 true；
     * - 直接依赖（depends on/if/menu/visible if 合并后）成立。
     */
    private isSelectorEffectivelyEnabled(selector: Menu): boolean {
        if (!selector || selector.type !== menuType.bool) {
            return false;
        }
        if (selector.value !== true) {
            return false;
        }
        try {
            if (!selector.dependsOn || selector.dependsOn.trim() === '') {
                return true;
            }
            const depsOk = this.evaluator.evaluate(selector.dependsOn);
            return !!depsOk;
        } catch (e) {
            Logger.debugSelect(`[SELECT_EVAL] Failed to evaluate dependsOn for ${selector.name}: ${selector.dependsOn}. Error: ${e}`);
            // 谨慎起见，依赖计算失败时不视为有效，避免误选中
            return false;
        }
    }
}
