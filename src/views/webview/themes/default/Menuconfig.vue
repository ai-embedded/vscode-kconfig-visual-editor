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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useMenuconfigStore } from "../../store";
import { Menu, menuType } from "../../../../menuconfig/Menu";
import VirtualConfigRow from "./components/VirtualConfigRow.vue";
import SearchBar from "./components/SearchBar.vue";
import SettingsTree from "./components/SettingsTree.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import { t } from "../../i18n";

const store = useMenuconfigStore();

const isDragging = ref(false);
const treeWidth = ref(300);
const minTreeWidth = 300;
const maxTreeWidth = 600;
const minContentWidth = 300;

const scrollContainer = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
const resizeObserver = ref<ResizeObserver | null>(null);

const defaultRowHeight = 48;
const overscanPx = 200;
const overscanCount = 10;

interface FlatMenuItem {
  id: string;
  config: Menu;
  depth: number;
}

function isMainMenu(menu: Menu): boolean {
  if (menu.isMainMenu === true) {
    return true;
  }
  const id = menu.id || "";
  if (typeof id === "string" && id.startsWith("mainmenu-")) {
    return true;
  }
  return menu.name === "__MAINMENU__";
}

const flatItems = computed<FlatMenuItem[]>(() => {
  const result: FlatMenuItem[] = [];
  const searchTermRaw = store.searchString ?? "";
  const searchTerm = searchTermRaw.trim().toLowerCase();
  const searchActive = searchTerm.length > 0;

  const matchesSearch = (menu: Menu) => {
    if (!searchActive) {
      return true;
    }
    const name = menu.name ? menu.name.toLowerCase() : "";
    const title = menu.title ? menu.title.toLowerCase() : "";
    return name.includes(searchTerm) || title.includes(searchTerm);
  };

  const traverseMenu = (menu: Menu, depth: number): { hasMatch: boolean; items: FlatMenuItem[] } => {
    const isImplicitContainer =
      menu.isImplicitContainer === true &&
      (menu as any).isContainerVisible === true &&
      menu.isVisible === false;

    // mainmenu 需要单独识别，用于强制渲染与缩进
    const isRootMainMenu = isMainMenu(menu) && depth === 0;

    const matchesNode = matchesSearch(menu);
    const childDepth = (menu.shouldIndentChildren || isRootMainMenu) ? depth + 1 : depth;

    const childResults: { hasMatch: boolean; items: FlatMenuItem[] }[] = [];
    let childHasMatch = false;

    if (menu.children && menu.children.length > 0) {
      for (const child of menu.children) {
        const childResult = traverseMenu(child, isImplicitContainer ? depth : childDepth);
        childResults.push(childResult);
        if (childResult.hasMatch) {
          childHasMatch = true;
        }
      }
    }

    // 与 Kconfiglib 行为一致：只要未被显式隐藏（!== false）即可视为可见
    const isVisible = menu.isVisible !== false;
    const isContainerVisible = (menu as any).isContainerVisible === true;

    // mainmenu 始终渲染并展开（与之前行为保持一致）
    let shouldRender = isRootMainMenu || (!isImplicitContainer && (isVisible || isContainerVisible));
    if (searchActive) {
      shouldRender = isRootMainMenu || (!isImplicitContainer && (matchesNode || childHasMatch));
    }

    const items: FlatMenuItem[] = [];
    if (shouldRender) {
      items.push({
        id: menu.id,
        config: menu,
        depth
      });
    }

    const expandChildren = (() => {
      // choice 下的子项只应在下拉列表中出现，不参与平铺渲染
      if (menu.type === menuType.choice) {
        return false;
      }
      if (isImplicitContainer || isRootMainMenu) {
        return true;
      }
      if (!menu.children || menu.children.length === 0) {
        return false;
      }
      if (searchActive) {
        return matchesNode || childHasMatch;
      }
      if (menu.type === menuType.menu || menu.isMenuconfig) {
        return !menu.isCollapsed;
      }
      return true;
    })();

    if (menu.children && menu.children.length > 0) {
      if (isImplicitContainer || expandChildren) {
        for (const childResult of childResults) {
          if (childResult.items.length > 0) {
            items.push(...childResult.items);
          }
        }
      }
    }

    const hasMatch = shouldRender || childHasMatch || (searchActive && matchesNode);
    return { hasMatch, items };
  };

  const traverseList = (menus: Menu[], depth: number) => {
    for (const menu of menus) {
      const resultData = traverseMenu(menu, depth);
      if (resultData.items.length > 0) {
        result.push(...resultData.items);
      }
    }
  };

  traverseList(store.items, 0);
  return result;
});

