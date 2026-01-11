import assert from "assert";
import path from "path";

import { KconfigParser } from "../menuconfig/KconfigParser";
import { VisibilityManager } from "../menuconfig/VisibilityManager";
import { Menu, menuType } from "../menuconfig/Menu";

const findChoiceByChildName = (menus: Menu[], childName: string): Menu | null => {
    const stack: Menu[] = [...menus];
    while (stack.length > 0) {
        const menu = stack.pop();
        if (!menu) {
            continue;
        }
        if (menu.type === menuType.choice && menu.children) {
            if (menu.children.some(child => child.name === childName)) {
                return menu;
            }
        }
        if (menu.children && menu.children.length > 0) {
            stack.push(...menu.children);
        }
    }
    return null;
};

const findChild = (menu: Menu, name: string): Menu | null => {
    if (!menu.children) {
        return null;
    }
    return menu.children.find(child => child.name === name) || null;
};

export async function runChoiceSelectionTests(): Promise<void> {
    const repoRoot = path.resolve(__dirname, "../..");
    const kconfigPath = path.join(repoRoot, "test-kconfig", "config", "Kconfig");

    const parser = new KconfigParser({
        workspaceFolder: repoRoot,
        mainKconfigFile: kconfigPath,
    });

    const menus = await parser.parse();
    const visibility = new VisibilityManager();
    visibility.initialize(menus);

    const choice = findChoiceByChildName(menus, "MODE_AUTO");
    assert.ok(choice, "expected choice containing MODE_AUTO");

    const initialAuto = findChild(choice!, "MODE_AUTO");
    const initialManual = findChild(choice!, "MODE_MANUAL");
    const initialDebug = findChild(choice!, "MODE_DEBUG");
    assert.ok(initialAuto && initialManual && initialDebug, "expected MODE_* children");

    assert.strictEqual(initialAuto!.value, true, "expected MODE_AUTO to be selected by default");

    const updatedMenus = visibility.updateValue(choice!.id, "MODE_MANUAL");
    const updatedChoice = findChoiceByChildName(updatedMenus, "MODE_MANUAL");
    assert.ok(updatedChoice, "expected choice after update");

    const manual = findChild(updatedChoice!, "MODE_MANUAL");
    const auto = findChild(updatedChoice!, "MODE_AUTO");
    const debug = findChild(updatedChoice!, "MODE_DEBUG");
    assert.ok(manual && auto && debug, "expected MODE_* children after update");

    assert.strictEqual(updatedChoice!.value, "MODE_MANUAL", "choice value should match selection");
    assert.strictEqual(manual!.value, true, "MODE_MANUAL should be selected");
    assert.strictEqual(auto!.value, false, "MODE_AUTO should be deselected");
    assert.strictEqual(debug!.value, false, "MODE_DEBUG should be deselected");
}
