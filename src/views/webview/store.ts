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
}

export const useMenuconfigStore = defineStore("menuconfig", () => {
  const items: Ref<Menu[]> = ref([]);
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

  function handleVirtualNodeLoaded(menus: Menu[], nodeId?: string) {
    if (nodeId) {
      loadingVirtualNodes.value.delete(nodeId);
//////console.log(`✅ [STORE_DEBUG] 节点 ${nodeId} 懒加载完成，清除加载状态`);
    }
    items.value = menus;
//////console.log(`🎯 [VIRTUAL_NODE_DEBUG] Received virtual_node_loaded with ${menus.length} menus`);
  }

  function closeAllHelp() {
    // 更新时间戳以触发所有组件关闭帮助信息
    closeAllHelpTimestamp.value = Date.now();
  }

  return {
    items,
    searchString,
    selectedMenu,
    textDictionary,
    showDiscardConfirm,
    showResetConfirm,
    closeAllHelpTimestamp,
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
  };
});