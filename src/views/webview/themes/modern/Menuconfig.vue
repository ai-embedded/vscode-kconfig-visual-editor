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
import { computed, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useMenuconfigStore } from "../../store";
import { Menu, menuType } from "../../../../menuconfig/Menu";
import TableRow from "./components/TableRow.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import { t } from "../../i18n";
import type { DisplayRow, RowType } from "./types";
import { IconChevronDown, IconChevronUp, IconEyeClosed } from "@iconify-prerendered/vue-codicon";

const store = useMenuconfigStore();
const { textDictionary, colorThemeKind } = storeToRefs(store);

onMounted(() => {
  store.requestInitValues();
});

const searchKeyword = computed({
  get: () => store.searchString,
  set: (value: string) => {
    store.searchString = value;
  }
});

const visibleTree = computed(() => filterItemsByVisibility(store.items));

const filteredTree = computed(() => {
  const tree = visibleTree.value;
  const search = searchKeyword.value;
  if (search !== "") {
    const searchStrMatch = /^(?:CONFIG_)?(.+)/.exec(search);
    const normalized =
      searchStrMatch && searchStrMatch.length > 1
        ? searchStrMatch[1].toLowerCase()
        : search.toLowerCase();
    return filterItems(tree, normalized);
  }
  return tree;
});

const choiceChildNames = computed(() => collectChoiceChildNames(visibleTree.value));

const displayRows = computed<DisplayRow[]>(() => {
  const acc: DisplayRow[] = [];
  buildRows(filteredTree.value, 0, [], false, acc, choiceChildNames.value);
  return acc;
});

const mainTitle = computed(() => deriveTitle(store.items));

const themeClass = computed(() => (colorThemeKind.value === "light" ? "theme-light" : "theme-dark"));

function deriveTitle(items: Menu[]): string {
  for (const item of items) {
    if (isMainMenu(item)) {
      return item.title || item.name || "Kconfig Configuration";
    }
    if (item.children && item.children.length > 0) {
      const nested = deriveTitle(item.children);
      if (nested) {
        return nested;
      }
    }
  }
  return items[0]?.title || "Kconfig Configuration";
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
      visibleItems.push(...filteredChildren);
      return;
    }

    const isMainMenu = item.isMainMenu === true;
    const isVisible = item.isVisible !== false;
    const isContainer = item.isContainerVisible === true;

    if (item.children && item.children.length > 0) {
      if (!isVisible && !isContainer && !isMainMenu) {
        return;
      }

      if (filteredChildren.length === 0 && !isVisible && !isMainMenu) {
        return;
      }

      cloned.children = filteredChildren;
      visibleItems.push(cloned);
      return;
    }

    if (isVisible) {
      cloned.children = [];
      visibleItems.push(cloned);
    }
  });

  return visibleItems;
}

function buildRows(
  items: Menu[],
  level: number,
  ancestors: string[],
  ancestorCollapsed: boolean,
  acc: DisplayRow[],
  choiceChildren: Set<string>
) {
  items.forEach((item, index) => {
    const isRootMainMenu = level === 0 && isMainMenu(item);
    if (isRootMainMenu) {
      if (item.children && item.children.length > 0) {
        buildRows(item.children, level, ancestors, ancestorCollapsed, acc, choiceChildren);
      }
      return;
    }

    if (item.name && choiceChildren.has(item.name) && item.type !== menuType.choice) {
      return;
    }

    const id = item.id || `${item.name || "config"}-${level}-${index}`;
    const type = getRowType(item);
    const collapsed = type === "menu" ? computeCollapsed(item) : false;
    const hidden = ancestorCollapsed;

    const row: DisplayRow = {
      id,
      item,
      level,
      type,
      ancestors: [...ancestors],
      collapsed,
      hidden,
      hasChildren: false,
    };
    acc.push(row);

    const beforeChildrenLength = acc.length;
    const childAncestors = type === "menu" ? [...ancestors, id] : ancestors;
    const nextAncestorCollapsed = ancestorCollapsed || (type === "menu" ? collapsed : false);

    if (item.children && item.children.length > 0) {
      if (type === "menu") {
        buildRows(
          item.children,
          level + 1,
          childAncestors,
          nextAncestorCollapsed,
          acc,
          choiceChildren
        );
      } else if (type !== "choice") {
        buildRows(
          item.children,
          level + 1,
          ancestors,
          ancestorCollapsed,
          acc,
          choiceChildren
        );
      }
    }

    if (type === "menu") {
      const hasLazyChildren = item.isVirtual === true && item.childrenParsed !== true;
      row.hasChildren = hasLazyChildren || acc.length > beforeChildrenLength;
    }
  });
}

