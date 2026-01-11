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
import { computed, ref, watch, nextTick, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useMenuconfigStore } from "../../../store";
import type { DisplayRow } from "../types";
import type { Menu } from "../../../../../menuconfig/Menu";

const props = defineProps<{
  row: DisplayRow;
  collapsed: boolean;
  hidden: boolean;
}>();

const emit = defineEmits<{
  (event: "updateCollapse", id: string, value: boolean): void;
}>();

const store = useMenuconfigStore();
const { closeAllHelpTimestamp } = storeToRefs(store);

const isMenuRow = computed(() => props.row.type === "menu");
const isChoiceRow = computed(() => props.row.type === "choice");
const isBoolRow = computed(() => props.row.type === "bool");
const isTristateRow = computed(() => props.row.type === "tristate");
const isStringRow = computed(() => props.row.type === "string");
const isIntRow = computed(() => props.row.type === "int");
const isHexRow = computed(() => props.row.type === "hex");
const isCommentRow = computed(() => props.row.type === "comment");
const isMenuConfig = computed(() => props.row.item.isMenuconfig === true);

const canToggleMenu = computed(() => {
  if (!isMenuRow.value) {
    return false;
  }
  if (props.row.item.isVirtual === true && props.row.item.childrenParsed !== true) {
    return true;
  }
  return props.row.hasChildren === true;
});

type TriValue = "n" | "m" | "y";

const allowedTriOptions = computed<TriValue[]>(() => {
  const allowed = props.row.item.allowedTristateValues;
  if (allowed && allowed.length > 0) {
    const normalized: TriValue[] = [];
    for (const option of allowed) {
      const normalizedValue = normalizeTriValue(option);
      if (!normalized.includes(normalizedValue)) {
        normalized.push(normalizedValue);
      }
    }
    return normalized.length > 0 ? normalized : ["n", "m", "y"];
  }
  return ["n", "m", "y"];
});

const triSelectOptions = computed<Array<{ value: TriValue; disabled: boolean }>>(() =>
  (["n", "m", "y"] as TriValue[]).map((option) => ({
    value: option,
    disabled: !allowedTriOptions.value.includes(option),
  }))
);

const isTriSelectDisabled = computed(
  () => isReadonly.value || allowedTriOptions.value.length <= 1
);

const isReadonly = computed(() => props.row.item.isReadonly === true);
const readonlyReason = computed(() => props.row.item.readonlyReason || "");

const propertyLabel = computed(() => props.row.item.title || props.row.item.name || props.row.id);

const indentStyle = computed(() => ({
  paddingLeft: `${props.row.level * 20 + (isMenuRow.value ? 4 : 28)}px`,
}));

const helpIndentStyle = computed(() => ({
  paddingLeft: `${props.row.level * 20 + 32}px`,
}));

const hasHelp = computed(() => {
  if (isMenuRow.value) {
    return false;
  }
  const item = props.row.item;
  return Boolean(
    item.help ||
    item.prompt ||
    item.directDepExpr ||
    item.menuPath ||
    item.sourceFile ||
    (item.sourceFiles && item.sourceFiles.length > 0)
  );
});

const helpVisible = ref(false);
watch(closeAllHelpTimestamp, () => {
  helpVisible.value = false;
});

const collapsed = ref(props.collapsed);
function updateCollapseState(
  value: boolean,
  options: { emit?: boolean } = {}
) {
  const { emit: shouldEmit = true } = options;
  collapsed.value = value;
  if (shouldEmit) {
    emit("updateCollapse", props.row.id, value);
  }
}

watch(
  () => props.collapsed,
  (value) => {
    updateCollapseState(value, { emit: false });
  }
);

const expandIcon = computed(() => {
  if (!canToggleMenu.value) {
    return "▶";
  }
  return collapsed.value ? "▶" : "▼";
});

const boolValue = ref(toBoolean(props.row.item.value));
watch(
  () => props.row.item.value,
  (value) => {
    boolValue.value = toBoolean(value);
    if (isMenuConfig.value && !boolValue.value) {
      updateCollapseState(true);
    }
  }
);

