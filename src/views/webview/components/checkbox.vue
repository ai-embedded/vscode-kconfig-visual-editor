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
import { ref, watch, computed, nextTick } from 'vue';
import { Menu } from "../../../menuconfig/Menu";
import { IconCheck, IconQuestion } from "@iconify-prerendered/vue-codicon";
import { useMenuconfigStore } from "../store";
import { storeToRefs } from "pinia";
import { t } from "../i18n";

interface Props {
  config: Menu;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  change: [value: boolean];
}>();

const store = useMenuconfigStore();
const { closeAllHelpTimestamp } = storeToRefs(store);

const localValue = ref(props.config.value);
const isHelpVisible = ref(false);


// 计算是否为只读状态
const isReadonly = computed(() => {
  return props.config.isReadonly === true;
});

// 计算值符号（用于 Kconfig 风格显示）
const valueSymbol = computed(() => {
  return localValue.value ? '*' : ' ';
});

function handleChange() {
  if (isReadonly.value) {
    // 如果是只读状态，阻止更改并恢复原值
    localValue.value = props.config.value;
    return;
  }

  emit('change', localValue.value);
}

const showTooltip = (message: string) => {
  // TODO: 实现提示消息显示逻辑
};

function toggleHelp() {
  isHelpVisible.value = !isHelpVisible.value;
}

// 监听 props.config.value 的变化，强制更新 localValue
watch(() => props.config.value, (newValue) => {
  localValue.value = newValue;
});

// 监听只读状态变化，确保值正确显示
watch(isReadonly, (newReadonly) => {
  if (newReadonly) {
    // 当变为只读状态时，确保 localValue 与 props.config.value 同步
    localValue.value = props.config.value;
  }
});

// 防止在只读状态下通过用户交互更新值
watch(localValue, (newValue, oldValue) => {
  if (isReadonly.value && newValue !== oldValue && newValue !== props.config.value) {
    // 如果是只读状态且值被用户改变，立即恢复
    nextTick(() => {
      localValue.value = props.config.value;
    });
  }
});

// 监听全局关闭所有帮助信息
watch(closeAllHelpTimestamp, () => {
  if (isHelpVisible.value) {
    isHelpVisible.value = false;
  }
});

</script>

<template>
  <div class="checkbox-container">
    <div class="field">
      <div style="display: flex; align-items: center;">
        <div class="checkbox-wrapper">
          <!-- 使用 Kconfig 风格的显示 -->
          <template v-if="isReadonly">
            <span
              :class="[
                'kconfig-value-fixed',
                { active: valueSymbol === '*' }
              ]"
            >
              {{ valueSymbol }}
            </span>
          </template>
          <template v-else>
            <label
              :class="[
                'vscode-checkbox', 
                { 
                  checked: localValue
                }
              ]"
              role="checkbox"
              :aria-checked="localValue?.toString() || 'false'"
            >
            <input
              type="checkbox"
              :id="props.config.id"
              v-model="localValue"
              @change="handleChange"
              style="display: none;"
              :data-config-id="props.config.id"
              class="checkbox-input"
            />
              <span class="icon">
                <IconCheck v-if="localValue" class="icon-checked" />
              </span>
            </label>
          </template>
          <label
            :for="props.config.id"
            :class="['checkbox-label', { readonly: isReadonly }]"
            :title="isReadonly ? (props.config.readonlyReason || t('config.readonlyDefault')) : ''"
          >
            {{ props.config.title }}
          </label>
          <div class="info-icon" @click="toggleHelp">
            <IconQuestion />
          </div>
        </div>
      </div>
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
.checkbox-container {
  /* Use form-group spacing from reference project - 缩进由父组件configElement控制 */
  padding-left: 0px;
  margin-top: 9px;
  margin-bottom: 9px;
  overflow: hidden;
}

.field {
  margin-bottom: 0;
}

.checkbox-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative; /* 为调试信息提供定位上下文 */
}

.vscode-checkbox {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  font-family: var(
    --vscode-font-family,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Helvetica,
    Arial,
    sans-serif
  );
  font-size: 13px;
  color: var(--vscode-settings-checkboxForeground, #cccccc);
  outline: none;
  --check-border-color: var(--vscode-settings-checkboxBorder, #3c3c3c);
  --check-bg-color: var(--vscode-settings-checkboxBackground, #1e1e1e);
  --check-checked-bg: var(--vscode-settings-checkboxBackground, #0e639c);
}

.vscode-checkbox input[type="checkbox"] {
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.vscode-checkbox .icon {
  align-items: center;
  background-color: var(--vscode-settings-checkboxBackground);
  background-size: 16px;
  border: 1px solid var(--vscode-settings-checkboxBorder);
  border-radius: 3px;
  box-sizing: border-box;
  color: var(--vscode-settings-checkboxForeground);
  display: flex;
  height: 18px;
  justify-content: center;
  margin-left: 0;
  margin-right: 9px;
  padding: 0;
  pointer-events: none;
  position: relative;
  width: 18px;
}

.vscode-checkbox.checked .icon {
  background-color: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.vscode-checkbox.checked:hover .icon {
  background-color: var(--vscode-button-hoverBackground);
  border-color: var(--vscode-button-hoverBackground);
}

.vscode-checkbox.checked:active .icon {
  background-color: var(--vscode-button-activeBackground);
  border-color: var(--vscode-button-activeBackground);
}

.vscode-checkbox input[type="checkbox"]:hover + .icon {
  border-color: var(--vscode-focusBorder, #007acc);
}

.vscode-checkbox:focus-within .icon {
  border-color: var(--vscode-focusBorder);
}

.checkbox-label {
  font-size: 14px;
  color: var(--vscode-foreground);
  cursor: pointer;
  user-select: none;
}

.info-icon {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
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
  margin-left: 30px;
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
.vscode-checkbox.readonly {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none; /* 禁止所有鼠标事件 */
}

.vscode-checkbox.readonly .icon {
  background-color: var(--vscode-input-background);
  border-color: var(--vscode-disabledForeground);
}

.checkbox-label.readonly {
  color: var(--vscode-disabledForeground);
  cursor: not-allowed;
}

/* Kconfig 风格的固定值显示 - 模拟被锁定的选中复选框 */
.kconfig-value-fixed {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  box-sizing: border-box;
  margin-right: 9px;
  font-family: monospace;
  font-size: 14px;
  font-weight: bold;
  color: var(--vscode-settings-checkboxForeground, #cccccc);
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-contrastBorder, rgba(255, 255, 255, 0.1));
  border-radius: 3px;
  user-select: none;
  cursor: not-allowed;
  /* 确保文字居中 */
  line-height: 1;
  text-align: center;
}

.kconfig-value-fixed.active {
  background-color: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  box-sizing: border-box;
  cursor: default;
  opacity: 1;
  filter: none;
}
</style>
