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
import { computed, ref, watch } from 'vue';
import TreeNode from './TreeNode.vue';
import { useMenuconfigStore } from "../../../store";
import { Menu } from "../../../../../menuconfig/Menu";

interface TreeItem {
  id: string;
  label: string;
  value: string;
  open: boolean;
  hasChildren: boolean;
  subItems: TreeItem[];
  isVisible?: boolean;
  isMainMenu?: boolean;
}

const props = defineProps<{
  data: Menu[];
}>();

const emit = defineEmits<{
  (e: 'select', value: string): void;
}>();

const store = useMenuconfigStore();
const openStates = ref<Record<string, boolean>>({});

const isMainMenuItem = (item: Menu): boolean => {
  return item.isMainMenu === true || item.name === "__MAINMENU__" || item.id.startsWith("mainmenu-");
};

const getDefaultOpenState = (item: Menu): boolean => {
  if (isMainMenuItem(item)) {
    return true;
  }
  return false;
};

const collectAndSyncOpenStates = (items: Menu[]) => {
  const nextStates: Record<string, boolean> = {};

  const traverse = (menus: Menu[]) => {
    if (!menus) {
      return;
    }
    menus.forEach((menu) => {
      if (!menu) {
        return;
      }
      if (menu.type === "menu" && menu.isVisible !== false) {
        const previous = openStates.value[menu.id];
        nextStates[menu.id] = typeof previous === "boolean" ? previous : getDefaultOpenState(menu);
      }
      if (menu.children && menu.children.length > 0) {
        traverse(menu.children);
      }
    });
  };

  traverse(items);
  openStates.value = nextStates;
};

const findMenuPath = (
  menus: Menu[],
  targetId: string,
  ancestorMenuIds: string[] = []
): string[] | null => {
  for (const menu of menus) {
    const isMenuNode = menu.type === "menu" && menu.isVisible !== false;
    const nextAncestors = isMenuNode ? [...ancestorMenuIds, menu.id] : ancestorMenuIds;

    if (menu.id === targetId) {
      return nextAncestors;
    }

    if (menu.children && menu.children.length > 0) {
      const path = findMenuPath(menu.children, targetId, nextAncestors);
      if (path) {
        return path;
      }
    }
  }
  return null;
};

const expandPathForSelection = (targetId: string) => {
  if (!targetId) {
    return;
  }
  const path = findMenuPath(props.data, targetId);
  if (!path || path.length === 0) {
    return;
  }
  const nextStates = { ...openStates.value };
  path.forEach((id) => {
    nextStates[id] = true;
  });
  openStates.value = nextStates;
};

const getVisibleChildMenus = (menu: Menu): Menu[] => {
  if (!menu.children || menu.children.length === 0) {
    return [];
  }
  return menu.children.filter((child) => child.type === "menu" && child.isVisible !== false);
};

const processMenuItems = (items: Menu[]): TreeItem[] => {
  return items
    .filter(item => item.type === "menu" && item.isVisible !== false)
    .map(item => {
      const isMainMenu = isMainMenuItem(item);
      const childMenus = getVisibleChildMenus(item);
      const open = isMainMenu ? true : (openStates.value[item.id] ?? false);
      return {
        id: item.id,
        label: item.title,
        value: item.id,
        open,
        hasChildren: childMenus.length > 0,
        isVisible: item.isVisible,
        isMainMenu: isMainMenu,
        subItems: open ? processMenuItems(childMenus) : []
      };
    });
};

function toggleItem(item: TreeItem) {
  if (!item) return;
  // Prevent mainmenu from being collapsed
  if (item.isMainMenu) return;
  openStates.value[item.id] = !openStates.value[item.id];
}

function selectItem(value: string) {
  store.selectedMenu = value;
  emit('select', value);
}

const treeData = computed(() => {
  if (!props.data) return [];
  return processMenuItems(props.data);
});

const selectedMenu = computed(() => store.selectedMenu);

watch(
  () => props.data,
  (newItems) => {
    collectAndSyncOpenStates(newItems || []);
    expandPathForSelection(store.selectedMenu);
  },
  { immediate: true }
);

watch(
  selectedMenu,
  (newSelectedId) => {
    expandPathForSelection(newSelectedId);
  }
);
</script>

<template>
  <div class="settings-tree">
    <ul class="tree-root">
      <TreeNode
        v-for="item in treeData"
        :key="item.id"
        :item="item"
        :level="0"
        :open-states="openStates"
        @toggle="toggleItem"
        @select="selectItem"
      />
    </ul>
  </div>
</template>

<style scoped>
.settings-tree {
  font-family: var(--vscode-font-family);
  font-size: 13px;
  color: var(--vscode-foreground);
  user-select: none;
  width: 100%;
  height: 100%;
  overflow: auto;
}

.tree-root {
  list-style: none;
  padding: 0;
  margin: 0;
}
</style>