function collectChoiceChildNames(items: Menu[], set: Set<string> = new Set()): Set<string> {
  items.forEach(item => {
    if (item.type === menuType.choice && item.children) {
      item.children.forEach(child => {
        if (child.name) {
          set.add(child.name);
        }
      });
    }
    if (item.children && item.children.length > 0) {
      collectChoiceChildNames(item.children, set);
    }
  });
  return set;
}

function getRowType(item: Menu): RowType {
  if (item.type === menuType.choice) {
    return "choice";
  }

  if (item.type === menuType.menu || item.isMenuconfig) {
    return "menu";
  }

  switch (item.type) {
    case menuType.bool:
      return "bool";
    case menuType.tristate:
      return "tristate";
    case menuType.string:
      return "string";
    case menuType.int:
      return "int";
    case menuType.hex:
      return "hex";
    default:
      return item.type === "comment" ? "comment" : "other";
  }
}

function computeCollapsed(item: Menu): boolean {
  if (isMainMenu(item)) {
    return false;
  }
  if (item.isMenuconfig && item.value === true) {
    return false;
  }
  if (typeof item.isCollapsed === "boolean") {
    return item.isCollapsed;
  }
  return item.type === menuType.menu || item.isMenuconfig ? true : false;
}

function isMainMenu(item: Menu): boolean {
  if (item.isMainMenu === true) {
    return true;
  }
  const id = item.id || "";
  if (typeof id === "string" && id.startsWith("mainmenu-")) {
    return true;
  }
  return item.name === "__MAINMENU__";
}

function handleCollapseUpdate(id: string, value: boolean) {
  store.setMenuCollapseById(id, value);
}
</script>

<template>
  <div class="modern-app" :class="themeClass">
    <header class="modern-header">
      <div class="header-left">
        <h1 class="header-title">{{ mainTitle }}</h1>
      </div>
      <div class="header-center">
        <div class="search-group">
          <input
            v-model="searchKeyword"
            type="text"
            class="search-input"
            placeholder="Search configuration..."
          />
          <div class="toolbar-divider" />
          <div class="toolbar-group">
            <button
              class="toolbar-button"
              type="button"
              @click="store.expandAllMenus"
              :title="t('toolbar.expandAll')"
            >
              <IconChevronDown />
            </button>
            <button
              class="toolbar-button"
              type="button"
              @click="store.collapseAllMenus"
              :title="t('toolbar.collapseAll')"
            >
              <IconChevronUp />
            </button>
            <button
              class="toolbar-button"
              type="button"
              @click="store.closeAllHelp"
              :title="t('toolbar.closeAllHelp')"
            >
              <IconEyeClosed />
            </button>
          </div>
        </div>
      </div>
      <div class="header-right">
        <button class="header-btn primary" type="button" @click="store.saveGuiConfig">
          <span class="btn-icon">💾</span>
          <span>{{ textDictionary.save }}</span>
        </button>
        <button class="header-btn" type="button" @click="store.resetGuiConfig">
          <span class="btn-icon">🗑️</span>
          <span>{{ textDictionary.discard }}</span>
        </button>
        <button class="header-btn" type="button" @click="store.setDefaultConfig">
          <span class="btn-icon">⟲</span>
          <span>{{ textDictionary.reset }}</span>
        </button>
      </div>
    </header>

    <div class="table-wrapper">
      <div class="table-header">
        <div class="table-header-cell property-col">Property</div>
        <div class="table-header-cell value-col">Value</div>
      </div>
      <div class="table-body">
        <TableRow
          v-for="row in displayRows"
          :key="row.id"
          :row="row"
          :collapsed="row.collapsed"
          :hidden="row.hidden"
          @update-collapse="handleCollapseUpdate"
        />
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

