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
  change: [value: number];
}>();

const store = useMenuconfigStore();
const { closeAllHelpTimestamp } = storeToRefs(store);

const localValue = ref(props.config.value || 0);
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
  
  const numValue = parseInt(localValue.value?.toString() || '0', 10);
  if (!isNaN(numValue)) {
    // 验证范围
    const min = props.config.range && props.config.range.length > 0 ? props.config.range[0] : -Infinity;
    const max = props.config.range && props.config.range.length > 1 ? props.config.range[1] : Infinity;
    
    if (numValue < min) {
      localValue.value = min;
      emit('change', min);
    } else if (numValue > max) {
      localValue.value = max;
      emit('change', max);
    } else {
      emit('change', numValue);
    }
  }
}

function increment() {
  if (isReadonly.value) {
    return;
  }
  
  const max = props.config.range && props.config.range.length > 1 ? props.config.range[1] : Infinity;
  if (localValue.value < max) {
    localValue.value++;
    handleChange();
  }
}

function decrement() {
  if (isReadonly.value) {
    return;
  }
  
  const min = props.config.range && props.config.range.length > 0 ? props.config.range[0] : -Infinity;
  if (localValue.value > min) {
    localValue.value--;
    handleChange();
  }
}

function toggleHelp() {
  isHelpVisible.value = !isHelpVisible.value;
}

watch(() => props.config.value, (newValue) => {
  localValue.value = newValue || 0;
});

// 监听全局关闭所有帮助信息
watch(closeAllHelpTimestamp, () => {
  if (isHelpVisible.value) {
    isHelpVisible.value = false;
  }
});
</script>

<template>
  <div class="number-input-container" :class="{ readonly: isReadonly }">
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
      <div class="number-input-wrapper">
        <button
          type="button"
          @click="decrement"
          class="number-button"
          :disabled="isReadonly || (props.config.range && props.config.range.length > 0 && localValue <= props.config.range[0])"
        >
          -
        </button>
        <input
          type="number"
          :id="props.config.id"
          v-model="localValue"
          @change="handleChange"
          @blur="handleChange"
          class="number-input"
          :class="{ readonly: isReadonly }"
          :disabled="isReadonly"
          :min="props.config.range && props.config.range.length > 0 ? props.config.range[0] : undefined"
          :max="props.config.range && props.config.range.length > 1 ? props.config.range[1] : undefined"
          :title="isReadonly ? readonlyReason : undefined"
        />
        <button
          type="button"
          @click="increment"
          class="number-button"
          :disabled="isReadonly || (props.config.range && props.config.range.length > 1 && localValue >= props.config.range[1])"
        >
          +
        </button>
      </div>
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

      <p v-if="props.config.range && props.config.range.length > 1" class="help-kconfig-title">
        <strong>Range:</strong> {{ props.config.range[0] }} - {{ props.config.range[1] }}
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
.number-input-container {
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

.number-input-wrapper {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 0 0 auto;
  width: fit-content;
}

.number-button {
  width: 24px;
  height: 24px;
  padding: 0;
  font-size: 13px;
  color: var(--vscode-button-foreground);
  background-color: var(--vscode-button-background);
  border: 1px solid var(--vscode-button-border, var(--vscode-input-border, rgba(128, 128, 128, 0.35)));
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease-in-out, border-color 0.15s ease-in-out;
}

/* 浅色主题按钮优化 */
:global(.vscode-light) .number-button {
  border-color: rgba(0, 0, 0, 0.25);
}

/* 深色主题按钮优化 */
:global(.vscode-dark) .number-button {
  border-color: rgba(255, 255, 255, 0.18);
}

.number-button:hover:not(:disabled) {
  background-color: var(--vscode-button-hoverBackground);
}

.number-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.number-button:first-child {
  border-radius: 2px 0 0 2px;
}

.number-button:last-child {
  border-radius: 0 2px 2px 0;
}

.number-input {
  width: 80px;
  height: 24px;
  padding: 0 8px;
  font-size: 13px;
  line-height: 22px;
  color: var(--vscode-input-foreground);
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
  border-left: none;
  border-right: none;
  outline: none;
  text-align: center;
  box-sizing: border-box;
  transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
}

/* 隐藏数字输入框的上下调节箭头 */
.number-input::-webkit-outer-spin-button,
.number-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox */
.number-input[type=number] {
  -moz-appearance: textfield;
}

/* 浅色主题优化 */
:global(.vscode-light) .number-input {
  border-top-color: rgba(0, 0, 0, 0.25);
  border-bottom-color: rgba(0, 0, 0, 0.25);
}

/* 深色主题优化 */
:global(.vscode-dark) .number-input {
  border-top-color: rgba(255, 255, 255, 0.18);
  border-bottom-color: rgba(255, 255, 255, 0.18);
}

/* 只读状态样式 */
.number-input-container.readonly {
  opacity: 0.7;
}

.readonly-icon {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  margin-left: 4px;
}

.number-input.readonly {
  background-color: var(--vscode-input-background);
  color: var(--vscode-descriptionForeground);
  cursor: not-allowed;
}

.number-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: var(--vscode-button-secondaryBackground);
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

.number-input:focus {
  border-top-color: var(--vscode-focusBorder, #007acc);
  border-bottom-color: var(--vscode-focusBorder, #007acc);
  outline: none;
  position: relative;
  z-index: 1;
}

/* Focus 状态下整个输入组的视觉效果 */
.number-input:focus + .number-button {
  border-left-color: var(--vscode-focusBorder, #007acc);
}

.number-input-wrapper:has(.number-input:focus) .number-button:first-child {
  border-right-color: var(--vscode-focusBorder, #007acc);
}

.number-input-wrapper:has(.number-input:focus) .number-button {
  z-index: 0;
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
</style>