import * as fs from "fs";
import { Menu, menuType } from "./Menu";
import { ConditionEvaluator, ConfigContext } from "./ConditionEvaluator";
import { Logger } from "../logger/logger";

export interface SymbolAssignment {
    name: string;
    type: menuType;
    value: string | number;
}

export interface KconfigWriteOptions {
    menus: Menu[];
    assignments?: SymbolAssignment[];
    configOut?: string;
    headerOut?: string;
    defconfigOut?: string;
    configHeader?: string;
    headerHeader?: string;
    saveOld?: boolean;
}

export class KconfigWriter {
    private evaluator: ConditionEvaluator;
    private readonly defaultValues: Map<string, any>;

    constructor(
        defaultValues: Map<string, any>,
        evaluator?: ConditionEvaluator
    ) {
        this.defaultValues = defaultValues;
        this.evaluator = evaluator || new ConditionEvaluator();
    }

    /**
     * Update the configuration context for dependency evaluation
     */
    public updateContext(context: ConfigContext): void {
        this.evaluator.updateContext(context);
    }

    public collectAssignments(menus: Menu[]): SymbolAssignment[] {
        const assignments: SymbolAssignment[] = [];
        const visited = new Set<string>();

        const traverse = (items: Menu[]) => {
            for (const item of items) {
                if (item.name && !visited.has(item.name) && item.type !== menuType.menu && item.type !== menuType.choice) {
                    visited.add(item.name);
                    if (this.shouldSkipSymbol(item)) {
                        continue;
                    }
                    const assignment = this.serializeMenuValue(item);
                    if (assignment) {
                        assignments.push(assignment);
                    }
                }

                if (item.children && item.children.length > 0) {
                    traverse(item.children);
                }
            }
        };

        traverse(menus);
        return assignments;
    }

    public async write(options: KconfigWriteOptions): Promise<void> {
        const assignments = options.assignments ?? this.collectAssignments(options.menus);

        if (options.configOut) {
            await this.writeConfigFile(options.configOut, options.menus, options.configHeader, options.saveOld !== false);
        }

        if (options.headerOut) {
            await this.writeHeaderFile(options.headerOut, options.menus, options.headerHeader);
        }

        if (options.defconfigOut) {
            await this.writeDefconfigFile(options.defconfigOut, assignments, options.configHeader);
        }
    }

    private async writeConfigFile(filename: string, menus: Menu[], header?: string, saveOld: boolean = true): Promise<void> {
        const lines = this.generateConfigLines(menus);
        let content = header ? header : "";
        if (lines.length > 0) {
            if (content && !content.endsWith("\n")) {
                content += "\n";
            }
            content += lines.join("\n");
            if (!content.endsWith("\n")) {
                content += "\n";
            }
        }

        await this.writeFileIfChanged(filename, content, saveOld);
    }

    private async writeHeaderFile(filename: string, menus: Menu[], header?: string): Promise<void> {
        const lines = this.generateHeaderLines(menus);
        let content = header ? header : "";
        if (lines.length > 0) {
            if (content && !content.endsWith("\n")) {
                content += "\n";
            }
            content += lines.join("\n");
            if (!content.endsWith("\n")) {
                content += "\n";
            }
        }

        await this.writeFileIfChanged(filename, content, false);
    }

    private async writeDefconfigFile(filename: string, assignments: SymbolAssignment[], header?: string): Promise<void> {
        const lines = assignments.map((assignment) => this.formatDefconfigLine(assignment)).filter((line) => line.length > 0);

        let content = header ? header : "";
        if (lines.length > 0) {
            if (content && !content.endsWith("\n")) {
                content += "\n";
            }
            content += lines.join("\n");
            if (!content.endsWith("\n")) {
                content += "\n";
            }
        }

        await this.writeFileIfChanged(filename, content, false);
    }

