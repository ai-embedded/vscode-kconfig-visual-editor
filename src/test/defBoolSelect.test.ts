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

export async function runDefBoolSelectTests(): Promise<void> {
    const repoRoot = path.resolve(__dirname, "../..");
    const kconfigPath = path.join(repoRoot, "test-kconfig", "defbool", "Kconfig");

    const parser = new KconfigParser({
        workspaceFolder: repoRoot,
        mainKconfigFile: kconfigPath,
    });

    const menus = await parser.parse();
    const visibility = new VisibilityManager();
    visibility.initialize(menus);

    const archRiscv = findMenuByName(menus, "ARCH_RISCV");
    assert.ok(archRiscv, "expected ARCH_RISCV to exist");
    assert.strictEqual(archRiscv!.value, true, "expected ARCH_RISCV def_bool y to be applied");

    const archHasPtdump = findMenuByName(menus, "ARCH_HAS_PTDUMP");
    assert.ok(archHasPtdump, "expected ARCH_HAS_PTDUMP to exist");
    assert.strictEqual(archHasPtdump!.value, true, "expected ARCH_HAS_PTDUMP to be selected when MMU is y");

    const ptdump = findMenuByName(menus, "PTDUMP");
    assert.ok(ptdump, "expected PTDUMP to exist");
    assert.strictEqual(ptdump!.isVisible, true, "expected PTDUMP to be visible when dependencies are met");
}
