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
import { storeToRefs } from "pinia";
import { useMenuconfigStore } from "../../../store";
import { onMounted } from "vue";
import { IconChevronDown, IconChevronUp, IconEyeClosed } from "@iconify-prerendered/vue-codicon";
import { t } from "../../../i18n";

const store = useMenuconfigStore();

const { searchString, textDictionary } = storeToRefs(store);

onMounted(() => {
  const inputElement = document.querySelector(
    ".search-input"
  ) as HTMLInputElement;
  if (inputElement) {
    inputElement.focus();
  }
});
</script>

<template>
  <div class="search-container">
    <div class="search-wrapper">
      <input
        v-model="searchString"
        type="search"
        name="search"
        placeholder="Search parameter"
        autocomplete="off"
        class="search-input"
      />
    </div>

    <!-- 工具栏按钮组 -->
    <div class="toolbar-divider"></div>
    <div class="toolbar-group">
      <button
        class="icon-button"
        @click="store.expandAllMenus"
        :title="t('toolbar.expandAll')"
      >
        <IconChevronDown />
      </button>
      <button
        class="icon-button"
        @click="store.collapseAllMenus"
        :title="t('toolbar.collapseAll')"
      >
        <IconChevronUp />
      </button>
      <button
        class="icon-button"
        @click="store.closeAllHelp"
        :title="t('toolbar.closeAllHelp')"
      >
        <IconEyeClosed />
      </button>
    </div>

    <div class="spacer"></div>
    <div class="button-group">
      <button
        class="vscode-button"
        @click="store.saveGuiConfig"
        id="searchbar-save"
      >
        {{ textDictionary.save }}
      </button>
      <button class="vscode-button" @click="store.resetGuiConfig">
        {{ textDictionary.discard }}
      </button>
      <button class="vscode-button" @click="store.setDefaultConfig">
        {{ textDictionary.reset }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-container {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  margin-bottom: 8px;
  width: 100%;
  justify-content: flex-start;
  box-sizing: border-box;
  overflow-x: auto;
}

.search-wrapper {
  flex: 0 0 auto;
  max-width: 400px;
  min-width: 300px;
}

.search-input {
  width: 100%;
  height: 26px;
  padding: 0 12px;
  font-size: 14px;
  line-height: 26px;
  color: var(--vscode-input-foreground);
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
  border-radius: 2px;
  outline: none;
  transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
  box-shadow: none;
}

.search-input:hover:not(:focus) {
  border-color: var(--vscode-input-border, rgba(128, 128, 128, 0.5));
}

.search-input:focus {
  border-color: var(--vscode-focusBorder, #007acc);
  outline: none;
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
}

/* 浅色主题优化 */
:global(.vscode-light) .search-input {
  border-color: rgba(0, 0, 0, 0.25);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

:global(.vscode-light) .search-input:hover:not(:focus) {
  border-color: rgba(0, 0, 0, 0.35);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

:global(.vscode-light) .search-input:focus {
  border-color: var(--vscode-focusBorder, #007acc);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc), 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* 深色主题优化 */
:global(.vscode-dark) .search-input {
  border-color: rgba(255, 255, 255, 0.18);
}

:global(.vscode-dark) .search-input:hover:not(:focus) {
  border-color: rgba(255, 255, 255, 0.28);
}

:global(.vscode-dark) .search-input:focus {
  border-color: var(--vscode-focusBorder, #007acc);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
}

.search-input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background-color: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
  margin: 0 8px;
  flex-shrink: 0;
}

.toolbar-group {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
  align-items: center;
}

.icon-button {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  color: var(--vscode-icon-foreground);
  transition: background-color 0.1s ease;
}

.icon-button:hover {
  background-color: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
}

.icon-button:active {
  background-color: var(--vscode-toolbar-activeBackground, rgba(90, 93, 94, 0.51));
}

.icon-button:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

.spacer {
  flex: 1;
}

.button-group {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
  margin-right: 8px;
  flex-wrap: nowrap;
  min-width: fit-content;
}

.vscode-button {
  height: 24px;
  padding: 0 12px;
  font-size: 13px;
  line-height: 24px;
  color: var(--vscode-button-foreground);
  background-color: var(--vscode-button-background);
  white-space: nowrap;
  min-width: fit-content;
  flex-shrink: 0;
  border: 1px solid var(--vscode-button-border);
  border-radius: 2px;
  cursor: pointer;
  outline: none;
}

.vscode-button:hover {
  background-color: var(--vscode-button-hoverBackground);
}

.vscode-button:active {
  background-color: var(--vscode-button-activeBackground);
}

.vscode-button:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
</style>