    private generateConfigLines(menus: Menu[]): string[] {
        const lines: string[] = [];
        const visited = new Set<string>();

        type Frame = {
            items: Menu[];
            index: number;
            parentMenu?: Menu;
            parentTitle?: string;
            printedHeader: boolean;
            contentStartIndex: number;
            hasChildNodes: boolean;
        };

        const stack: Frame[] = [{
            items: menus,
            index: 0,
            printedHeader: false,
            contentStartIndex: lines.length,
            hasChildNodes: menus.length > 0
        }];
        let afterEndComment = false;

        while (stack.length > 0) {
            const frame = stack[stack.length - 1];

            if (frame.index >= frame.items.length) {
                stack.pop();

                if (
                    frame.parentMenu &&
                    frame.printedHeader &&
                    frame.parentTitle &&
                    (lines.length > frame.contentStartIndex ||
                     frame.hasChildNodes)
                ) {
                    lines.push(`# end of ${frame.parentTitle}`);
                    afterEndComment = true;
                }

                continue;
            }

            const item = frame.items[frame.index++];

            if (item.type === menuType.menu) {
                const title = this.getMenuTitle(item);
                const shouldPrintMenu = this.shouldPrintMenuHeader(item) && !!title;

                if (shouldPrintMenu && title) {
                    if (lines.length === 0 || lines[lines.length - 1] !== "") {
                        lines.push("");
                    }
                    lines.push("#");
                    lines.push(`# ${title}`);
                    lines.push("#");
                    afterEndComment = false;
                }

                const children = item.children && item.children.length > 0 ? item.children : [];
                stack.push({
                    items: children,
                    index: 0,
                    parentMenu: item,
                    parentTitle: title,
                    printedHeader: shouldPrintMenu && !!title,
                    contentStartIndex: lines.length,
                    hasChildNodes: children.length > 0
                });
                continue;
            }

            if (item.type === menuType.choice) {
                const children = item.children && item.children.length > 0 ? item.children : [];
                if (children.length > 0) {
                    stack.push({
                        items: children,
                        index: 0,
                        printedHeader: false,
                        contentStartIndex: lines.length,
                        hasChildNodes: children.length > 0
                    });
                }
                continue;
            }

            if (item.name && !visited.has(item.name)) {
                visited.add(item.name);

                if (this.shouldSkipSymbol(item)) {
                    if (item.children && item.children.length > 0) {
                        stack.push({
                            items: item.children,
                            index: 0,
                            printedHeader: false,
                            contentStartIndex: lines.length,
                            hasChildNodes: item.children.length > 0
                        });
                    }
                    continue;
                }

                if (!this.shouldWriteToConfig(item)) {
                    if (item.children && item.children.length > 0) {
                        stack.push({
                            items: item.children,
                            index: 0,
                            printedHeader: false,
                            contentStartIndex: lines.length,
                            hasChildNodes: item.children.length > 0
                        });
                    }
                    continue;
                }

                if (afterEndComment) {
                    if (lines.length === 0 || lines[lines.length - 1] !== "") {
                        lines.push("");
                    }
                    afterEndComment = false;
                }

                const line = this.formatConfigLine(item);
                if (line) {
                    lines.push(line);
                }
            }

            if (item.children && item.children.length > 0) {
                stack.push({
                    items: item.children,
                    index: 0,
                    printedHeader: false,
                    contentStartIndex: lines.length,
                    hasChildNodes: item.children.length > 0
                });
            }
        }

        return lines;
    }

    private getMenuTitle(menu: Menu): string {
        if (!menu) {
            return "";
        }
        const title = menu.title && menu.title.trim().length > 0 ? menu.title.trim() : undefined;
        if (title) {
            return title;
        }
        const prompt = menu.prompt && menu.prompt.trim().length > 0 ? menu.prompt.trim() : undefined;
        if (prompt) {
            return prompt;
        }
        return menu.name ? menu.name.trim() : "";
    }

    private shouldPrintMenuHeader(menu: Menu): boolean {
        if (!menu) {
            return false;
        }
        if (menu.isMainMenu) {
            return false;
        }

        if (!this.isDependencySatisfied(menu.dependsOn)) {
            return false;
        }

        const title = this.getMenuTitle(menu);
        return title.length > 0;
    }

    private isDependencySatisfied(dependsOn?: string): boolean {
        if (!dependsOn) {
            return true;
        }
        const trimmed = dependsOn.trim();
        if (trimmed === "" || trimmed === "y") {
            return true;
        }
        return this.evaluator.evaluate(trimmed);
    }

    /**
     * Check if a configuration item should be written to the config file.
     * Matches Kconfiglib's _write_to_conf behavior: only write if dependencies are satisfied.
     *
     * From Kconfiglib:
     * - _write_to_conf is set to (vis != 0) where vis is the visibility
     * - visibility is determined by evaluating the dependency expression
     * - If visibility is 0 (n), the config is not written
     */
    private shouldWriteToConfig(menu: Menu): boolean {
        if (menu.hasPrompt === false) {
            Logger.debugWriter(`Skipping ${menu.name} because it has no prompt (hidden symbol)`);
            return false;
        }
        const depsSatisfied = this.isDependencySatisfied(menu.dependsOn);
        if (!depsSatisfied) {
            Logger.debugWriter(`Skipping ${menu.name} due to unsatisfied dependencies: ${menu.dependsOn || 'none'}`);
        }
        return depsSatisfied;
    }