const flatIndexMap = computed(() => {
  const map = new Map<string, number>();
  flatItems.value.forEach((item, index) => {
    if (item.id) {
      map.set(item.id, index);
    }
  });
  return map;
});

const itemHeights = ref(new Map<string, number>());

function handleHeightChange(id: string, height: number) {
  if (!id || height <= 0) {
    return;
  }
  const current = itemHeights.value.get(id);
  if (current === height) {
    return;
  }
  const nextMap = new Map(itemHeights.value);
  nextMap.set(id, height);
  itemHeights.value = nextMap;
}

const heightMeta = computed(() => {
  const offsets: number[] = [];
  let total = 0;
  const heights = itemHeights.value;
  for (const item of flatItems.value) {
    offsets.push(total);
    const measured = heights.get(item.id) ?? defaultRowHeight;
    total += measured;
  }
  return { offsets, totalHeight: total };
});

function findIndexByOffset(target: number, offsets: number[]): number {
  if (offsets.length === 0) {
    return 0;
  }
  let low = 0;
  let high = offsets.length - 1;
  let ans = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] <= target) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return ans;
}

const startIndex = computed(() => {
  const offsets = heightMeta.value.offsets;
  if (offsets.length === 0) {
    return 0;
  }
  const target = Math.max(0, scrollTop.value - overscanPx);
  let idx = findIndexByOffset(target, offsets);
  idx = Math.max(0, idx - overscanCount);
  return idx;
});

const endIndex = computed(() => {
  const offsets = heightMeta.value.offsets;
  const totalItems = flatItems.value.length;
  if (totalItems === 0) {
    return 0;
  }
  const maxOffset = scrollTop.value + viewportHeight.value + overscanPx;
  let idx = findIndexByOffset(maxOffset, offsets);
  while (idx < totalItems && offsets[idx] < maxOffset) {
    idx++;
  }
  idx = Math.min(totalItems, idx + overscanCount);
  return Math.max(startIndex.value + 1, idx);
});

const visibleRows = computed(() => {
  if (flatItems.value.length === 0) {
    return [] as FlatMenuItem[];
  }
  return flatItems.value.slice(startIndex.value, endIndex.value);
});

const translateY = computed(() => {
  const offsets = heightMeta.value.offsets;
  if (offsets.length === 0) {
    return 0;
  }
  const start = Math.min(startIndex.value, offsets.length - 1);
  return offsets[start] ?? 0;
});

const totalHeight = computed(() => heightMeta.value.totalHeight);

watch(flatItems, (newItems) => {
  const validIds = new Set(newItems.map((item) => item.id));
  const nextMap = new Map<string, number>();
  itemHeights.value.forEach((height, id) => {
    if (validIds.has(id)) {
      nextMap.set(id, height);
    }
  });
  itemHeights.value = nextMap;
});

const isProgrammaticScroll = ref(false);

function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  scrollTop.value = target.scrollTop;
  if (isProgrammaticScroll.value) {
    isProgrammaticScroll.value = false;
    return;
  }
  const current = flatItems.value[startIndex.value];
  if (current && store.selectedMenu !== current.id) {
    store.selectedMenu = current.id;
  }
}

function handleMenuSelect(value: string) {
  if (!value) {
    return;
  }

  const targetIndex = flatIndexMap.value.get(value);
  if (targetIndex === undefined) {
    return;
  }

  const offsets = heightMeta.value.offsets;
  const targetOffset = offsets[targetIndex] ?? 0;

  if (scrollContainer.value) {
    isProgrammaticScroll.value = true;
    scrollContainer.value.scrollTo({
      top: targetOffset,
      behavior: "smooth"
    });
  }

  store.selectedMenu = value;
  expandMenuPath(store.items, value);
}

