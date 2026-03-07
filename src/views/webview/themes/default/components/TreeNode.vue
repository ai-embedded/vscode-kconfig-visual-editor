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
  item: TreeItem;
  level: number;
  openStates: Record<string, boolean>;
}>();

const emit = defineEmits<{
  (e: 'toggle', item: TreeItem): void;
  (e: 'select', value: string): void;
}>();

const store = useMenuconfigStore();
const selectedMenu = computed(() => store.selectedMenu);

const hasChildren = computed(() => {
  if (props.item.hasChildren) {
    return true;
  }
  return props.item.subItems && props.item.subItems.length > 0;
});

function toggleItem(event: Event) {
  event.stopPropagation();
  // Prevent mainmenu from being collapsed
  if (props.item.isMainMenu) return;
  if (hasChildren.value) {
    emit('toggle', props.item);
  }
}

function selectItem() {
  emit('select', props.item.value);
}

// Calculate padding based on level
const paddingLeft = computed(() => `${props.level * 20 + 8}px`);
</script>

<template>
  <li class="tree-node">
    <div 
      class="tree-node-content" 
      :class="{ 
        'has-children': hasChildren,
        'selected': selectedMenu === item.value 
      }"
      :style="{ paddingLeft }"
      @click="selectItem"
    >
      <!-- 展开/折叠箭头 (mainmenu 不显示) -->
      <div
        v-if="hasChildren && !item.isMainMenu"
        class="tree-node-toggle"
        @click="toggleItem"
        :class="{ 'expanded': item.open, 'collapsed': !item.open }"
      >
        <svg
          class="chevron-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          :class="{ 'rotated': item.open }"
        >
          <path
            d="m12.14 8.753-5.482 4.796c-.646.566-1.658.106-1.658-.753V3.204a1 1 0 0 1 1.659-.753l5.48 4.796a1 1 0 0 1 0 1.506z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div v-else-if="!hasChildren || item.isMainMenu" class="tree-node-toggle-placeholder"></div>
      
      <!-- 菜单标签 -->
      <div class="tree-node-label">
        {{ item.label }}
      </div>
    </div>
    
    <!-- 递归渲染子节点 -->
    <ul v-if="hasChildren && item.open" class="tree-node-children">
      <TreeNode
        v-for="child in item.subItems"
        :key="child.id"
        :item="child"
        :level="level + 1"
        :open-states="openStates"
        @toggle="$emit('toggle', $event)"
        @select="$emit('select', $event)"
      />
    </ul>
  </li>
</template>

<style scoped>
.tree-node {
  list-style: none;
  margin: 0;
  padding: 0;
}

.tree-node-content {
  display: flex;
  align-items: center;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 3px;
  transition: background-color 0.15s ease;
  min-height: 22px;
}

.tree-node-content:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.tree-node-content.selected {
  background-color: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
  font-weight: 600;
}

.tree-node-toggle,
.tree-node-toggle-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  flex-shrink: 0;
}

.tree-node-toggle {
  color: var(--vscode-icon-foreground);
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.15s ease;
  position: relative;
}

.tree-node-toggle:hover {
  background-color: var(--vscode-toolbar-hoverBackground);
}

.tree-node-toggle:active {
  background-color: var(--vscode-toolbar-activeBackground);
}

/* 箭头图标样式 */
.chevron-icon {
  transition: transform 0.2s ease;
  color: var(--vscode-icon-foreground);
  opacity: 0.8;
}

.chevron-icon:hover {
  opacity: 1;
}

/* 展开状态的箭头 - 向下旋转90度 */
.chevron-icon.rotated {
  transform: rotate(90deg);
}

.tree-node-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
  font-size: 13px;
  line-height: 1.4;
  color: var(--vscode-foreground);
}

.tree-node-content.selected .tree-node-label {
  color: var(--vscode-list-activeSelectionForeground);
}

.tree-node-children {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* 为不同层级添加细微的视觉层次 */
.tree-node-content.has-children {
  font-weight: 500;
}

/* 焦点状态 */
.tree-node-content:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

/* 禁用状态的处理 */
.tree-node-toggle-placeholder {
  opacity: 0;
}
</style>
