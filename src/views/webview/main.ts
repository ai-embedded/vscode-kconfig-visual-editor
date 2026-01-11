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
import { createApp } from "vue";
import { createPinia } from "pinia";
import { useMenuconfigStore } from "./store";
import resolveTheme from "./themes";
import FrontendDebugger from "./debug";

//console.log("[WEBVIEW] Starting Vue app initialization...");

declare global {
  interface Window {
    __KCONFIG_THEME__?: string;
  }
}

const requestedTheme = typeof window !== "undefined" ? window.__KCONFIG_THEME__ : undefined;
const Menuconfig = resolveTheme(requestedTheme);
const app = createApp(Menuconfig);
const pinia = createPinia();

app.use(pinia);

//console.log("[WEBVIEW] Mounting Vue app to #menuconfig...");
app.mount("#menuconfig");

//console.log("[WEBVIEW] Vue app mounted successfully!");

const store = useMenuconfigStore();
//console.log("[WEBVIEW] Store initialized!");

// Helper function to find menu by ID
function _findMenuById(menus: any[], id: string): any | null {
  for (const menu of menus) {
    if (menu.id === id) {
      return menu;
    }
    if (menu.children) {
      const found = _findMenuById(menu.children, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// Helper function to merge only visibility updates without overwriting values
function mergeVisibilityUpdates(currentMenus: any[], newMenus: any[]): void {
  const mergeMenu = (current: any[], updated: any[]) => {
    for (let i = 0; i < current.length; i++) {
      const currentMenu = current[i];
      const updatedMenu = updated.find(m => m.id === currentMenu.id);
      
      if (updatedMenu) {
        // Create a new object to ensure Vue detects the change
        const updatedProperties: any = {
          isVisible: updatedMenu.isVisible,
          isReadonly: updatedMenu.isReadonly,
          readonlyReason: updatedMenu.readonlyReason,
          selectedBy: updatedMenu.selectedBy,
          autoSelectedValue: updatedMenu.autoSelectedValue,
          autoImpliedValue: updatedMenu.autoImpliedValue
        };
        
        // Special case: If this item has selectedBy relationships or was auto-selected, sync the value from backend
        // This ensures auto-selected items display correctly and handles deselection properly
        if ((updatedMenu.type === 'bool' && 
             ((updatedMenu.selectedBy && updatedMenu.selectedBy.length > 0) || 
              updatedMenu.autoSelectedValue !== undefined ||
              currentMenu.autoSelectedValue !== undefined)) ||
            (updatedMenu.type === 'tristate' &&
             (updatedMenu.autoImpliedValue !== undefined ||
              currentMenu.autoImpliedValue !== undefined))) {
          updatedProperties.value = updatedMenu.value;
        }
        
        // Replace the object in the array to trigger Vue reactivity
        current[i] = { ...currentMenu, ...updatedProperties };
        
        if (current[i].children && updatedMenu.children) {
          mergeMenu(current[i].children, updatedMenu.children);
        }
      }
    }
  };
  
  mergeMenu(currentMenus, newMenus);
}

window.addEventListener("message", (event: any) => {
  const message = event.data;
  //console.log("[WEBVIEW] Received message:", message.command);
  
  switch (message.command) {
    case "load_initial_values":
      if (message.menus) {
        //console.log(`[WEBVIEW] Received ${message.menus.length} menus`);
        if (message.menus.length > 0) {
          //console.log(`[WEBVIEW] First menu: name="${message.menus[0].name}", title="${message.menus[0].title}", children=${message.menus[0].children?.length || 0}`);
          if (message.menus[0].children && message.menus[0].children.length > 0) {
            //console.log(`[WEBVIEW] First child: name="${message.menus[0].children[0].name}", title="${message.menus[0].children[0].title}"`);
          }
        }
        store.replaceItems(message.menus, { preserveCollapse: false });
        //console.log(`[WEBVIEW] Store items set, store.items.length = ${store.items.length}`);
      }
      if (message.debugConfig) {
        FrontendDebugger.initConfig(message.debugConfig);
      }
      break;
    case "update_values":
      if (message.updated_values) {
        store.replaceItems(message.updated_values);
      }
      break;
    case "load_dictionary":
      if (message.text_dictionary) {
        store.textDictionary = message.text_dictionary;
      }
      break;
    case "visibility_updated":
      if (message.menus) {
        // Instead of completely replacing store.items, merge only visibility changes
        // to preserve any pending value updates
        mergeVisibilityUpdates(store.items, message.menus);
      }
      break;
    case "visibility_delta":
      if (message.changes) {
        store.applyVisibilityDelta(message.changes);
      }
      break;
    case "value_updated":
      if (message.menu) {
        store.updateMenuItem(message.menu);
      }
      break;
    case "virtual_node_loaded":
      // Handle lazy-loaded virtual node content
      if (message.menus) {
        store.handleVirtualNodeLoaded(message.menus, message.nodeId);
      }
      break;
    case "color_theme_changed":
      if (message.themeKind) {
        store.setColorThemeKind(message.themeKind);
      }
      break;
    default:
      break;
  }
});
