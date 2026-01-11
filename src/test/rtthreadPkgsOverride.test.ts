import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { KconfigParser } from "../menuconfig/KconfigParser";
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

export async function runRtThreadPkgsOverrideTests(): Promise<void> {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kconfig-pkgs-"));
    const workspaceDir = path.join(tempRoot, "workspace");
    const localPkgsDir = path.join(workspaceDir, "packages");
    const envPkgsDir = path.join(tempRoot, "env-packages");
    fs.mkdirSync(localPkgsDir, { recursive: true });
    fs.mkdirSync(envPkgsDir, { recursive: true });

    fs.writeFileSync(
        path.join(localPkgsDir, "Kconfig"),
        'config LOCAL_PKG\n    bool "local"\n'
    );
    fs.writeFileSync(
        path.join(envPkgsDir, "Kconfig"),
        'config ENV_PKG\n    bool "env"\n'
    );

    fs.mkdirSync(workspaceDir, { recursive: true });
    const mainKconfig = path.join(workspaceDir, "Kconfig");
    fs.writeFileSync(
        mainKconfig,
        'mainmenu "Test"\nPKGS_DIR := packages\nosource "$PKGS_DIR/Kconfig"\n'
    );

    const originalPkgsDir = process.env.PKGS_DIR;
    process.env.PKGS_DIR = envPkgsDir;

    try {
        const parser = new KconfigParser({
            workspaceFolder: workspaceDir,
            mainKconfigFile: mainKconfig,
        });
        const menus = await parser.parse();

        const envMenus = collectMenusByName(menus, "ENV_PKG");
        const localMenus = collectMenusByName(menus, "LOCAL_PKG");

        assert.ok(envMenus.length > 0, "ENV_PKG should be loaded from PKGS_DIR");
        assert.strictEqual(
            localMenus.length,
            0,
            "LOCAL_PKG should be ignored when PKGS_DIR env is set"
        );
    } finally {
        if (originalPkgsDir === undefined) {
            delete process.env.PKGS_DIR;
        } else {
            process.env.PKGS_DIR = originalPkgsDir;
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}
