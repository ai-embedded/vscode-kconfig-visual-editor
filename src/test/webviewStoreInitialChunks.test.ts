import assert from "assert";
import { createPinia, setActivePinia } from "pinia";

import { Menu, menuType } from "../menuconfig/Menu";

// 在 Node 测试环境中提前注入 VSCode API mock，避免 store 初始化报错日志
(globalThis as typeof globalThis & { acquireVsCodeApi?: () => { postMessage: () => void } }).acquireVsCodeApi = () => ({
    postMessage: () => undefined,
});

const { useMenuconfigStore } = require("../views/webview/store") as typeof import("../views/webview/store");

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

export async function runWebviewStoreInitialChunksTests(): Promise<void> {
    setActivePinia(createPinia());
    const store = useMenuconfigStore();

    const root = createMenu({
        id: "root",
        name: "__MAINMENU__",
        title: "Root",
        type: menuType.menu,
        children: [],
    });

    store.beginInitialLoad([root], { totalChunks: 2 });
    assert.strictEqual(store.initialLoadInProgress, true);
    assert.strictEqual(store.initialLoadChunkTotal, 2);

    const nested = createMenu({
        id: "nested-1",
        name: "NESTED_1",
        title: "Nested 1",
        type: menuType.bool,
        value: false,
    });
    const childA = createMenu({
        id: "child-a",
        name: "CHILD_A",
        title: "Child A",
        type: menuType.menu,
        children: [nested],
    });
    const childB = createMenu({
        id: "child-b",
        name: "CHILD_B",
        title: "Child B",
        type: menuType.bool,
        value: true,
    });

    store.appendInitialChunks([
        {
            parentId: "root",
            menus: [childA],
            chunkIndex: 1,
            totalChunks: 2,
        },
        {
            parentId: "root",
            menus: [childB],
            chunkIndex: 2,
            totalChunks: 2,
        },
    ]);

    assert.strictEqual(store.initialLoadChunkReceived, 2);
    assert.strictEqual(store.items.length, 1);
    assert.strictEqual(store.items[0].children.length, 2);
    assert.strictEqual(store.items[0].children[0].id, "child-a");
    assert.strictEqual(store.items[0].children[1].id, "child-b");

    store.applyVisibilityDelta([
        { id: "nested-1", isVisible: false },
        { id: "child-b", isVisible: false },
    ]);

    assert.strictEqual(store.items[0].children[0].children[0].isVisible, false);
    assert.strictEqual(store.items[0].children[1].isVisible, false);

    store.finishInitialLoad();
    assert.strictEqual(store.initialLoadInProgress, false);
    assert.strictEqual(store.initialLoadChunkReceived, 2);

    // 验证：同一批 chunks 内，后续 chunk 依赖前一个 chunk 新增的父节点
    // 这是大工程分批传输时的真实场景
    setActivePinia(createPinia());
    const nestedBatchStore = useMenuconfigStore();

    const root2 = createMenu({
        id: "root-2",
        name: "__MAINMENU__",
        title: "Root 2",
        type: menuType.menu,
        children: [],
    });
    nestedBatchStore.beginInitialLoad([root2], { totalChunks: 2 });

    const parentX = createMenu({
        id: "parent-x",
        name: "PARENT_X",
        title: "Parent X",
        type: menuType.menu,
        children: [],
    });
    const childX = createMenu({
        id: "child-x",
        name: "CHILD_X",
        title: "Child X",
        type: menuType.bool,
        value: true,
    });

    nestedBatchStore.appendInitialChunks([
        {
            parentId: "root-2",
            menus: [parentX],
            chunkIndex: 1,
            totalChunks: 2,
        },
        {
            parentId: "parent-x",
            menus: [childX],
            chunkIndex: 2,
            totalChunks: 2,
        },
    ]);

    assert.strictEqual(nestedBatchStore.items[0].children.length, 1);
    assert.strictEqual(nestedBatchStore.items[0].children[0].id, "parent-x");
    assert.strictEqual(nestedBatchStore.items[0].children[0].children.length, 1);
    assert.strictEqual(nestedBatchStore.items[0].children[0].children[0].id, "child-x");
}
