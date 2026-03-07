import assert from "assert";

import { Menu, menuType } from "../menuconfig/Menu";
import {
    createInitialTransferMenus,
    createMenuDetailPayload,
    groupChunkTasksForBatches,
    splitMenusForChunkedTransfer,
} from "../menuconfig/MenuTransferSerializer";

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
        prompt: overrides.prompt,
        directDepExpr: overrides.directDepExpr,
        sourceFile: overrides.sourceFile,
        sourceFiles: overrides.sourceFiles,
        menuPath: overrides.menuPath,
        linenr: overrides.linenr,
        defaults: overrides.defaults,
    };
}

export async function runMenuTransferSerializerTests(): Promise<void> {
    const child = createMenu({
        id: "child-1",
        name: "CHILD_CFG",
        title: "Child Config",
        type: menuType.bool,
        value: true,
        help: "child help",
        menuPath: "(Top) -> Parent -> Child",
        sourceFile: "child/Kconfig",
        sourceFiles: ["Kconfig", "child/Kconfig"],
    });

    const parent = createMenu({
        id: "menu-1",
        name: "PARENT_MENU",
        title: "Parent Menu",
        type: menuType.menu,
        value: null,
        children: [child],
        help: "parent help",
        prompt: "Parent Prompt",
        directDepExpr: "SOC_X && BOARD_Y",
        sourceFile: "Kconfig",
        sourceFiles: ["Kconfig"],
        menuPath: "(Top) -> Parent",
        linenr: 42,
        defaults: [{ value: true, condition: "SOC_X" }],
        dependsOn: "SOC_X && BOARD_Y",
        isCollapsed: true,
        isMainMenu: false,
        isMenuconfig: true,
        hasPrompt: true,
        range: [0, 1],
        select: ["FEATURE_A"],
        selectedBy: ["FEATURE_B"],
    });

    const initial = createInitialTransferMenus([parent]);
    assert.strictEqual(initial.length, 1, "expected one root menu in initial payload");

    const initialRoot = initial[0] as any;
    assert.strictEqual(initialRoot.id, "menu-1");
    assert.strictEqual(initialRoot.children.length, 1);
    assert.strictEqual(initialRoot.help, undefined, "initial payload must not include help text");
    assert.strictEqual(initialRoot.menuPath, undefined, "initial payload must not include menuPath");
    assert.strictEqual(initialRoot.directDepExpr, undefined, "initial payload must not include direct dependency expression");
    assert.strictEqual(initialRoot.sourceFile, undefined, "initial payload must not include source file");
    assert.strictEqual(initialRoot.defaults, undefined, "initial payload must not include defaults");

    const chunked = splitMenusForChunkedTransfer([parent], 1);
    assert.strictEqual(chunked.skeletonMenus.length, 1, "expected one skeleton root menu");
    assert.strictEqual(chunked.skeletonMenus[0].children.length, 0, "skeleton root should not keep children");
    assert.strictEqual(chunked.chunks.length, 1, "expected one chunk task when chunk size is 1");
    assert.strictEqual(chunked.chunks[0].parentId, "menu-1");
    assert.strictEqual(chunked.chunks[0].children.length, 1);
    assert.strictEqual(chunked.chunks[0].children[0].id, "child-1");
    assert.strictEqual(
        chunked.chunks[0].children[0].children.length,
        0,
        "chunk node should be shallow and not include descendants"
    );

    const detail = createMenuDetailPayload(parent);
    assert.strictEqual(detail.help, "parent help");
    assert.strictEqual(detail.prompt, "Parent Prompt");
    assert.strictEqual(detail.directDepExpr, "SOC_X && BOARD_Y");
    assert.strictEqual(detail.menuPath, "(Top) -> Parent");
    assert.strictEqual(detail.sourceFile, "Kconfig");
    assert.deepStrictEqual(detail.sourceFiles, ["Kconfig"]);
    assert.deepStrictEqual(detail.defaults, [{ value: true, condition: "SOC_X" }]);

    const grandchild = createMenu({
        id: "grandchild-1",
        name: "GRANDCHILD_CFG",
        title: "Grandchild Config",
        type: menuType.bool,
        value: true,
    });
    const deepChild = createMenu({
        id: "child-2",
        name: "CHILD_2_CFG",
        title: "Child2 Config",
        type: menuType.menu,
        value: null,
        children: [grandchild],
    });
    const deepRoot = createMenu({
        id: "root-2",
        name: "ROOT_2",
        title: "Root 2",
        type: menuType.menu,
        value: null,
        children: [deepChild],
    });

    const deepChunked = splitMenusForChunkedTransfer([deepRoot], 1);
    assert.strictEqual(deepChunked.skeletonMenus[0].children.length, 0);
    assert.strictEqual(deepChunked.chunks.length, 2, "expected parent->child and child->grandchild chunks");
    assert.strictEqual(deepChunked.chunks[0].parentId, "root-2");
    assert.strictEqual(deepChunked.chunks[1].parentId, "child-2");
    assert.strictEqual(deepChunked.chunks[1].children[0].id, "grandchild-1");

    const groupedBatches = groupChunkTasksForBatches(
        [
            { parentId: "p1", children: [{ ...(chunked.chunks[0].children[0]) }] },
            { parentId: "p2", children: [{ ...(chunked.chunks[0].children[0]) }] },
            { parentId: "p3", children: [{ ...(chunked.chunks[0].children[0]) }] },
            { parentId: "p4", children: [{ ...(chunked.chunks[0].children[0]) }] },
            { parentId: "p5", children: [{ ...(chunked.chunks[0].children[0]) }] },
        ],
        2
    );
    assert.strictEqual(groupedBatches.length, 3, "expected 5 tasks grouped as 2/2/1");
    assert.strictEqual(groupedBatches[0].length, 2);
    assert.strictEqual(groupedBatches[1].length, 2);
    assert.strictEqual(groupedBatches[2].length, 1);
    assert.strictEqual(groupedBatches[0][0].parentId, "p1");
    assert.strictEqual(groupedBatches[2][0].parentId, "p5");
}