const triValue = ref<TriValue>(
  ensureTriValueAllowed(normalizeTriValue(props.row.item.value))
);
watch(
  () => props.row.item.value,
  (value) => {
    triValue.value = ensureTriValueAllowed(normalizeTriValue(value));
  }
);

watch(allowedTriOptions, () => {
  triValue.value = ensureTriValueAllowed(triValue.value);
});

const stringValue = ref(toStringValue(props.row.item.value));
watch(
  () => props.row.item.value,
  (value) => {
    stringValue.value = toStringValue(value);
  }
);

const numberValue = ref(toNumberValue(props.row.item.value));
watch(
  () => props.row.item.value,
  (value) => {
    numberValue.value = toNumberValue(value);
  }
);

const hexValue = ref(toHexValue(props.row.item.value));
watch(
  () => props.row.item.value,
  (value) => {
    hexValue.value = toHexValue(value);
  }
);

const choiceValue = ref(toChoiceValue(props.row.item.value));
watch(
  () => props.row.item.value,
  (value) => {
    choiceValue.value = toChoiceValue(value);
  }
);

const choiceOptions = computed<Array<{ id: string; name: string; title: string }>>(() => {
  return (props.row.item.children || []).map((child: Menu) => ({
    id: child.id,
    name: child.name,
    title: child.title || child.name
  }));
});

const choiceSelectRef = ref<HTMLSelectElement | null>(null);
const choiceSelectWidth = ref("140px");
let choiceMeasureCanvas: HTMLCanvasElement | null = null;

const choiceOptionLabels = computed(() =>
  choiceOptions.value
    .map((option: { title?: string; name?: string }) => option.title || option.name || "")
    .filter(Boolean)
);

const measureChoiceTextWidth = (text: string, font: string): number => {
  if (!choiceMeasureCanvas) {
    choiceMeasureCanvas = document.createElement("canvas");
  }
  const ctx = choiceMeasureCanvas.getContext("2d");
  if (!ctx) {
    return text.length * 8;
  }
  ctx.font = font;
  return ctx.measureText(text).width;
};

const updateChoiceSelectWidth = () => {
  const labels = choiceOptionLabels.value;
  const minWidth = 140;
  if (!isChoiceRow.value || labels.length === 0) {
    choiceSelectWidth.value = `${minWidth}px`;
    return;
  }

  const target = choiceSelectRef.value;
  let font = "13px sans-serif";
  let paddingLeft = 10;
  let paddingRight = 28;
  let borderLeft = 1;
  let borderRight = 1;

  if (target && typeof window !== "undefined") {
    const style = window.getComputedStyle(target);
    font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    paddingLeft = parseFloat(style.paddingLeft) || paddingLeft;
    paddingRight = parseFloat(style.paddingRight) || paddingRight;
    borderLeft = parseFloat(style.borderLeftWidth) || borderLeft;
    borderRight = parseFloat(style.borderRightWidth) || borderRight;
  }

  const maxLabelWidth = labels.reduce((max: number, text: string) => {
    return Math.max(max, measureChoiceTextWidth(text, font));
  }, 0);

  const arrowSize = 14;
  const arrowGap = 10;
  const totalWidth = Math.ceil(
    maxLabelWidth +
      paddingLeft +
      paddingRight +
      borderLeft +
      borderRight +
      arrowSize +
      arrowGap
  );
  choiceSelectWidth.value = `${Math.max(minWidth, totalWidth)}px`;
};

const rangeMin = computed(() => props.row.item.range?.[0]);
const rangeMax = computed(() => props.row.item.range?.[1]);

watch(choiceOptionLabels, () => {
  nextTick(updateChoiceSelectWidth);
}, { immediate: true });

watch(() => props.row.id, () => {
  nextTick(updateChoiceSelectWidth);
});

onMounted(() => {
  nextTick(updateChoiceSelectWidth);
});

function toggleHelp() {
  helpVisible.value = !helpVisible.value;
}

