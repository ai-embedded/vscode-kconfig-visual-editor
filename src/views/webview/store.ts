/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { defineStore } from "pinia";
import { ref, Ref, computed } from "vue";
import { Menu } from "../../menuconfig/Menu";

type ColorThemeKindKey = "light" | "dark";

declare var acquireVsCodeApi: any;
let vscode: any;
try {
  //console.log("[STORE] Acquiring VSCode API...");
  vscode = acquireVsCodeApi();
  //console.log("[STORE] VSCode API acquired successfully!");
} catch (error) {
  // tslint:disable-next-line: no-console
  console.error("[STORE] Failed to acquire VSCode API:", error);
}

function postMessageSafely(message: any): void {
  if (!vscode || typeof vscode.postMessage !== "function") {
    console.error("[STORE] postMessage skipped: VSCode API unavailable", message?.command || message);
    return;
  }
  vscode.postMessage(message);
}

export interface State {
  items: Menu[];
  selectedMenu: string;
  searchString: string;
  textDictionary: {
    save: string;
    discard: string;
    reset: string;
  };
  showDiscardConfirm: boolean;
  showResetConfirm: boolean;
  colorThemeKind: ColorThemeKindKey;
}

export const useMenuconfigStore = defineStore("menuconfig", () => {
  const items: Ref<Menu[]> = ref([]);
  const menuIndex = ref(new Map<string, Menu>());
  const _selectedMenu = ref("");
  const searchString = ref("");
  const showDiscardConfirm = ref(false);
  const showResetConfirm = ref(false);
  const closeAllHelpTimestamp = ref(0); // 用于触发关闭所有帮助信息
  const initialLoadInProgress = ref(false);
  const initialLoadChunkTotal = ref(0);
  const initialLoadChunkReceived = ref(0);
  const menuDetailLoadedIds = ref(new Set<string>());
  const menuDetailPendingIds = ref(new Set<string>());
  const textDictionary: Ref<{
    save: string;
    discard: string;
    reset: string;
  }> = ref({
    save: "Save",
    discard: "Discard",
    reset: "Reset",
  });

  const initialColorThemeKind: ColorThemeKindKey =
    typeof window !== "undefined" &&
    (window as typeof window & { __KCONFIG_VSCODE_COLOR_THEME__?: string }).__KCONFIG_VSCODE_COLOR_THEME__ === "light"
      ? "light"
      : "dark";

  const colorThemeKind = ref<ColorThemeKindKey>(initialColorThemeKind);

  const selectedMenu = computed({
    get: () => _selectedMenu.value,
    set: (value: string) => {
      _selectedMenu.value = value;
    }
  });

  function sendNewValue(newValue: any) {
    const message = {
      command: "updateValue",
      updated_value: JSON.stringify(newValue),
      timestamp: Date.now()
    };
    
    postMessageSafely(message);
  }

  function saveGuiConfig() {
    // Save current items
    postMessageSafely({
      command: "saveChanges",
    });
  }

  function resetGuiConfig() {
    // Show confirmation dialog before discarding
    showDiscardConfirm.value = true;
  }

  function confirmDiscard() {
    // Hide dialog and perform discard
    showDiscardConfirm.value = false;
    postMessageSafely({
      command: "discardChanges",
    });
  }

  function cancelDiscard() {
    // Just hide the dialog
    showDiscardConfirm.value = false;
  }

  function requestInitValues() {
    //console.log("[STORE] Sending requestInitValues message to backend");
    postMessageSafely({
      command: "requestInitValues",
    });
  }

  function requestMenuDetail(id: string) {
    if (!id) {
      return;
    }
    if (menuDetailLoadedIds.value.has(id) || menuDetailPendingIds.value.has(id)) {
      return;
    }
    const nextPending = new Set(menuDetailPendingIds.value);
    nextPending.add(id);
    menuDetailPendingIds.value = nextPending;
    postMessageSafely({
      command: "requestMenuDetail",
      id,
    });
  }

  function beginInitialLoad(newMenus: Menu[], meta?: { totalChunks?: number }) {
    const totalChunks = meta?.totalChunks;
    initialLoadInProgress.value = true;
    initialLoadChunkTotal.value = typeof totalChunks === "number" && totalChunks > 0 ? totalChunks : 0;
    initialLoadChunkReceived.value = 0;
    replaceItems(newMenus, { preserveCollapse: false });
  }

  function appendInitialChunk(parentId: string, chunkMenus: Menu[], chunkIndex?: number, totalChunks?: number) {
    if (!parentId || !Array.isArray(chunkMenus) || chunkMenus.length === 0) {
      return;
    }

    const parent = getMenuById(parentId);
    if (!parent) {
      return;
    }

    if (!Array.isArray(parent.children)) {
      parent.children = [];
    }
    parent.children.push(...chunkMenus);
    const nextIndex = new Map(menuIndex.value);
    appendToIndexMap(nextIndex, chunkMenus);
    menuIndex.value = nextIndex;

    if (typeof totalChunks === "number" && totalChunks > 0) {
      initialLoadChunkTotal.value = totalChunks;
    }
    if (typeof chunkIndex === "number" && chunkIndex > 0) {
      initialLoadChunkReceived.value = Math.max(initialLoadChunkReceived.value, chunkIndex);
    } else {
      initialLoadChunkReceived.value += 1;
    }
  }

  function appendInitialChunks(chunks: Array<{
    parentId: string;
    menus: Menu[];
    chunkIndex?: number;
    totalChunks?: number;
  }>) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return;
    }

    let maxChunkReceived = initialLoadChunkReceived.value;
    let maxTotalChunks = initialLoadChunkTotal.value;
    let hasAnonymousChunk = false;
    const nextIndex = new Map(menuIndex.value);
    let indexChanged = false;

    for (const chunk of chunks) {
      if (!chunk || !chunk.parentId || !Array.isArray(chunk.menus) || chunk.menus.length === 0) {
        continue;
      }

      const parent = nextIndex.get(chunk.parentId);
      if (!parent) {
        continue;
      }

      if (!Array.isArray(parent.children)) {
        parent.children = [];
      }
      parent.children.push(...chunk.menus);
      appendToIndexMap(nextIndex, chunk.menus);
      indexChanged = true;

      if (typeof chunk.totalChunks === "number" && chunk.totalChunks > 0) {
        maxTotalChunks = Math.max(maxTotalChunks, chunk.totalChunks);
      }
      if (typeof chunk.chunkIndex === "number" && chunk.chunkIndex > 0) {
        maxChunkReceived = Math.max(maxChunkReceived, chunk.chunkIndex);
      } else {
        hasAnonymousChunk = true;
      }
    }

    initialLoadChunkTotal.value = maxTotalChunks;
    initialLoadChunkReceived.value = hasAnonymousChunk
      ? Math.max(maxChunkReceived, initialLoadChunkReceived.value + 1)
      : maxChunkReceived;
    if (indexChanged) {
      menuIndex.value = nextIndex;
    }
  }

  function finishInitialLoad() {
    if (initialLoadChunkTotal.value > 0 && initialLoadChunkReceived.value < initialLoadChunkTotal.value) {
      initialLoadChunkReceived.value = initialLoadChunkTotal.value;
    }
    initialLoadInProgress.value = false;
  }

  function setDefaultConfig() {
    // Show confirmation dialog before reset
    showResetConfirm.value = true;
  }

  function confirmReset() {
    // Hide dialog and perform reset
    showResetConfirm.value = false;
    postMessageSafely({
      command: "setDefault",
    });
  }

  function cancelReset() {
    // Just hide the dialog
    showResetConfirm.value = false;
  }

  function toggleMenuCollapse(menu: Menu) {
    menu.isCollapsed = !menu.isCollapsed;
  }

  function setMenuCollapseById(id: string, collapsed: boolean) {
    const updateCollapse = (menus: Menu[]): boolean => {
      for (const item of menus) {
        const matchesId = item.id === id;
        const matchesName = !item.id && item.name === id;
        if (matchesId || matchesName) {
          item.isCollapsed = collapsed;
          return true;
        }
        if (item.children && item.children.length > 0) {
          if (updateCollapse(item.children)) {
            return true;
          }
        }
      }
      return false;
    };

    updateCollapse(items.value);
  }

  function setAllMenusCollapsed(collapsed: boolean, menus?: Menu[]) {
    const menusToProcess = menus || items.value;
    menusToProcess.forEach(item => {
      // 判断是否为 mainmenu，与 configElement.vue 中的 isMainMenu 逻辑保持一致
      const isMainMenu = item.isMainMenu === true ||
                        (typeof item.id === 'string' && item.id.startsWith("mainmenu-")) ||
                        item.name === "__MAINMENU__";

      // 只对非 mainmenu 的 menu 类型项进行折叠操作
      if (item.type === 'menu' && !isMainMenu) {
        item.isCollapsed = collapsed;
      }
      if (item.children && item.children.length > 0) {
        setAllMenusCollapsed(collapsed, item.children);
      }
    });
  }

  function collapseAllMenus() {
    setAllMenusCollapsed(true);
  }

  function expandAllMenus() {
    setAllMenusCollapsed(false);
  }

  function collectCollapseStates(menus: Menu[] | undefined, map: Map<string, boolean>) {
    if (!menus) {
      return;
    }
    menus.forEach(menu => {
      if (!menu) {
        return;
      }
      const key = menu.id || menu.name;
      if (key && typeof menu.isCollapsed === "boolean") {
        map.set(key, menu.isCollapsed);
      }
      if (menu.children && menu.children.length > 0) {
        collectCollapseStates(menu.children, map);
      }
    });
  }

  function applyCollapseStates(menus: Menu[] | undefined, map: Map<string, boolean>) {
    if (!menus || map.size === 0) {
      return;
    }
    menus.forEach(menu => {
      if (!menu) {
        return;
      }
      const key = menu.id || menu.name;
      if (key && map.has(key)) {
        menu.isCollapsed = map.get(key)!;
      }
      if (menu.children && menu.children.length > 0) {
        applyCollapseStates(menu.children, map);
      }
    });
  }

  function replaceItems(newMenus: Menu[], options?: { preserveCollapse?: boolean }) {
    if (!Array.isArray(newMenus)) {
      items.value = [];
      menuIndex.value = new Map();
      menuDetailLoadedIds.value = new Set();
      menuDetailPendingIds.value = new Set();
      initialLoadInProgress.value = false;
      initialLoadChunkTotal.value = 0;
      initialLoadChunkReceived.value = 0;
      return;
    }

    const preserveCollapse = options?.preserveCollapse ?? true;

    if (preserveCollapse && items.value && items.value.length > 0) {
      const collapseMap = new Map<string, boolean>();
      collectCollapseStates(items.value, collapseMap);
      applyCollapseStates(newMenus, collapseMap);
    }

    items.value = newMenus;
    rebuildIndex(items.value);
    menuDetailLoadedIds.value = new Set();
    menuDetailPendingIds.value = new Set();
  }

  function rebuildIndex(menus: Menu[]): void {
    const newIndex = new Map<string, Menu>();
    appendToIndexMap(newIndex, menus);
    menuIndex.value = newIndex;
  }

  function appendToIndexMap(nextIndex: Map<string, Menu>, menus: Menu[]): void {
    const stack: Menu[] = [...menus];
    while (stack.length > 0) {
      const menu = stack.pop();
      if (!menu) {
        continue;
      }
      if (menu.id) {
        nextIndex.set(menu.id, menu);
      }
      if (menu.children && menu.children.length > 0) {
        for (let i = 0; i < menu.children.length; i++) {
          stack.push(menu.children[i]);
        }
      }
    }
  }

  function getMenuById(id: string): Menu | undefined {
    return menuIndex.value.get(id);
  }

  function applyVisibilityDelta(changes: Array<{
    id: string;
    isVisible?: boolean;
    isContainerVisible?: boolean;
    isReadonly?: boolean;
    readonlyReason?: string;
    selectedBy?: string[];
    autoSelectedValue?: boolean;
    autoImpliedValue?: 'y' | 'm' | boolean;
    value?: any;
  }>) {
    if (!changes || changes.length === 0) {
      return;
    }

    changes.forEach(change => {
      if (!change || !change.id) {
        return;
      }
      const target = getMenuById(change.id);
      if (!target) {
        return;
      }

      if (typeof change.isVisible === 'boolean') {
        target.isVisible = change.isVisible;
      }
      if (typeof change.isContainerVisible === 'boolean') {
        (target as any).isContainerVisible = change.isContainerVisible;
      }
      if (typeof change.isReadonly === 'boolean') {
        target.isReadonly = change.isReadonly;
      }
      if (change.readonlyReason !== undefined) {
        target.readonlyReason = change.readonlyReason;
      }
      if (change.selectedBy !== undefined) {
        target.selectedBy = Array.isArray(change.selectedBy) ? [...change.selectedBy] : [];
      }
      if (change.autoSelectedValue !== undefined) {
        target.autoSelectedValue = change.autoSelectedValue;
      }
      if (change.autoImpliedValue !== undefined) {
        target.autoImpliedValue = change.autoImpliedValue;
      }
      if (change.value !== undefined) {
        target.value = change.value;
      }
    });
  }

  function applyMenuDetail(id: string, detail: Partial<Menu> | null | undefined) {
    if (!id) {
      return;
    }

    if (menuDetailPendingIds.value.has(id)) {
      const nextPending = new Set(menuDetailPendingIds.value);
      nextPending.delete(id);
      menuDetailPendingIds.value = nextPending;
    }

    if (!detail) {
      return;
    }

    const target = getMenuById(id);
    if (!target) {
      return;
    }

    Object.assign(target, detail);
    const nextLoaded = new Set(menuDetailLoadedIds.value);
    nextLoaded.add(id);
    menuDetailLoadedIds.value = nextLoaded;
  }

  function closeAllHelp() {
    // 更新时间戳以触发所有组件关闭帮助信息
    closeAllHelpTimestamp.value = Date.now();
  }

  function setColorThemeKind(kind: string) {
    colorThemeKind.value = kind === "light" ? "light" : "dark";
  }

  return {
    items,
    searchString,
    selectedMenu,
    textDictionary,
    showDiscardConfirm,
    showResetConfirm,
    closeAllHelpTimestamp,
    colorThemeKind,
    initialLoadInProgress,
    initialLoadChunkTotal,
    initialLoadChunkReceived,
    sendNewValue,
    setDefaultConfig,
    saveGuiConfig,
    resetGuiConfig,
    confirmDiscard,
    cancelDiscard,
    confirmReset,
    cancelReset,
    requestInitValues,
    beginInitialLoad,
    appendInitialChunk,
    appendInitialChunks,
    finishInitialLoad,
    requestMenuDetail,
    toggleMenuCollapse,
    collapseAllMenus,
    expandAllMenus,
    closeAllHelp,
    replaceItems,
    setMenuCollapseById,
    setColorThemeKind,
    applyVisibilityDelta,
    applyMenuDetail,
  };
});
