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

declare global {
  interface Window {
    __KCONFIG_VSCODE_COLOR_THEME__?: string;
  }
}

declare var acquireVsCodeApi: any;
let vscode: any;
try {
  //console.log("[STORE] Acquiring VSCode API...");
  vscode = acquireVsCodeApi();
  //console.log("[STORE] VSCode API acquired successfully!");
} catch (error) {
  // tslint:disable-next-line: no-console
  //console.error("[STORE] Failed to acquire VSCode API:", error);
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
    typeof window !== "undefined" && window.__KCONFIG_VSCODE_COLOR_THEME__ === "light"
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
    
    vscode.postMessage(message);
  }

  function saveGuiConfig() {
    // Save current items
    vscode.postMessage({
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
    vscode.postMessage({
      command: "discardChanges",
    });
  }

  function cancelDiscard() {
    // Just hide the dialog
    showDiscardConfirm.value = false;
  }

  function requestInitValues() {
    //console.log("[STORE] Sending requestInitValues message to backend");
    vscode.postMessage({
      command: "requestInitValues",
    });
  }

  function setDefaultConfig() {
    // Show confirmation dialog before reset
    showResetConfirm.value = true;
  }

  function confirmReset() {
    // Hide dialog and perform reset
    showResetConfirm.value = false;
    vscode.postMessage({
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

  // 🔑 修复重复懒加载：跟踪正在加载的虚拟节点
  const loadingVirtualNodes = ref(new Set<string>());

  function loadVirtualNodeContent(nodeId: string) {
    // 防止重复加载同一个虚拟节点
    if (loadingVirtualNodes.value.has(nodeId)) {
//////console.log(`🚫 [STORE_DEBUG] 节点 ${nodeId} 已在加载中，跳过重复请求`);
      return;
    }

//////console.log(`📡 [STORE_DEBUG] 发送懒加载请求: ${nodeId}`);
    loadingVirtualNodes.value.add(nodeId);
    
    vscode.postMessage({
      command: "loadVirtualNode",
      nodeId: nodeId,
      timestamp: Date.now()
    });
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
  }

  function updateMenuItem(updatedMenu: Menu): boolean {
    const updateIndexForMenu = (menu: Menu) => {
      if (menu.id) {
        menuIndex.value.set(menu.id, menu);
      }
      if (menu.children && menu.children.length > 0) {
        menu.children.forEach(updateIndexForMenu);
      }
    };

    const update = (menus: Menu[]): boolean => {
      for (let i = 0; i < menus.length; i++) {
        if (menus[i].id === updatedMenu.id) {
          menus[i] = { ...menus[i], ...updatedMenu };
          updateIndexForMenu(menus[i]);
          return true;
        }
        if (menus[i].children && menus[i].children.length > 0) {
          if (update(menus[i].children)) {
            return true;
          }
        }
      }
      return false;
    };

    return update(items.value);
  }

  function handleVirtualNodeLoaded(menus: Menu[], nodeId?: string) {
    if (nodeId) {
      loadingVirtualNodes.value.delete(nodeId);
//////console.log(`✅ [STORE_DEBUG] 节点 ${nodeId} 懒加载完成，清除加载状态`);
    }
    replaceItems(menus);
//////console.log(`🎯 [VIRTUAL_NODE_DEBUG] Received virtual_node_loaded with ${menus.length} menus`);
  }

  function rebuildIndex(menus: Menu[]): void {
    const newIndex = new Map<string, Menu>();

    const stack: Menu[] = [...menus];
    while (stack.length > 0) {
      const menu = stack.pop();
      if (!menu) {
        continue;
      }
      if (menu.id) {
        newIndex.set(menu.id, menu);
      }
      if (menu.children && menu.children.length > 0) {
        for (let i = 0; i < menu.children.length; i++) {
          stack.push(menu.children[i]);
        }
      }
    }

    menuIndex.value = newIndex;
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
    sendNewValue,
    setDefaultConfig,
    saveGuiConfig,
    resetGuiConfig,
    confirmDiscard,
    cancelDiscard,
    confirmReset,
    cancelReset,
    requestInitValues,
    toggleMenuCollapse,
    collapseAllMenus,
    expandAllMenus,
    closeAllHelp,
    loadVirtualNodeContent,
    handleVirtualNodeLoaded,
    replaceItems,
    setMenuCollapseById,
    setColorThemeKind,
    applyVisibilityDelta,
    updateMenuItem,
  };
});
