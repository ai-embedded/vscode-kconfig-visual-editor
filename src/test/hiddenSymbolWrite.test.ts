import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { KconfigParser } from "../menuconfig/KconfigParser";
import { VisibilityManager } from "../menuconfig/VisibilityManager";
import { KconfigWriter } from "../menuconfig/KconfigWriter";
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

export async function runHiddenSymbolWriteTests(): Promise<void> {
    const repoRoot = path.resolve(__dirname, "../..");
    const kconfigPath = path.join(repoRoot, "test-kconfig", "config", "Kconfig");

    const parser = new KconfigParser({
        workspaceFolder: repoRoot,
        mainKconfigFile: kconfigPath,
    });

    const menus = await parser.parse();
    const visibility = new VisibilityManager();
    visibility.initialize(menus);

    const choice = findChoiceByChildName(menus, "MODE_MANUAL");
    assert.ok(choice, "expected choice containing MODE_MANUAL");
    visibility.updateValue(choice!.id, "MODE_MANUAL");

    const writer = new KconfigWriter(new Map(), visibility.getEvaluator());
    writer.updateContext(visibility.getContext());

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kconfig-test-"));
    const outPath = path.join(tmpDir, ".config");

    await writer.write({
        menus,
        configOut: outPath,
        saveOld: false,
    });

    const content = await fs.promises.readFile(outPath, "utf8");

    assert.ok(content.includes("CONFIG_SOC_TYPE_CV180X=y"), "expected selected SOC_TYPE_CV180X to be written");
    assert.ok(content.includes("CONFIG_SOC_TYPE_SG2000=y"), "expected default-y SOC_TYPE_SG2000 to be written");
    assert.ok(content.includes("CONFIG_HZ=250"), "expected HZ to follow MODE_MANUAL default");
    assert.ok(!content.includes("SOC_TYPE_SG2002"), "did not expect SOC_TYPE_SG2002 to be written");
}