function toggleMenu() {
  if (!canToggleMenu.value) {
    return;
  }
  if (isMenuConfig.value && !boolValue.value) {
    return;
  }
  const next = !collapsed.value;
  updateCollapseState(next);
  if (
    !next &&
    props.row.item.isVirtual &&
    !props.row.item.childrenParsed
  ) {
    const targetId = props.row.item.id || props.row.id;
    store.loadVirtualNodeContent(targetId);
  }
}

function onPropertyContentClick(event: MouseEvent) {
  if (!isMenuRow.value) {
    return;
  }

  if (!canToggleMenu.value) {
    return;
  }

  const target = event.target as HTMLElement | null;
  if (target?.closest(".expand-icon, .help-icon, .toggle-switch")) {
    return;
  }

  event.stopPropagation();
  toggleMenu();
}

function onMenuConfigToggle(event: Event) {
  if (isReadonly.value) {
    (event.target as HTMLInputElement).checked = boolValue.value;
    return;
  }

  const value = (event.target as HTMLInputElement).checked;
  boolValue.value = value;
  updateValue(value);

  if (value) {
    updateCollapseState(false);
    if (props.row.item.isVirtual && !props.row.item.childrenParsed) {
      const targetId = props.row.item.id || props.row.id;
      store.loadVirtualNodeContent(targetId);
    }
  } else {
    updateCollapseState(true);
  }
}

function onBooleanToggle(event: Event) {
  if (isReadonly.value) {
    (event.target as HTMLInputElement).checked = boolValue.value;
    return;
  }
  const value = (event.target as HTMLInputElement).checked;
  boolValue.value = value;
  updateValue(value);
}

function onTriValueChange(event: Event) {
  if (isTriSelectDisabled.value) {
    event.preventDefault();
    triValue.value = ensureTriValueAllowed(normalizeTriValue(props.row.item.value));
    return;
  }
  const target = event.target as HTMLSelectElement;
  const next = ensureTriValueAllowed(normalizeTriValue(target.value));
  const current = ensureTriValueAllowed(normalizeTriValue(props.row.item.value));
  if (next !== triValue.value) {
    triValue.value = next;
  }
  if (next !== current) {
    updateValue(next);
  }
}

function onStringInput(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target) {
    return;
  }
  stringValue.value = target.value;
}

function onStringCommit(event?: Event) {
  if (isReadonly.value) {
    stringValue.value = toStringValue(props.row.item.value);
    return;
  }
  const inputValue = (() => {
    const target = event?.target as HTMLInputElement | null;
    return target ? target.value : stringValue.value;
  })();
  stringValue.value = inputValue;
  updateValue(inputValue);
}

function onNumberCommit(event?: Event) {
  if (isReadonly.value) {
    numberValue.value = toNumberValue(props.row.item.value);
    return;
  }
  const target = event?.target as HTMLInputElement | undefined;
  const eventValue = target ? target.value : String(numberValue.value);
  const trimmed = eventValue.trim();
  if (!trimmed) {
    const fallback = toNumberValue(props.row.item.value);
    numberValue.value = fallback;
    if (target) {
      target.value = String(fallback);
    }
    if (toNumberValue(props.row.item.value) !== fallback) {
      updateValue(fallback);
    }
    return;
  }
  let value = Number.parseInt(trimmed, 10);
  if (Number.isNaN(value)) {
    value = toNumberValue(props.row.item.value);
  }
  if (rangeMin.value !== undefined) {
    value = Math.max(value, rangeMin.value);
  }
  if (rangeMax.value !== undefined) {
    value = Math.min(value, rangeMax.value);
  }
  numberValue.value = value;
  if (toNumberValue(props.row.item.value) !== value) {
    updateValue(value);
  }
}

function onNumberStep(delta: number) {
  if (isReadonly.value) {
    return;
  }
  let value = Number(numberValue.value) + delta;
  if (rangeMin.value !== undefined) {
    value = Math.max(value, rangeMin.value);
  }
  if (rangeMax.value !== undefined) {
    value = Math.min(value, rangeMax.value);
  }
  numberValue.value = value;
  updateValue(value);
}

