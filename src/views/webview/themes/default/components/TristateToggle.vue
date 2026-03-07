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
import { computed, nextTick, ref, watch } from "vue";
import { Menu } from "../../../../../menuconfig/Menu";
import { IconQuestion } from "@iconify-prerendered/vue-codicon";
import { useMenuconfigStore } from "../../../store";
import { storeToRefs } from "pinia";
import { t } from "../../../i18n";

type TriValue = "y" | "m" | "n";

interface Props {
  config: Menu;
}

const props = defineProps<Props>();
const emit = defineEmits<{ change: [value: TriValue] }>();

const store = useMenuconfigStore();
const { closeAllHelpTimestamp } = storeToRefs(store);

const normalizeTriValue = (value: any): TriValue => {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "y" || lower === "m" || lower === "n") {
      return lower as TriValue;
    }
    if (lower === "true" || lower === "2") {
      return "y";
    }
    if (lower === "1") {
      return "m";
    }
    return "n";
  }
  if (typeof value === "number") {
    if (value >= 2) {
      return "y";
    }
    if (value === 1) {
      return "m";
    }
    return "n";
  }
  if (typeof value === "boolean") {
    return value ? "y" : "n";
  }
  return "n";
};

const allowedOptions = computed<TriValue[]>(() => {
  const allowed = props.config.allowedTristateValues;
  if (allowed && allowed.length > 0) {
    return allowed.map((item: 'n' | 'm' | 'y') => normalizeTriValue(item)) as TriValue[];
  }
  return ["n", "m", "y"];
});

const ensureAllowed = (value: TriValue): TriValue => {
  const options = allowedOptions.value;
  if (options.includes(value)) {
    return value;
  }
  return options[0] ?? "n";
};

const localValue = ref<TriValue>(ensureAllowed(normalizeTriValue(props.config.value)));
const isHelpVisible = ref(false);

const isReadonly = computed(() => props.config.isReadonly === true);
const isToggleDisabled = computed(() => isReadonly.value || allowedOptions.value.length <= 1);

const badgeSymbol = computed(() => {
  switch (localValue.value) {
    case "y":
      return "*";
    case "m":
      return "M";
    default:
      return " ";
  }
});

const nextValue = (value: TriValue): TriValue => {
  const options = allowedOptions.value;
  if (options.length === 0) {
    return value;
  }
  const currentIndex = options.indexOf(value);
  if (currentIndex === -1) {
    return options[0];
  }
  const nextIndex = (currentIndex + 1) % options.length;
  return options[nextIndex];
};

function cycleValue() {
  if (isToggleDisabled.value) {
    return;
  }
  const updated = nextValue(localValue.value);
  localValue.value = updated;
  emit("change", updated);
}

function toggleHelp() {
  isHelpVisible.value = !isHelpVisible.value;
  if (isHelpVisible.value) {
    store.requestMenuDetail(props.config.id);
  }
}

watch(
  () => props.config.value,
  (newValue) => {
    localValue.value = ensureAllowed(normalizeTriValue(newValue));
  }
);

watch(isReadonly, (readonly) => {
  if (readonly) {
    nextTick(() => {
      localValue.value = ensureAllowed(normalizeTriValue(props.config.value));
    });
  }
});

watch(allowedOptions, (options) => {
  if (!options.includes(localValue.value)) {
    localValue.value = ensureAllowed(localValue.value);
  }
});

watch(closeAllHelpTimestamp, () => {
  if (isHelpVisible.value) {
    isHelpVisible.value = false;
  }
});

</script>

