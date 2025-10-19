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
import { computed, ref, onMounted, watch } from 'vue';
import TreeNode from './TreeNode.vue';
import { useMenuconfigStore } from "../store";
import { Menu } from "../../../menuconfig/Menu";

interface TreeItem {
  id: string;
  label: string;
  value: string;
  open: boolean;
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

// Initialize open states - all menus default to expanded
const initializeOpenStates = (items: Menu[]) => {
  if (!items) return;
  items.forEach(item => {
    if (item && item.type === "menu" && item.isVisible !== false) {
      // All menus default to expanded
      openStates.value[item.id] = true;
      if (item.children && item.children.length > 0) {
        initializeOpenStates(item.children);
      }
    }
  });
};

// Process menu items - make sure to initialize first
const processMenuItems = (items: Menu[]): TreeItem[] => {
  // Ensure openStates are initialized before processing
  if (Object.keys(openStates.value).length === 0 && items.length > 0) {
    initializeOpenStates(items);
  }
  
  return items
    .filter(item => item.type === "menu" && item.isVisible !== false)
    .map(item => {
      const isMainMenu = Boolean(item.name === "__MAINMENU__" || item.id.startsWith("mainmenu-"));
      return {
        id: item.id,
        label: item.title,
        value: item.id,
        open: openStates.value[item.id] ?? true, // all menus default to expanded
        isVisible: item.isVisible,
        isMainMenu: isMainMenu,
        subItems: item.children ? processMenuItems(item.children) : []
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