    private shouldSkipSymbol(menu: Menu): boolean {
        if (!menu) {
            return false;
        }
        if (menu.optionDefconfigList) {
            return true;
        }
        if (menu.optionEnvVar) {
            return true;
        }
        return false;
    }

    private generateHeaderLines(menus: Menu[]): string[] {
        const lines: string[] = [];
        const visited = new Set<string>();

        const traverse = (items: Menu[]) => {
            for (const item of items) {
                if (item.name && !visited.has(item.name) && item.type !== menuType.menu && item.type !== menuType.choice) {
                    visited.add(item.name);
                    if (this.shouldSkipSymbol(item)) {
                        continue;
                    }
                    const entry = this.formatHeaderLines(item);
                    lines.push(...entry);
                }

                if (item.children && item.children.length > 0) {
                    traverse(item.children);
                }
            }
        };

        traverse(menus);
        return lines;
    }

    private formatConfigLine(menu: Menu): string {
        const prefix = "CONFIG_" + menu.name;

        switch (menu.type) {
            case menuType.bool:
            case menuType.tristate: {
                const value = this.toTristate(menu.value);
                if (value === "n") {
                    return `# ${prefix} is not set`;
                }
                return `${prefix}=${value}`;
            }
            case menuType.int: {
                const value = this.normalizeIntValue(menu);
                return value === null ? "" : `${prefix}=${value}`;
            }
            case menuType.hex: {
                const value = this.normalizeHexValue(menu);
                return value ? `${prefix}=${value}` : "";
            }
            case menuType.string: {
                const value = this.normalizeStringValue(menu);
                return value === null ? "" : `${prefix}="${this.escapeString(value)}"`;
            }
            default:
                return "";
        }
    }

    private formatHeaderLines(menu: Menu): string[] {
        const prefix = "CONFIG_" + menu.name;

        switch (menu.type) {
            case menuType.bool:
            case menuType.tristate: {
                const value = this.toTristate(menu.value);
                if (value === "y") {
                    return [`#define ${prefix} 1`];
                }
                if (value === "m") {
                    return [`#define ${prefix}_MODULE 1`];
                }
                return [];
            }
            case menuType.int: {
                const value = this.normalizeIntValue(menu);
                return value === null ? [] : [`#define ${prefix} ${value}`];
            }
            case menuType.hex: {
                const value = this.normalizeHexValue(menu);
                return value ? [`#define ${prefix} ${value}`] : [];
            }
            case menuType.string: {
                const value = this.normalizeStringValue(menu);
                return value === null ? [] : [`#define ${prefix} "${this.escapeString(value)}"`];
            }
            default:
                return [];
        }
    }

    private formatDefconfigLine(assignment: SymbolAssignment): string {
        const prefix = "CONFIG_" + assignment.name;

        switch (assignment.type) {
            case menuType.bool:
            case menuType.tristate: {
                const value = assignment.value as string;
                if (value === "n") {
                    return `# ${prefix} is not set`;
                }
                return `${prefix}=${value}`;
            }
            case menuType.int:
                return `${prefix}=${assignment.value}`;
            case menuType.hex:
                return `${prefix}=${assignment.value}`;
            case menuType.string:
                return `${prefix}="${this.escapeString(String(assignment.value))}"`;
            default:
                return "";
        }
    }

    private serializeMenuValue(menu: Menu): SymbolAssignment | null {
        if (!menu.name) {
            return null;
        }

        if (this.shouldSkipSymbol(menu)) {
            return null;
        }

        switch (menu.type) {
            case menuType.bool:
            case menuType.tristate: {
                const value = this.toTristate(menu.value);
                const defaultRaw = this.defaultValues.get(menu.name);
                const defaultValue = this.toTristate(defaultRaw);
                if (value === defaultValue) {
                    return null;
                }
                return { name: menu.name, type: menu.type, value };
            }
            case menuType.int: {
                const value = this.normalizeIntValue(menu);
                const defaultValue = this.normalizeDefaultInt(this.defaultValues.get(menu.name));
                if (value === null && defaultValue === null) {
                    return null;
                }
                if (value !== null && defaultValue !== null && value === defaultValue) {
                    return null;
                }
                if (value === null) {
                    return null;
                }
                return { name: menu.name, type: menu.type, value };
            }
            case menuType.hex: {
                const value = this.normalizeHexValue(menu);
                const defaultValue = this.normalizeDefaultHex(this.defaultValues.get(menu.name));
                if (!value && !defaultValue) {
                    return null;
                }
                if (value && defaultValue && value.toLowerCase() === defaultValue.toLowerCase()) {
                    return null;
                }
                if (!value) {
                    return null;
                }
                return { name: menu.name, type: menu.type, value };
            }
            case menuType.string: {
                const value = this.normalizeStringValue(menu);
                const defaultValue = this.normalizeDefaultString(this.defaultValues.get(menu.name));
                if (value === null && defaultValue === null) {
                    return null;
                }
                if (value !== null && defaultValue !== null && value === defaultValue) {
                    return null;
                }
                if (value === null) {
                    return null;
                }
                return { name: menu.name, type: menu.type, value };
            }
            default:
                return null;
        }
    }

