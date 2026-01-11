import assert from "assert";
import path from "path";

import { KconfigParser } from "../menuconfig/KconfigParser";
import { VisibilityManager } from "../menuconfig/VisibilityManager";
import { Menu } from "../menuconfig/Menu";

const collectMenusByName = (menus: Menu[], name: string): Menu[] => {
    const matches: Menu[] = [];
    const walk = (items: Menu[]) => {
        for (const item of items) {
            if (item.name === name) {
                matches.push(item);
            }
            if (item.children && item.children.length > 0) {
                walk(item.children);
            }
        }
    };
    walk(menus);
    return matches;
};

export async function runSourceDuplicateSymbolTests(): Promise<void> {
    const repoRoot = path.resolve(__dirname, "../..");
    const kconfigPath = path.join(repoRoot, "test-kconfig", "source", "Kconfig");

    const parser = new KconfigParser({
        workspaceFolder: repoRoot,
        mainKconfigFile: kconfigPath,
    });

    const menus = await parser.parse();

    const visibility = new VisibilityManager();
    visibility.initialize(menus);

    const duplicates = collectMenusByName(menus, "RELATIVE_GLOB_CONFIG");
    assert.ok(duplicates.length >= 2, "expected duplicate menus for RELATIVE_GLOB_CONFIG");

    const first = duplicates[0];
    visibility.updateValue(first.id, true);

    const after = collectMenusByName(menus, "RELATIVE_GLOB_CONFIG");
    for (const item of after) {
        assert.strictEqual(item.value, true, "duplicate menu entries should stay in sync");
    }
}