function onHexCommit(event?: Event) {
  if (isReadonly.value) {
    hexValue.value = toHexValue(props.row.item.value);
    return;
  }
  const target = event?.target as HTMLInputElement | undefined;
  const eventValue = target ? target.value : hexValue.value;
  const formatted = formatHexString(eventValue);
  hexValue.value = formatted;
  if (target && target.value !== formatted) {
    target.value = formatted;
  }
  if (toHexValue(props.row.item.value) !== formatted) {
    updateValue(formatted);
  }
}

function onHexStep(delta: number) {
  if (isReadonly.value) {
    return;
  }
  const current = toNumericHex(hexValue.value);
  if (!Number.isFinite(current)) {
    return;
  }
  let next = current + delta;
  if (rangeMin.value !== undefined) {
    next = Math.max(next, rangeMin.value);
  }
  if (rangeMax.value !== undefined) {
    next = Math.min(next, rangeMax.value);
  }
  if (next < 0) {
    next = 0;
  }
  const formatted = formatHexString(next.toString(16));
  hexValue.value = formatted;
  updateValue(formatted);
}

function onChoiceChange(event: Event) {
  if (isReadonly.value) {
    event.preventDefault();
    choiceValue.value = toChoiceValue(props.row.item.value);
    return;
  }
  const value = (event.target as HTMLSelectElement).value;
  choiceValue.value = value;
  updateValue(value);
}

function updateValue(value: any) {
  const updated = {
    ...props.row.item,
    value,
    lastModified: Date.now(),
  } as Menu;
  props.row.item.value = value;
  store.sendNewValue(updated);
}

function toBoolean(value: any): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "y" || value === "Y" || value === 1 || value === "1") {
    return true;
  }
  return false;
}

function normalizeTriValue(value: any): TriValue {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "y" || lower === "true" || lower === "2") {
      return "y";
    }
    if (lower === "m" || lower === "1") {
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
}

function ensureTriValueAllowed(value: TriValue): TriValue {
  const options = allowedTriOptions.value;
  if (options.includes(value)) {
    return value;
  }
  return options[0] ?? "n";
}

