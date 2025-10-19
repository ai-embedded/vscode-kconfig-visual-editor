<!--
 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
 
    http://www.apache.org/licenses/LICENSE-2.0
 
 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
-->

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, nextTick } from "vue";
import { useMenuconfigStore } from "./store";
import { Menu } from "../../menuconfig/Menu";
import ConfigElement from "./components/configElement.vue";
import SearchBar from "./components/SearchBar.vue";
import SettingsTree from "./components/SettingsTree.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import { t } from "./i18n";

const store = useMenuconfigStore();
const isDragging = ref(false);
const treeWidth = ref(300); // Default width in pixels (minimum - collapsed by default)
const minTreeWidth = 300; // Minimum width in pixels
const maxTreeWidth = 600; // Maximum width in pixels
const minContentWidth = 300; // Minimum width in pixels

function throttle<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let throttled = false;
  return function (this: any, ...args: Parameters<T>) {
    if (!throttled) {
      fn.apply(this, args);
      throttled = true;
      setTimeout(() => {
        throttled = false;
      }, wait);
    }
  } as T;
}

function filterItems(items: Menu[], searchString: string) {
  const filteredItems: Menu[] = [];
  items.forEach((item) => {
    if (item.isVisible) {
      if (
        item.isVisible &&
        item.name &&
        item.name.toLowerCase().indexOf(searchString) >= 0
      ) {
        filteredItems.push(item);
      } else if (
        item.isVisible &&
        item.title &&
        item.title.toLowerCase().indexOf(searchString) >= 0
      ) {
        filteredItems.push(item);
      } else {
        const filteredChildren = filterItems(item.children, searchString);
        if (filteredChildren.length > 0) {
          const newItem = Object.assign({}, item);
          newItem.children = filteredChildren;
          filteredItems.push(newItem);
        }
      }
    }
  });
  return filteredItems;
}

