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
import { ref, watch, computed } from 'vue';
import { Menu } from "../../../menuconfig/Menu";
import { IconQuestion, IconLock } from "@iconify-prerendered/vue-codicon";
import { useMenuconfigStore } from "../store";
import { storeToRefs } from "pinia";

interface Props {
  config: Menu;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  change: [value: string];
}>();

const store = useMenuconfigStore();
const { closeAllHelpTimestamp } = storeToRefs(store);

const localValue = ref(props.config.value || '');
const isHelpVisible = ref(false);

// 计算只读状态
const isReadonly = computed(() => {
  return props.config.isReadonly || false;
});

const readonlyReason = computed(() => {
  return props.config.readonlyReason;
});

const options = computed(() => {
  return props.config.children || [];
});

function handleChange() {
  // 如果是只读状态，不处理变更
  if (isReadonly.value) {
    return;
  }
  emit('change', localValue.value);
}

function toggleHelp() {
  isHelpVisible.value = !isHelpVisible.value;
}

watch(() => props.config.value, (newValue) => {
  localValue.value = newValue || '';
});

// 监听全局关闭所有帮助信息
watch(closeAllHelpTimestamp, () => {
  if (isHelpVisible.value) {
    isHelpVisible.value = false;
  }
});
</script>

<template>
  <div class="select-dropdown-container" :class="{ readonly: isReadonly }">
    <div class="input-group">
      <!-- 占位符，确保与 checkbox 宽度对齐 -->
      <div class="icon-placeholder"></div>
      <label :for="props.config.id" class="input-label">
        {{ props.config.title }}
        <div v-if="isReadonly" class="readonly-icon" :title="readonlyReason">
          <IconLock />
        </div>
        <div class="info-icon" @click="toggleHelp">
          <IconQuestion />
        </div>
      </label>
      <select
        :id="props.config.id"
        v-model="localValue"
        @change="handleChange"
        class="select-dropdown"
        :class="{ readonly: isReadonly }"
        :disabled="isReadonly"
        :title="isReadonly ? readonlyReason : undefined"
      >
        <option v-for="option in options" :key="option.id" :value="option.name">
          {{ option.title }}
        </option>
      </select>
    </div>
    
    <!-- 只读状态提示 -->
    <div v-if="isReadonly && readonlyReason" class="readonly-notice">
      <IconLock class="readonly-notice-icon" />
      <span>{{ readonlyReason }}</span>
    </div>
    
    <!-- Enhanced help information matching Kconfiglib format -->
    <div v-show="isHelpVisible" class="help-section">
      <p class="help-kconfig-title">
        <strong>Name:</strong> {{ props.config.name }}
      </p>

      <p v-if="props.config.prompt" class="help-kconfig-title">
        <strong>Prompt:</strong> {{ props.config.prompt }}
      </p>

      <p class="help-kconfig-title">
        <strong>Type:</strong> {{ props.config.type }}
      </p>

      <p class="help-kconfig-title">
        <strong>Value:</strong> {{ props.config.value ?? 'n' }}
      </p>

      <div v-if="props.config.help" class="help-kconfig-title">
        <strong>Help:</strong>
        <div class="content help-content" v-html="props.config.help" />
      </div>

      <p v-if="props.config.directDepExpr" class="help-kconfig-title">
        <strong>Direct dependencies:</strong><br>
        {{ props.config.directDepExpr }}
      </p>

      <div class="help-kconfig-title">
        <p v-if="props.config.sourceFile && props.config.linenr">
          <strong>At:</strong> {{ props.config.sourceFile }}:{{ props.config.linenr }}
        </p>
        <p v-else-if="props.config.sourceFile">
          <strong>Source:</strong> {{ props.config.sourceFile }}
        </p>

        <p v-if="props.config.menuPath">
          <strong>Menu path:</strong> {{ props.config.menuPath }}
        </p>

        <div v-if="props.config.sourceFiles && props.config.sourceFiles.length > 0">
          <strong>Includes:</strong>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li v-for="(file, index) in props.config.sourceFiles" :key="index">{{ file }}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.select-dropdown-container {
  /* Use form-group spacing from reference project - 缩进由父组件configElement控制 */
  padding-left: 0px;
  margin-top: 9px;
  margin-bottom: 9px;
  overflow: hidden;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap;
}

/* 占位符，用于与复选框对齐 */
.icon-placeholder {
  width: 27px;
  flex-shrink: 0;
}