function expandMenuPath(items: Menu[], targetId: string, path: Menu[] = []): boolean {
  for (const item of items) {
    if (item.id === targetId) {
      path.forEach((menu) => {
        if (menu.type === "menu" || menu.isMenuconfig) {
          menu.isCollapsed = false;
        }
      });
      return true;
    }
    if (item.children && item.children.length > 0) {
      const newPath = [...path, item];
      if (expandMenuPath(item.children, targetId, newPath)) {
        return true;
      }
    }
  }
  return false;
}

function updateViewportHeight() {
  if (!scrollContainer.value) {
    return;
  }
  viewportHeight.value = scrollContainer.value.clientHeight;
}

function handleMouseDown(e: MouseEvent) {
  isDragging.value = true;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) {
    return;
  }

  const mainElement = document.getElementById("main");
  if (!mainElement) {
    return;
  }

  const mainRect = mainElement.getBoundingClientRect();
  const newWidth = e.clientX - mainRect.left;

  if (newWidth >= minTreeWidth && newWidth <= maxTreeWidth) {
    treeWidth.value = newWidth;
  }
}

function handleMouseUp() {
  if (!isDragging.value) {
    return;
  }
  isDragging.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

onMounted(() => {
  store.requestInitValues();

  nextTick(() => {
    updateViewportHeight();
    if (scrollContainer.value) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          viewportHeight.value = entry.contentRect.height;
        }
      });
      observer.observe(scrollContainer.value);
      resizeObserver.value = observer;
    }
  });

  window.addEventListener("resize", updateViewportHeight);
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
});

onUnmounted(() => {
  if (resizeObserver.value && scrollContainer.value) {
    resizeObserver.value.unobserve(scrollContainer.value);
  }
  window.removeEventListener("resize", updateViewportHeight);
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("mouseup", handleMouseUp);
});
</script>

<template>
  <div class="app-container">
    <SearchBar />
    <div id="main" class="grid-container">
      <div
        class="sidenav"
        :style="{ width: treeWidth + 'px', minWidth: treeWidth + 'px', maxWidth: treeWidth + 'px' }"
      >
        <SettingsTree :data="store.items" @select="handleMenuSelect" />
      </div>
      <div
        class="resize-handle"
        @mousedown="handleMouseDown"
        :class="{ dragging: isDragging }"
      ></div>
      <div
        id="scrollable"
        class="config-list"
        ref="scrollContainer"
        :style="{ minWidth: minContentWidth + 'px' }"
        @scroll="handleScroll"
      >
        <div class="virtual-spacer" :style="{ height: `${totalHeight}px` }">
          <div class="virtual-inner" :style="{ transform: `translateY(${translateY}px)` }">
            <VirtualConfigRow
              v-for="item in visibleRows"
              :key="item.id"
              :config="item.config"
              :depth="item.depth"
              :on-height-change="handleHeightChange"
            />
          </div>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :visible="store.showDiscardConfirm"
      :title="t('discard.confirmTitle')"
      :message="t('discard.confirmMessage')"
      :confirm-text="t('common.confirm')"
      :cancel-text="t('common.cancel')"
      @confirm="store.confirmDiscard"
      @cancel="store.cancelDiscard"
    />

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
@import "../../../commons/commons.scss";

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
    content: "";
    position: absolute;
    left: -4px;
    top: 0;
    width: 12px;
    height: 100%;
    cursor: col-resize;
  }
}

.config-list {
  position: relative;
  overflow: auto;
  color: var(--vscode-foreground);
  flex: 1;
  padding: 1rem 1.5rem;
}

.virtual-spacer {
  position: relative;
  width: 100%;
  min-height: 100%;
}

.virtual-inner {
  position: absolute;
  left: 0;
  right: 0;
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

p {
  color: var(--vscode-editor-foreground);
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

.help-section span,
.menu-help-section span {
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