// Helper function to find a menu by ID in the menu tree
function findMenuById(items: Menu[], menuId: string): Menu | null {
  for (const item of items) {
    if (item.id === menuId) {
      return item;
    }
    if (item.children && item.children.length > 0) {
      const found = findMenuById(item.children, menuId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

const items = computed(() => {
  // Always filter by visibility first
  const visibleItems = filterItemsByVisibility(store.items);

  // Handle search
  if (store.searchString !== "") {
    let searchStrMatch = /^(?:CONFIG_)?(.+)/.exec(store.searchString);
    let searchMatch =
      searchStrMatch && searchStrMatch.length > 1
        ? searchStrMatch[1].toLowerCase()
        : store.searchString.toLowerCase();
    return filterItems(visibleItems, searchMatch);
  }

  // Always show all items, clicking left menu will just scroll to the position
  // selectedMenu is only used for scroll positioning in handleMenuSelect
  return visibleItems;
});

function filterItemsByVisibility(items: Menu[]): Menu[] {
  const visibleItems: Menu[] = [];

  items.forEach((item) => {
    const cloned = { ...item };
    const filteredChildren = item.children
      ? filterItemsByVisibility(item.children)
      : [];

    const isImplicitContainer =
      item.isImplicitContainer &&
      item.isContainerVisible === true &&
      item.isVisible === false;

    if (isImplicitContainer) {
      // Flatten implicit containers so their children appear at this level
      visibleItems.push(...filteredChildren);
      return;
    }

    const isMainMenu = item.isMainMenu === true;
    const isVisible = item.isVisible !== false;
    const isContainer = item.isContainerVisible === true;

    if (item.children && item.children.length > 0) {
      // Only keep containers that are visible, explicitly marked as container visible, or are the main menu
      if (!isVisible && !isContainer && !isMainMenu) {
        return;
      }

      // Avoid keeping empty containers when they and their children are hidden
      if (filteredChildren.length === 0 && !isVisible && !isMainMenu) {
        return;
      }

      cloned.children = filteredChildren;
      visibleItems.push(cloned);
      return;
    }

    // Leaf nodes should only appear when they are visible
    if (isVisible) {
      cloned.children = [];
      visibleItems.push(cloned);
    }
  });

  return visibleItems;
}

function onScroll() {
  const configList = document.querySelector(".config-list") as HTMLElement;
  if (!configList) return;

  const sections = Array.from(document.querySelectorAll(".submenu.form-group")) as HTMLElement[];
  if (sections.length === 0) return;

  const scrollTop = configList.scrollTop;
  let currentSection: HTMLElement | null = null;
  for (const section of sections) {
    if (section.offsetTop - configList.offsetTop <= scrollTop) {
      currentSection = section;
    } else {
      break;
    }
  }

  if (currentSection) {
    const sectionId = currentSection.id;
    if (sectionId && store.selectedMenu !== sectionId) {
      store.selectedMenu = sectionId;
    }
  }
}

const throttledScrollHandler = throttle((event: any) => {
  onScroll();
}, 50);

const handleScroll = (event: any) => {
  throttledScrollHandler(event);
};

// Recursively find and expand the menu path to the target menu
function expandMenuPath(items: Menu[], targetId: string, path: Menu[] = []): boolean {
  for (const item of items) {
    if (item.id === targetId) {
      // Found the target, expand all menus in the path
      path.forEach(menu => {
        if (menu.type === 'menu' || menu.isMenuconfig) {
          menu.isCollapsed = false;
        }
      });
      // Expand the target menu itself if it's a menu type
      if ((item.type === 'menu' || item.isMenuconfig) && item.isCollapsed) {
        item.isCollapsed = false;
      }
      return true;
    }
    if (item.children && item.children.length > 0) {
      if (expandMenuPath(item.children, targetId, [...path, item])) {
        return true;
      }
    }
  }
  return false;
}

function handleMenuSelect(value: string) {
  store.selectedMenu = value;

  // First, expand the menu path to make the target visible
  expandMenuPath(store.items, value);

  // Wait for DOM to update, then scroll to the element
  nextTick(() => {
    const secNew = document.querySelector('#' + value) as HTMLElement;
    if (secNew) {
      secNew.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function handleMouseDown(e: MouseEvent) {
  isDragging.value = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;

  const mainElement = document.getElementById('main');
  if (!mainElement) return;

  const mainRect = mainElement.getBoundingClientRect();
  const newWidth = e.clientX - mainRect.left;

  if (newWidth >= minTreeWidth && newWidth <= maxTreeWidth) {
    treeWidth.value = newWidth;
  }
}

function handleMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

onMounted(() => {
  store.requestInitValues();
  const scrollableDiv = document.getElementById("scrollable");
  if (scrollableDiv) {
    scrollableDiv.addEventListener("scroll", handleScroll);
  }
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
});

onUnmounted(() => {
  const scrollableDiv = document.getElementById("scrollable");
  if (scrollableDiv) {
    scrollableDiv.removeEventListener("scroll", handleScroll);
  }
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
});
</script>

<template>
  <div class="app-container">
    <SearchBar />
    <div id="main" class="grid-container">
      <div class="sidenav" :style="{ width: treeWidth + 'px', minWidth: treeWidth + 'px', maxWidth: treeWidth + 'px' }">
        <SettingsTree :data="store.items" @select="handleMenuSelect" />
      </div>
      <div
        class="resize-handle"
        @mousedown="handleMouseDown"
        :class="{ 'dragging': isDragging }"
      ></div>
      <div id="scrollable" class="config-list" @scroll="handleScroll">
        <ConfigElement
          :config="config"
          v-for="config in items"
          :key="config.id"
        />
      </div>
    </div>
    
    <!-- Discard Confirmation Dialog -->
    <ConfirmDialog
      :visible="store.showDiscardConfirm"
      :title="t('discard.confirmTitle')"
      :message="t('discard.confirmMessage')"
      :confirm-text="t('common.confirm')"
      :cancel-text="t('common.cancel')"
      @confirm="store.confirmDiscard"
      @cancel="store.cancelDiscard"
    />
    
    <!-- Reset Confirmation Dialog -->
    <ConfirmDialog
      :visible="store.showResetConfirm"
      :title="t('reset.confirmTitle')"
      :message="t('reset.confirmMessage')"
      :confirm-text="t('common.confirm')"
      :cancel-text="t('common.cancel')"
      @confirm="store.confirmReset"
      @cancel="store.cancelReset"
    />
  </div>
</template>

<style lang="scss">
@import "../commons/commons.scss";
.app-container {
  width: 100%;
  height: 100vh;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.grid-container {
  display: grid;
  grid-template-columns: auto 4px 1fr;
  height: 90vh;
  position: relative;
  overflow: hidden;
  width: 100%;
}

.resize-handle {
  width: 4px;
  background-color: transparent;
  cursor: col-resize;
  transition: background-color 0.1s;
  z-index: 1;
  position: relative;

  &:hover {
    background-color: var(--vscode-sash-hoverBorder);
  }

  &.dragging {
    background-color: var(--vscode-sash-activeBorder);
  }

  &::before {
    content: '';
    position: absolute;
    left: -4px;
    top: 0;
    width: 12px;
    height: 100%;
    cursor: col-resize;
  }
}

p {
  color: var(--vscode-editor-foreground);
}

.config-list {
  overflow: auto;
  color: var(--vscode-foreground);
  flex: 1;
  padding: 1rem 1.5rem;
}

.sidenav {
  overflow: auto;
  height: 90vh;
  border-right: 1px solid var(--vscode-panel-border);
  padding: 0 0.5rem;
}

.sidenav ul li {
  cursor: pointer;
}

.sidenav ul p {
  text-decoration: none;
  display: block;
}

.sidenav ul p:hover {
  color: var(--vscode-textLink-activeForeground);
}

.help-kconfig-title {
  margin: 0;
  padding: 0;
  width: 100%;
  max-width: 100%;
  word-wrap: break-word;
  box-sizing: border-box;
}

ul > li {
  list-style-type: none;
}

span {
  color: rgb(231, 76, 60);
  border-style: solid;
  border-color: var(--vscode-settings-textInputForeground);
  border-width: 0.5px;
  padding: 3px;
  display: inline-flex;
}

.content ul li {
  list-style-type: disc;
}
</style>