<style scoped lang="scss">
@import "../../../commons/commons.scss";


.modern-app {
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  width: 100%;
  height: 100vh;
  min-height: 0;
  font-family: var(--font-family);
  font-size: var(--font-size);
  font-weight: var(--font-weight);
  transition: background-color 0.2s ease, color 0.2s ease;
}

.modern-app.theme-dark {
  --bg-primary: #1e1e1e;
  --bg-secondary: #252526;
  --bg-tertiary: #2d2d30;
  --bg-hover: #3c3c3c;
  --bg-selected: #37373d;
  --border-color: #3c3c3c;
  --text-primary: #e2e2e2;
  --text-secondary: #bcbcbc;
  --text-muted: #7a7a7a;
  --accent-blue: #007acc;
  --button-bg: #0e639c;
  --button-hover: #1177bb;
  --input-bg: #3c3c3c;
  --input-border: #5a5a5a;
  --input-focus: #3794ff;
  --font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  --font-size: 13px;
  --font-weight: 400;
}

.modern-app.theme-light {
  --bg-primary: #f3f3f3;
  --bg-secondary: #ffffff;
  --bg-tertiary: #f8f8f8;
  --bg-hover: #dbeafe;
  --bg-selected: #cfe8ff;
  --border-color: #c8c8c8;
  --text-primary: #1f1f1f;
  --text-secondary: #3a3a3a;
  --text-muted: #6a6a6a;
  --accent-blue: #0067c0;
  --button-bg: #0067c0;
  --button-hover: #0059a5;
  --input-bg: #ffffff;
  --input-border: #b5b5b5;
  --input-focus: #0067c0;
  --font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  --font-size: 13px;
  --font-weight: 400;
}

.modern-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  gap: 16px;
}

.header-left {
  flex: 0 0 auto;
}

.header-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.search-group {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 420px;
}

.search-input {
  flex: 1;
  padding: 6px 12px;
  background-color: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 4px;
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s ease-in-out;
}

.search-input:focus {
  border-color: var(--input-focus);
}

.search-input::placeholder {
  color: var(--text-secondary);
}

.toolbar-divider {
  width: 1px;
  height: 26px;
  background-color: var(--border-color);
  flex-shrink: 0;
}

.toolbar-group {
  display: flex;
  gap: 6px;
  align-items: center;
}

.toolbar-button {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.toolbar-button:hover,
.toolbar-button:focus-visible {
  background-color: var(--bg-hover);
  border-color: var(--border-color);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.header-btn:hover {
  background-color: var(--bg-hover);
}

.header-btn.primary {
  background-color: var(--button-bg);
  border-color: var(--button-bg);
  color: #ffffff;
}

.header-btn.primary:hover {
  background-color: var(--button-hover);
}

.btn-icon {
  font-size: 12px;
  line-height: 12px;
}

.table-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
  min-height: 0;
}

.table-header {
  display: flex;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 5;
}

.table-header-cell {
  padding: 8px 12px;
  font-weight: 600;
  color: var(--text-primary);
  border-right: 1px solid var(--border-color);
}

.table-header-cell.property-col {
  flex: 1;
}

.table-header-cell.value-col {
  flex: 2;
  min-width: 180px;
}

.table-body {
  flex: 1;
  overflow-y: auto;
  background-color: var(--bg-primary);
  min-height: 0;
}
</style>
