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

const localValue = ref(props.config.value || '0x0');
const isHelpVisible = ref(false);

// 计算只读状态
const isReadonly = computed(() => {
  return props.config.isReadonly || false;
});

const readonlyReason = computed(() => {
  return props.config.readonlyReason;
});

function handleChange() {
  // 如果是只读状态，不处理变更
  if (isReadonly.value) {
    return;
  }
  
  let value = localValue.value;
  
  // Ensure the value starts with 0x
  if (!value.startsWith('0x') && !value.startsWith('0X')) {
    value = '0x' + value;
  }
  
  // Validate hex format
  const hexPattern = /^0x[0-9a-fA-F]+$/;
  if (hexPattern.test(value)) {
    localValue.value = value;
    emit('change', value);
  } else {
    // Reset to previous valid value
    localValue.value = props.config.value || '0x0';
  }
}

function toggleHelp() {
  isHelpVisible.value = !isHelpVisible.value;
}

watch(() => props.config.value, (newValue) => {
  localValue.value = newValue || '0x0';
});

// 监听全局关闭所有帮助信息
watch(closeAllHelpTimestamp, () => {
  if (isHelpVisible.value) {
    isHelpVisible.value = false;
  }
});
</script>

<template>
  <div class="hex-input-container" :class="{ readonly: isReadonly }">
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
      <input
        type="text"
        :id="props.config.id"
        v-model="localValue"
        @change="handleChange"
        @blur="handleChange"
        class="hex-input"
        :class="{ readonly: isReadonly }"
        :disabled="isReadonly"
        :placeholder="props.config.name"
        pattern="^0x[0-9a-fA-F]+$"
        :title="isReadonly ? readonlyReason : undefined"
      />
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

      <p class="help-kconfig-title">
        <strong>Format:</strong> 0x followed by hexadecimal digits (0-9, A-F)
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
.hex-input-container {
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

.hex-input {
  flex: 0 0 auto;
  width: 150px;
  max-width: 200px;
  height: 24px;
  padding: 0 8px;
  font-size: 13px;
  line-height: 22px;
  font-family: monospace;
  color: var(--vscode-input-foreground);
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
  border-radius: 2px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
  box-shadow: none;
}

.hex-input:hover:not(:disabled):not(:focus) {
  border-color: var(--vscode-input-border, rgba(128, 128, 128, 0.5));
}

.hex-input:focus {
  border-color: var(--vscode-focusBorder, #007acc);
  outline: none;
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
}

.hex-input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

.hex-input:invalid {
  border-color: var(--vscode-inputValidation-errorBorder);
}

/* 浅色主题优化 */
:global(.vscode-light) .hex-input {
  border-color: rgba(0, 0, 0, 0.25);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

:global(.vscode-light) .hex-input:hover:not(:disabled):not(:focus) {
  border-color: rgba(0, 0, 0, 0.35);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

:global(.vscode-light) .hex-input:focus {
  border-color: var(--vscode-focusBorder, #007acc);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc), 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* 深色主题优化 */
:global(.vscode-dark) .hex-input {
  border-color: rgba(255, 255, 255, 0.18);
}

:global(.vscode-dark) .hex-input:hover:not(:disabled):not(:focus) {
  border-color: rgba(255, 255, 255, 0.28);
}

:global(.vscode-dark) .hex-input:focus {
  border-color: var(--vscode-focusBorder, #007acc);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
}

.help-text {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-top: 4px;
  margin-left: 212px;
  line-height: 1.4;
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
.hex-input-container.readonly {
  opacity: 0.7;
}

.readonly-icon {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  margin-left: 4px;
}

.hex-input.readonly {
  background-color: var(--vscode-input-background);
  color: var(--vscode-descriptionForeground);
  cursor: not-allowed;
}

.hex-input:disabled {
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
</style>