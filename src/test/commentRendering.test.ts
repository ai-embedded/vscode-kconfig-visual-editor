import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { KconfigParser } from "../menuconfig/KconfigParser";
import { Menu, menuType } from "../menuconfig/Menu";

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

export async function runCommentRenderingTests(): Promise<void> {
    const repoRoot = path.resolve(__dirname, "../..");
    const kconfigPath = path.join(repoRoot, "test-kconfig", "menu", "Kconfig");

    const parser = new KconfigParser({
        workspaceFolder: repoRoot,
        mainKconfigFile: kconfigPath,
    });

    const menus = await parser.parse();

    const mainSettings = findMenuByTitle(menus, "Main Settings");
    assert.ok(mainSettings, "expected Main Settings menu");

    const commentTitle = "This menu contains the main settings for the test Kconfig.";
    const commentItem = (mainSettings!.children || []).find((child) => child.title === commentTitle);
    assert.ok(commentItem, "expected comment entry rendered under Main Settings");
    assert.strictEqual(commentItem!.type, menuType.comment, "expected comment entry type to be comment");

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kconfig-comment-space-"));
    try {
        const tempKconfig = path.join(tempDir, "Kconfig");
        await fs.promises.writeFile(
            tempKconfig,
            [
                'mainmenu "Comment Trim Test"',
                'menu "Group"',
                '    comment "   Keep Me   "',
                "endmenu",
                "",
            ].join("\n"),
            "utf8"
        );

        const trimParser = new KconfigParser({
            workspaceFolder: tempDir,
            mainKconfigFile: tempKconfig,
        });
        const trimMenus = await trimParser.parse();
        const group = findMenuByTitle(trimMenus, "Group");
        assert.ok(group, "expected Group menu");
        const spacedComment = (group!.children || []).find((child) => child.title === "   Keep Me   ");
        assert.ok(spacedComment, "expected comment text to preserve leading and trailing spaces");
        assert.strictEqual(spacedComment!.type, menuType.comment, "expected spaced comment entry type to be comment");
    } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
}