    private expandStringValue(value: string): string {
        if (!value) {
            return value;
        }

        return value.replace(/\$\(([^)]+)\)|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, p1, p2) => {
            const varName = p1 || p2;
            if (!varName) {
                return '';
            }
            const envValue = process.env[varName];
            return envValue !== undefined ? envValue : '';
        });
    }

    private normalizeIntValue(menu: Menu): number | null {
        const raw = menu.value;
        if (raw === null || raw === undefined || raw === "") {
            return null;
        }

        const parsed = typeof raw === "number" ? raw : parseInt(raw.toString(), 10);
        if (Number.isNaN(parsed)) {
            return null;
        }

        if (menu.range && menu.range.length >= 2) {
            const [min, max] = menu.range;
            let value = parsed;
            if (Number.isFinite(min) && value < min) {
                value = min;
            }
            if (Number.isFinite(max) && value > max) {
                value = max;
            }
            return value;
        }

        return parsed;
    }

    private normalizeHexValue(menu: Menu): string {
        const raw = menu.value;
        if (raw === null || raw === undefined || raw === "") {
            return "";
        }

        let numeric: number | null = null;
        if (typeof raw === "number") {
            numeric = raw;
        } else if (typeof raw === "string") {
            const normalized = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
            const parsed = parseInt(normalized, 16);
            if (!Number.isNaN(parsed)) {
                numeric = parsed;
            }
        }

        if (numeric !== null) {
            if (menu.range && menu.range.length >= 2) {
                const [min, max] = menu.range;
                if (Number.isFinite(min) && numeric < min) {
                    numeric = min;
                } else if (Number.isFinite(max) && numeric > max) {
                    numeric = max;
                }
            }
            return "0x" + numeric.toString(16).toUpperCase();
        }

        const strValue = raw.toString();
        if (strValue.startsWith("0x") || strValue.startsWith("0X")) {
            return "0x" + strValue.slice(2).toUpperCase();
        }
        return "0x" + strValue.toUpperCase();
    }

    private normalizeStringValue(menu: Menu): string | null {
        const raw = menu.value;
        if (raw === null || raw === undefined) {
            return null;
        }
        return this.expandStringValue(raw.toString());
    }

    private normalizeDefaultInt(value: any): number | null {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        const parsed = typeof value === "number" ? value : parseInt(value.toString(), 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    private normalizeDefaultHex(value: any): string | null {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        if (typeof value === "string") {
            if (value.startsWith("0x") || value.startsWith("0X")) {
                return value;
            }
        }
        const parsed = typeof value === "number" ? value : parseInt(value.toString(), 16);
        if (Number.isNaN(parsed)) {
            return null;
        }
        return "0x" + parsed.toString(16).toUpperCase();
    }

    private normalizeDefaultString(value: any): string | null {
        if (value === null || value === undefined) {
            return null;
        }
        return this.expandStringValue(value.toString());
    }

    private toTristate(value: any): "y" | "m" | "n" {
        if (value === true || value === "y" || value === "Y" || value === 2) {
            return "y";
        }
        if (value === "m" || value === "M" || value === 1) {
            return "m";
        }
        return "n";
    }

    private escapeString(value: string): string {
        return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    private async writeFileIfChanged(filename: string, content: string, saveOld: boolean): Promise<void> {
        let existing: string | null = null;
        try {
            existing = await fs.promises.readFile(filename, "utf8");
        } catch (_) {
            existing = null;
        }

        if (existing === content) {
            return;
        }

        if (saveOld && existing !== null) {
            await this.saveOldFile(filename, existing);
        }

        await fs.promises.writeFile(filename, content, "utf8");
    }

    private async saveOldFile(filename: string, content: string): Promise<void> {
        const backupPath = `${filename}.old`;
        try {
            await fs.promises.writeFile(backupPath, content, "utf8");
        } catch (_) {
            // Ignore backup errors to match kconfiglib behavior
        }
    }
}
