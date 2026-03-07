import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { Menu, menuType } from "../menuconfig/Menu";
import { KconfigSessionCache } from "../menuconfig/KconfigSessionCache";

interface CachedMenuPayload {
    version: number;
    cacheKey: string;
    createdAt: number;
    files: Array<{ path: string; size: number; mtimeMs: number }>;
    menus: Menu[];
}

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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runKconfigSessionCacheTests(): Promise<void> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kconfig-session-cache-"));
    const mainFile = path.join(tempDir, "Kconfig");
    const childFile = path.join(tempDir, "child.Kconfig");

    try {
        fs.writeFileSync(mainFile, 'mainmenu "Session Cache Test"\nsource "child.Kconfig"\n', "utf8");
        fs.writeFileSync(childFile, "config CACHE_CHILD\n  bool \"Cache Child\"\n", "utf8");

        const cache = new KconfigSessionCache(tempDir);
        const cacheKey = KconfigSessionCache.buildCacheKey(mainFile);
        const menus = [
            createMenu({
                id: "root",
                name: "__MAINMENU__",
                title: "Root",
                type: menuType.menu,
                children: [
                    createMenu({
                        id: "child",
                        name: "CACHE_CHILD",
                        title: "Cache Child",
                        type: menuType.bool,
                        value: false,
                    }),
                ],
            }),
        ];

        await cache.save(cacheKey, menus, [mainFile, childFile]);

        const loadedMenus = await cache.load(cacheKey);
        assert.ok(loadedMenus, "expected cache to load when signatures match");
        assert.strictEqual(loadedMenus?.length, 1);
        assert.strictEqual(loadedMenus?.[0].children?.[0]?.name, "CACHE_CHILD");

        await sleep(20);
        fs.writeFileSync(childFile, "config CACHE_CHILD\n  bool \"Cache Child\"\n  default y\n", "utf8");

        const staleMenus = await cache.load(cacheKey);
        assert.strictEqual(staleMenus, null, "expected cache to invalidate after source file changes");

        const legacyPayload: CachedMenuPayload = {
            version: 1,
            cacheKey,
            createdAt: Date.now(),
            files: [],
            menus,
        };
        const cacheFilePath = path.join(tempDir, ".kconfig-cache", `${cacheKey}.json`);
        fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
        fs.writeFileSync(cacheFilePath, JSON.stringify(legacyPayload), "utf8");

        const legacyLoaded = await cache.load(cacheKey);
        assert.strictEqual(legacyLoaded, null, "expected cache payload with old version to be ignored");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
