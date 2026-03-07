import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import Module from "module";

import { Menu, menuType } from "../menuconfig/Menu";

function createMenu(overrides: Partial<Menu>): Menu {
    return {
        id: overrides.id || "",
        name: overrides.name || "",
        title: overrides.title || "",
        type: overrides.type || menuType.bool,
        value: overrides.value ?? false,
        children: overrides.children || [],
        help: overrides.help || "",
        range: overrides.range || [],
        isVisible: overrides.isVisible ?? true,
        isCollapsed: overrides.isCollapsed ?? false,
        dependsOn: overrides.dependsOn || "",
        isMenuconfig: overrides.isMenuconfig ?? false,
        hasPrompt: overrides.hasPrompt ?? true,
        select: overrides.select || [],
        selectedBy: overrides.selectedBy || [],
    };
}

export async function runLoadConfigNameIndexTests(): Promise<void> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kconfig-load-config-"));
    const kconfigPath = path.join(tempDir, "Kconfig");
    const configPath = path.join(tempDir, ".config");

    fs.writeFileSync(kconfigPath, 'mainmenu "Load Config Test"\n', "utf8");
    fs.writeFileSync(
        configPath,
        [
            "CONFIG_FEATURE_A=y",
            "# CONFIG_FEATURE_B is not set",
            'CONFIG_TEXT_VALUE="hello world"',
            "",
        ].join("\n"),
        "utf8"
    );

    const rootMenu = createMenu({
        id: "root",
        name: "__MAINMENU__",
        title: "Root",
        type: menuType.menu,
        value: null,
        isMenuconfig: true,
        children: [
            createMenu({
                id: "a",
                name: "FEATURE_A",
                title: "Feature A",
                type: menuType.bool,
                value: false,
            }),
            createMenu({
                id: "b",
                name: "FEATURE_B",
                title: "Feature B",
                type: menuType.bool,
                value: true,
            }),
            createMenu({
                id: "txt",
                name: "TEXT_VALUE",
                title: "Text Value",
                type: menuType.string,
                value: "",
            }),
        ],
    });

    const originalLoad = (Module as any)._load;
    const mockVscode = {
        workspace: {
            getConfiguration: () => ({
                get: (_key: string, defaultValue: any) => defaultValue,
            }),
        },
        window: {
            createOutputChannel: () => ({ appendLine: () => undefined }),
            showErrorMessage: () => undefined,
            showInformationMessage: () => undefined,
            setStatusBarMessage: () => undefined,
        },
        Uri: {
            file: (fsPath: string) => ({ fsPath }),
        },
        ConfigurationTarget: {
            Workspace: 2,
        },
    };

    try {
        (Module as any)._load = function(request: string, parent: any, isMain: boolean) {
            if (request === "vscode") {
                return mockVscode;
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const { KconfigServer } = require("../menuconfig/KconfigServer");
        const server = new KconfigServer({
            workspaceFolder: { fsPath: tempDir },
            kconfigFile: kconfigPath,
        });

        (server as any).kconfigMenus = [rootMenu];
        (server as any).rebuildMenuCaches();

        const originalRecursiveUpdater = (server as any).updateMenuValueByName.bind(server);
        let recursiveCallCount = 0;
        (server as any).updateMenuValueByName = (name: string, value: string) => {
            recursiveCallCount += 1;
            return originalRecursiveUpdater(name, value);
        };

        await (server as any).loadConfigValues();

        assert.strictEqual(
            recursiveCallCount,
            0,
            `expected loadConfigValues to avoid recursive symbol scan, got ${recursiveCallCount} recursive calls`
        );

        const featureA = rootMenu.children[0];
        const featureB = rootMenu.children[1];
        const textValue = rootMenu.children[2];

        assert.strictEqual(featureA.value, true, "FEATURE_A should be loaded as y/true");
        assert.strictEqual(featureB.value, false, "FEATURE_B should be loaded as n/false");
        assert.strictEqual(textValue.value, "hello world", "TEXT_VALUE should strip quotes when loaded");
    } finally {
        (Module as any)._load = originalLoad;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
