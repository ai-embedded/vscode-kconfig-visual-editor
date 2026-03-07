import assert from "assert";
import path from "path";

import { KconfigParser } from "../menuconfig/KconfigParser";
import { VisibilityManager } from "../menuconfig/VisibilityManager";
import { Menu } from "../menuconfig/Menu";

const findMenuByName = (menus: Menu[], name: string): Menu | null => {
    const stack: Menu[] = [...menus];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }
        if (current.name === name) {
            return current;
        }
        if (current.children && current.children.length > 0) {
            stack.push(...current.children);
        }
    }
    return null;
};

const findMenuByTitle = (menus: Menu[], title: string): Menu | null => {
    const stack: Menu[] = [...menus];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }
        if (current.title === title) {
            return current;
        }
        if (current.children && current.children.length > 0) {
            stack.push(...current.children);
        }
    }
    return null;
};

export async function runVisibilityIncrementalUpdateTests(): Promise<void> {
    const repoRoot = path.resolve(__dirname, "../..");
    const kconfigPath = path.join(repoRoot, "test-kconfig", "config", "Kconfig");

    const parser = new KconfigParser({
        workspaceFolder: repoRoot,
        mainKconfigFile: kconfigPath,
    });

    const menus = await parser.parse();
    const visibility = new VisibilityManager();
    visibility.initialize(menus);

    const optionA = findMenuByName(menus, "OPTION_A");
    const optionE = findMenuByName(menus, "OPTION_E");
    const advancedFeatures = findMenuByName(menus, "ADVANCED_FEATURES");
    const advancedMenu = findMenuByTitle(menus, "Advanced Settings");
    const advancedOption1 = findMenuByName(menus, "ADV_OPTION_1");

    assert.ok(optionA, "expected OPTION_A");
    assert.ok(optionE, "expected OPTION_E");
    assert.ok(advancedFeatures, "expected ADVANCED_FEATURES");
    assert.ok(advancedMenu, "expected Advanced Settings menu");
    assert.ok(advancedOption1, "expected ADV_OPTION_1");

    assert.strictEqual(optionE!.isVisible, true, "OPTION_E should be visible when OPTION_A is enabled");
    assert.strictEqual(advancedMenu!.isVisible, false, "Advanced Settings should be hidden initially");

    visibility.updateValue(optionA!.id, false);
    assert.strictEqual(optionE!.isVisible, false, "OPTION_E should be hidden when OPTION_A is disabled");

    visibility.updateValue(optionA!.id, true);
    assert.strictEqual(optionE!.isVisible, true, "OPTION_E should be visible after OPTION_A is re-enabled");

    visibility.updateValue(advancedFeatures!.id, true);
    assert.strictEqual(advancedMenu!.isVisible, true, "Advanced Settings should be visible when ADVANCED_FEATURES is enabled");
    assert.strictEqual(advancedOption1!.isVisible, true, "ADV_OPTION_1 should be visible when ADVANCED_FEATURES is enabled");

    visibility.updateValue(advancedFeatures!.id, false);
    assert.strictEqual(advancedMenu!.isVisible, false, "Advanced Settings should be hidden when ADVANCED_FEATURES is disabled");
    assert.strictEqual(advancedOption1!.isVisible, false, "ADV_OPTION_1 should be hidden when ADVANCED_FEATURES is disabled");
}