<template>
  <div class="tristate-container">
    <div class="field">
      <button
        class="tristate-button"
        type="button"
        :disabled="isToggleDisabled"
        :aria-label="`Toggle ${props.config.title}`"
        :class="[localValue]"
        @click="cycleValue"
      >
        {{ badgeSymbol }}
      </button>
      <label
        class="tristate-label"
        :class="{ readonly: isReadonly }"
        :title="isReadonly ? (props.config.readonlyReason || t('config.readonlyDefault')) : ''"
      >
        {{ props.config.title }}
      </label>
      <div class="info-icon" @click="toggleHelp">
        <IconQuestion />
      </div>
    </div>

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
        <strong>Value:</strong> {{ localValue }}
      </p>

      <div v-if="props.config.help" class="help-kconfig-title">
        <strong>Help:</strong>
        <div class="help-content" v-html="props.config.help" />
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
.tristate-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 0;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tristate-button {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  border: 1px solid var(--vscode-settings-checkboxBorder, var(--vscode-contrastBorder, rgba(255, 255, 255, 0.18)));
  background: var(--vscode-settings-checkboxBackground, rgba(255, 255, 255, 0.02));
  color: var(--vscode-foreground);
  cursor: pointer;
  transition: background-color 0.1s ease, border-color 0.1s ease;
  font-size: 13px;
  line-height: 18px;
  padding: 0;
  font-weight: 600;
  font-family: monospace;
  text-align: center;
  box-sizing: border-box;
  margin-right: 9px;
}


.tristate-button.binary {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid var(--vscode-settings-checkboxBorder, #3c3c3c);
  background: var(--vscode-settings-checkboxBackground, #1e1e1e);
  color: var(--vscode-settings-checkboxForeground, #cccccc);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif);
  box-sizing: border-box;
}

.tristate-button.binary.y,
.tristate-button.binary.n {
  color: var(--vscode-settings-checkboxForeground, #cccccc);
}

.tristate-button.binary:not(:disabled):hover {
  border-color: var(--vscode-focusBorder, #007acc);
  background: var(--vscode-settings-checkboxBackground, #1e1e1e);
}

.tristate-button.binary:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007acc);
  outline-offset: 1px;
}

.binary-check-icon {
  width: 14px;
  height: 14px;
  color: var(--vscode-settings-checkboxForeground, #cccccc);
}


.tristate-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.tristate-button:not(:disabled):hover {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder, rgba(255, 255, 255, 0.4));
}

.tristate-button.y {
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.tristate-button.m {
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.tristate-button.n {
  color: var(--vscode-foreground);
}

.tristate-label {
  cursor: pointer;
}

.tristate-label.readonly {
  cursor: default;
  opacity: 0.7;
}

.info-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--vscode-editorHoverWidget-foreground);
}

.info-icon:hover {
  color: var(--vscode-textLink-foreground);
}

.help-section {
  padding-left: 60px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.help-kconfig-title {
  margin: 0;
}

.help-content {
  margin-top: 4px;
  color: var(--vscode-foreground);
}
</style>
.tristate-button.y:not(:disabled):hover {
  background: var(--vscode-button-hoverBackground);
  border-color: var(--vscode-button-hoverBackground);
}

.tristate-button.y:active {
  background: var(--vscode-button-activeBackground);
  border-color: var(--vscode-button-activeBackground);
}

.tristate-button.binary.y {
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.tristate-button.binary.y:not(:disabled):hover {
  background: var(--vscode-button-hoverBackground);
  border-color: var(--vscode-button-hoverBackground);
}

.tristate-button.binary.y:active {
  background: var(--vscode-button-activeBackground);
  border-color: var(--vscode-button-activeBackground);
}

.tristate-button.binary.m {
  background: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.tristate-button.binary.m:not(:disabled):hover {
  background: var(--vscode-button-hoverBackground);
  border-color: var(--vscode-button-hoverBackground);
}

.tristate-button.binary.m:active {
  background: var(--vscode-button-activeBackground);
  border-color: var(--vscode-button-activeBackground);
}
.tristate-button.m:not(:disabled):hover {
  background: var(--vscode-button-hoverBackground);
  border-color: var(--vscode-button-hoverBackground);
}

.tristate-button.m:active {
  background: var(--vscode-button-activeBackground);
  border-color: var(--vscode-button-activeBackground);
}