.input-label {
  font-size: 14px;
  color: var(--vscode-foreground);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-dropdown {
  --kconfig-select-arrow: url("data:image/svg+xml;charset=utf-8,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%23C8C8C8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  --kconfig-select-bg: var(--vscode-dropdown-background, var(--vscode-input-background));
  --kconfig-select-border: var(--vscode-dropdown-border, var(--vscode-input-border));
  --kconfig-select-foreground: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
  --kconfig-select-shadow: none;

  flex: 0 0 auto;
  width: auto;
  min-width: 150px;
  max-width: 500px;
  height: 26px;
  padding: 2px 32px 2px 8px;
  font-size: 13px;
  color: var(--kconfig-select-foreground);
  background-color: var(--kconfig-select-bg);
  border: 1px solid var(--kconfig-select-border);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
  transition: border-color 0.12s ease-in-out, box-shadow 0.12s ease-in-out;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: var(--kconfig-select-arrow);
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 16px;
  box-shadow: var(--kconfig-select-shadow);
}

.select-dropdown:hover {
  border-color: var(--kconfig-select-border);
}

.select-dropdown:focus {
  border-color: var(--vscode-focusBorder, var(--kconfig-select-border));
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, var(--kconfig-select-border));
}

/* 浅色主题优化 */
:global(.vscode-light) .select-dropdown {
  border-color: rgba(0, 0, 0, 0.25);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

:global(.vscode-light) .select-dropdown:hover:not(:disabled):not(:focus) {
  border-color: rgba(0, 0, 0, 0.35);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

:global(.vscode-light) .select-dropdown:focus {
  border-color: var(--vscode-focusBorder, #007acc);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc), 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* 深色主题优化 */
:global(.vscode-dark) .select-dropdown {
  border-color: rgba(255, 255, 255, 0.18);
}

:global(.vscode-dark) .select-dropdown:hover:not(:disabled):not(:focus) {
  border-color: rgba(255, 255, 255, 0.28);
}

:global(.vscode-dark) .select-dropdown:focus {
  border-color: var(--vscode-focusBorder, #007acc);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
}

.info-icon {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 4px;
}

.info-icon:hover {
  color: var(--vscode-textLink-activeForeground);
}

.content {
  padding: 0 18px;
  overflow: hidden;
  transition: max-height 0.2s ease-out;
  margin: 10px;
}

.help-kconfig-title {
  padding: 0 18px;
  margin-left: 10px;
  margin-bottom: 6px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.5;
}

.help-section {
  margin-top: 8px;
  margin-left: 39px;
  padding: 12px 16px;
  background-color: var(--vscode-editorWidget-background, rgba(37, 37, 38, 0.6));
  border-left: 4px solid var(--vscode-textLink-foreground, #4db6ac);
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* 浅色主题的帮助信息背景 */
:global(.vscode-light) .help-section {
  background-color: rgba(245, 245, 245, 0.8);
  border-left-color: var(--vscode-textLink-foreground, #0066b8);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 深色主题的帮助信息背景 */
:global(.vscode-dark) .help-section {
  background-color: rgba(45, 45, 48, 0.6);
  border-left-color: var(--vscode-textLink-foreground, #4db6ac);
}

.help-content {
  margin-left: 0;
  padding-left: 16px;
  margin-top: 4px;
}

/* 只读状态样式 */
.select-dropdown-container.readonly {
  opacity: 0.7;
}

.readonly-icon {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  margin-left: 4px;
}

.select-dropdown.readonly {
  background-color: var(--kconfig-select-bg);
  border-color: var(--kconfig-select-border);
  color: var(--vscode-descriptionForeground);
  cursor: not-allowed;
}

.select-dropdown:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.readonly-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 4px 8px;
  background-color: var(--vscode-inputValidation-infoBackground);
  border: 1px solid var(--vscode-inputValidation-infoBorder);
  border-radius: 3px;
  font-size: 12px;
  color: var(--vscode-inputValidation-infoForeground);
}

.readonly-notice-icon {
  font-size: 12px;
  flex-shrink: 0;
}

:global(.vscode-light) .select-dropdown {
  --kconfig-select-arrow: url("data:image/svg+xml;charset=utf-8,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%234B4B4B' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  --kconfig-select-bg: var(--vscode-dropdown-background, #ffffff);
  --kconfig-select-border: rgba(50, 50, 50, 0.28);
  --kconfig-select-foreground: var(--vscode-dropdown-foreground, #202020);
  --kconfig-select-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

:global(.vscode-light) .select-dropdown:hover {
  --kconfig-select-border: rgba(50, 50, 50, 0.45);
  --kconfig-select-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}

:global(.vscode-light) .select-dropdown:focus {
  --kconfig-select-border: var(--vscode-focusBorder, #007acc);
  --kconfig-select-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
  background-color: var(--kconfig-select-bg);
}

:global(.vscode-dark) .select-dropdown {
  --kconfig-select-border: var(--vscode-dropdown-border, rgba(255, 255, 255, 0.18));
  --kconfig-select-shadow: none;
}
</style>