function toStringValue(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function toNumberValue(value: any): number {
  if (typeof value === "number") {
    return value;
  }
  const parsed = parseInt(String(value), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toHexValue(value: any): string {
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    return value.toLowerCase();
  }
  if (typeof value === "number") {
    return `0x${value.toString(16)}`;
  }
  const parsed = parseInt(String(value), 16);
  if (!Number.isNaN(parsed)) {
    return `0x${parsed.toString(16)}`;
  }
  return "0x0";
}

function formatHexString(raw: string): string {
  let text = raw.trim();
  if (!text) {
    return toHexValue(props.row.item.value);
  }
  if (!text.startsWith("0x") && !text.startsWith("0X")) {
    text = `0x${text}`;
  }
  if (!/^0x[0-9a-fA-F]+$/.test(text)) {
    return toHexValue(props.row.item.value);
  }
  return text.toLowerCase();
}

function toChoiceValue(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object" && value !== null && "name" in value) {
    return String((value as { name: string }).name);
  }
  return String(value);
}

function toNumericHex(value: string): number {
  const text = value.trim();
  if (!text) {
    return 0;
  }
  const normalized = text.startsWith("0x") || text.startsWith("0X") ? text : `0x${text}`;
  const parsed = parseInt(normalized, 16);
  return Number.isNaN(parsed) ? NaN : parsed;
}
</script>

<template>
  <div
    class="table-row"
    :class="[
      { 'menu-row': isMenuRow, 'comment-row': isCommentRow, readonly: isReadonly },
      { collapsed }
    ]"
    v-show="!hidden"
  >
    <div class="table-cell property-col">
      <div
        class="property-content"
        :class="{ 'menu-clickable': isMenuRow }"
        :style="indentStyle"
        @click="onPropertyContentClick"
      >
        <button
          v-if="isMenuRow"
          class="expand-icon"
          type="button"
          :aria-expanded="canToggleMenu ? !collapsed : undefined"
          :disabled="!canToggleMenu"
          @click.stop="toggleMenu"
        >
          {{ expandIcon }}
        </button>
        <span class="property-name">{{ propertyLabel }}</span>
        <span v-if="isReadonly" class="readonly-tag" :title="readonlyReason">LOCK</span>
        <button v-if="hasHelp" class="help-icon" type="button" @click.stop="toggleHelp">?</button>
      </div>
    </div>
    <div class="table-cell value-col">
      <template v-if="isMenuRow">
        <label v-if="isMenuConfig" class="toggle-switch">
          <input
            type="checkbox"
            :checked="boolValue"
            :disabled="isReadonly"
            @change="onMenuConfigToggle"
          />
          <span class="toggle-slider"></span>
        </label>
      </template>
      <template v-else-if="isBoolRow">
        <label class="toggle-switch">
          <input
            type="checkbox"
            :checked="boolValue"
            :disabled="isReadonly"
            @change="onBooleanToggle"
          />
          <span class="toggle-slider"></span>
        </label>
      </template>
      <template v-else-if="isTristateRow">
        <select
          class="select-input"
          :value="triValue"
          :disabled="isTriSelectDisabled"
          @change="onTriValueChange"
        >
          <option
            v-for="option in triSelectOptions"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
          >
            {{ option.value }}
          </option>
        </select>
      </template>
      <template v-else-if="isIntRow">
        <div class="number-input-wrapper">
          <input
            class="text-input number-input"
            type="number"
            :min="rangeMin"
            :max="rangeMax"
            :value="numberValue"
            :disabled="isReadonly"
            @change="onNumberCommit($event)"
            @blur="onNumberCommit($event)"
            @keydown.enter.prevent="onNumberCommit($event)"
          />
          <div class="number-arrows">
            <button type="button" @click="onNumberStep(1)" :disabled="isReadonly">▲</button>
            <button type="button" @click="onNumberStep(-1)" :disabled="isReadonly">▼</button>
          </div>
        </div>
      </template>
      <template v-else-if="isHexRow">
        <div class="hex-input-wrapper">
          <input
            class="text-input hex-input"
            type="text"
            :value="hexValue"
            :disabled="isReadonly"
            @change="onHexCommit($event)"
            @blur="onHexCommit($event)"
            @keydown.enter.prevent="onHexCommit($event)"
          />
          <div class="number-arrows">
            <button type="button" @click="onHexStep(1)" :disabled="isReadonly">▲</button>
            <button type="button" @click="onHexStep(-1)" :disabled="isReadonly">▼</button>
          </div>
        </div>
      </template>
      <template v-else-if="isStringRow">
        <input
          class="text-input string-input"
          type="text"
          :value="stringValue"
          :disabled="isReadonly"
          @input="onStringInput"
          @change="onStringCommit"
          @blur="onStringCommit"
        />
      </template>
      <template v-else-if="isChoiceRow">
        <select
          class="select-input"
          ref="choiceSelectRef"
          :value="choiceValue"
          :disabled="isReadonly"
          @change="onChoiceChange"
          :style="{ width: choiceSelectWidth, maxWidth: '100%' }"
        >
          <option
            v-for="option in choiceOptions"
            :key="option.id || option.name"
            :value="option.name"
          >
            {{ option.title }}
          </option>
        </select>
      </template>
      <template v-else-if="isCommentRow">
        <span class="comment-text">{{ props.row.item.title || props.row.item.prompt }}</span>
      </template>
      <template v-else>
        <span class="plain-value">{{ props.row.item.value }}</span>
      </template>
    </div>
  </div>
  <div v-if="helpVisible && hasHelp" class="help-row" :style="helpIndentStyle">
    <p><strong>Name:</strong> {{ props.row.item.name }}</p>
    <p v-if="props.row.item.prompt"><strong>Prompt:</strong> {{ props.row.item.prompt }}</p>
    <p><strong>Type:</strong> {{ props.row.item.type }}</p>
    <p v-if="props.row.item.directDepExpr"><strong>Depends on:</strong> {{ props.row.item.directDepExpr }}</p>
    <p v-if="props.row.item.menuPath"><strong>Menu path:</strong> {{ props.row.item.menuPath }}</p>
    <p v-if="props.row.item.sourceFile && props.row.item.linenr">
      <strong>Location:</strong> {{ props.row.item.sourceFile }}:{{ props.row.item.linenr }}
    </p>
    <div v-if="props.row.item.help" class="help-content" v-html="props.row.item.help"></div>
    <div v-if="props.row.item.sourceFiles && props.row.item.sourceFiles.length">
      <strong>Includes:</strong>
      <ul>
        <li v-for="(file, index) in props.row.item.sourceFiles" :key="index">{{ file }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped lang="scss">
.table-row {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  min-height: 36px;
  transition: background-color 0.2s ease;
}

.table-row.menu-row {
  background-color: var(--bg-secondary);
}

.table-row.comment-row {
  font-style: italic;
  color: var(--text-secondary);
}

.table-row.readonly .property-name {
  color: var(--text-secondary);
}

.table-row:hover {
  background-color: var(--bg-hover);
}

.table-cell {
  display: flex;
  align-items: center;
  padding: 8px 12px;
}

.table-cell.property-col {
  flex: 1;
  border-right: 1px solid var(--border-color);
}

.table-cell.value-col {
  flex: 2;
  min-width: 160px;
  padding-left: 20px;
  justify-content: flex-start;
}

.property-content {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.property-content.menu-clickable {
  cursor: pointer;
}

.property-content.menu-clickable .property-name {
  cursor: pointer;
}

.expand-icon {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition: color 0.2s ease;
}

.expand-icon:hover {
  color: var(--accent-blue);
}

.expand-icon:disabled {
  color: var(--text-muted);
  cursor: default;
  opacity: 0.5;
}

.expand-icon:disabled:hover {
  color: var(--text-muted);
}

.property-name {
  flex: 1;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.help-icon {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}

.help-icon:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.readonly-tag {
  padding: 2px 6px;
  border-radius: 4px;
  background-color: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 10px;
  letter-spacing: 0.5px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background-color: var(--bg-tertiary);
  border-radius: 24px;
  transition: all 0.3s ease;
  border: 1px solid var(--border-color);
}

.toggle-slider::before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  background-color: #ffffff;
  border-radius: 50%;
  transition: transform 0.3s ease;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--accent-blue);
  border-color: var(--accent-blue);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translate(22px, -50%);
}

.text-input {
  background-color: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 4px;
  color: var(--text-primary);
  padding: 4px 10px;
  font-size: 13px;
  min-height: 28px;
  width: 100%;
  box-sizing: border-box;
  outline: none;
}

.string-input {
  flex: 0 0 auto;
  width: 200px;
  max-width: 280px;
}

.text-input:focus {
  border-color: var(--input-focus);
}

.text-input:disabled,
.select-input:disabled,
.number-arrows button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.select-input {
  background-color: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 4px;
  color: var(--text-primary);
  padding: 4px 28px 4px 10px;
  font-size: 13px;
  min-height: 28px;
  outline: none;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--text-secondary) 50%), linear-gradient(135deg, var(--text-secondary) 50%, transparent 50%);
  background-position: calc(100% - 14px) calc(50% - 2px), calc(100% - 8px) calc(50% - 2px);
  background-size: 6px 6px, 6px 6px;
  background-repeat: no-repeat;
}

.number-input-wrapper,
.hex-input-wrapper {
  position: relative;
  width: 140px;
}

.number-arrows {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.number-arrows button {
  width: 16px;
  height: 12px;
  border: none;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
  border-radius: 2px;
}

.number-arrows button:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.number-input {
  appearance: textfield;
  -moz-appearance: textfield;
  padding-right: 28px;
}

.number-input::-webkit-outer-spin-button,
.number-input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}

.hex-input {
  padding-right: 28px;
}

.help-row {
  background-color: var(--bg-tertiary);
  border-left: 2px solid var(--accent-blue);
  margin: 0;
  padding: 12px 16px;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.5;
}

.help-row ul {
  margin: 4px 0 0 18px;
  padding: 0;
}

.comment-text {
  color: var(--text-secondary);
}

.plain-value {
  color: var(--text-primary);
}
</style>
