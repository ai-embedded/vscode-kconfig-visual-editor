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
import { computed } from 'vue';
import { useMenuconfigStore } from "../../../store";

// Simple icon components since we don't have the iconify package
const IconChevronRight = { template: '<span>▶</span>' };
const IconChevronDown = { template: '<span>▼</span>' };

interface TreeItem {
  id: string;
  label: string;
  value: string;
  readonly open: boolean;
  subItems: TreeItem[];
  isVisible?: boolean;
}

const props = defineProps<{
  item: TreeItem;
  openStates: Record<string, boolean>;
}>();

const emit = defineEmits<{
  (e: 'toggle', item: TreeItem): void;
  (e: 'select', item: TreeItem): void;
}>();

const store = useMenuconfigStore();

const selectedMenu = computed(() => store.selectedMenu);

function toggleItem(item: TreeItem) {
  emit('toggle', item);
}

function selectItem(item: TreeItem) {
  emit('select', item);
}
</script>

<template>
  <li class="tree-item">
    <div class="tree-item-content" :class="{ 'has-children': item.subItems && item.subItems.length > 0 }">
      <div v-if="item.subItems && item.subItems.length > 0" class="tree-item-toggle" @click="toggleItem(item)">
        <IconChevronRight v-if="!item.open" />
        <IconChevronDown v-else />
      </div>
      <div v-else class="tree-item-toggle-placeholder"></div>
      <div 
        class="tree-item-label" 
        :class="{ 'selected': selectedMenu === item.value }"
        :data-value="item.value"
        @click="selectItem(item)"
      >
        {{ item.label }}
      </div>
    </div>
    
    <!-- 递归渲染子项 -->
    <ul v-if="item.subItems && item.subItems.length > 0 && item.open" class="tree-list">
      <TreeItem
        v-for="subItem in item.subItems"
        :key="subItem.id"
        :item="subItem"
        :open-states="openStates"
        @toggle="toggleItem"
        @select="selectItem"
      />
    </ul>
  </li>
</template>

<style scoped>
.tree-item {
  margin: 0;
  padding: 0;
}

.tree-item-content {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 2px;
}

.tree-item-content:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.tree-item-toggle,
.tree-item-toggle-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 4px;
  flex-shrink: 0;
}

.tree-item-toggle {
  color: var(--vscode-foreground);
  cursor: pointer;
}

.tree-item-toggle:hover {
  color: var(--vscode-foreground);
}

.tree-item-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
}

.tree-item-label.selected {
  font-weight: 900;
}

.tree-list {
  list-style: none;
  padding: 0;
  margin: 0;
  padding-left: 32px; /* 每一层缩进32px */
}
</style>