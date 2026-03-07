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
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Menu } from "../../../../../menuconfig/Menu";
import ConfigElement from "./configElement.vue";

const props = defineProps<{
  config: Menu;
  depth: number;
  measureEnabled: boolean;
  onHeightChange: (id: string, height: number) => void;
}>();

const rowRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let pendingHeightRaf = 0;
let pendingHeight = 0;
let lastReportedHeight = 0;

const notifyHeight = (height: number) => {
  if (props.config && props.config.id) {
    const nextHeight = Math.max(1, Math.round(height));
    if (nextHeight === lastReportedHeight) {
      return;
    }
    lastReportedHeight = nextHeight;
    props.onHeightChange(props.config.id, nextHeight);
  }
};

function flushPendingHeight() {
  pendingHeightRaf = 0;
  if (pendingHeight <= 0) {
    return;
  }
  notifyHeight(pendingHeight);
}

function scheduleHeight(height: number) {
  pendingHeight = height;
  if (pendingHeightRaf !== 0) {
    return;
  }
  pendingHeightRaf = window.requestAnimationFrame(() => {
    flushPendingHeight();
  });
}

function stopObserver() {
  if (resizeObserver && rowRef.value) {
    resizeObserver.unobserve(rowRef.value);
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  resizeObserver = null;
}

function startObserver() {
  if (!props.measureEnabled || resizeObserver || !rowRef.value) {
    return;
  }

  if (!rowRef.value) {
    return;
  }

  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      scheduleHeight(entry.contentRect.height);
    }
  });

  resizeObserver.observe(rowRef.value);
  scheduleHeight(rowRef.value.getBoundingClientRect().height);
}

watch(
  () => props.measureEnabled,
  (enabled) => {
    if (!enabled) {
      stopObserver();
      return;
    }
    startObserver();
  },
  { immediate: true }
);

onMounted(() => {
  startObserver();
});

onBeforeUnmount(() => {
  stopObserver();
  if (pendingHeightRaf !== 0) {
    window.cancelAnimationFrame(pendingHeightRaf);
    pendingHeightRaf = 0;
  }
});
</script>

<template>
  <div
    ref="rowRef"
    class="virtual-config-row"
    :class="{ 'has-depth': depth > 0 }"
    :style="{
      '--indent-depth': depth
    }"
  >
    <ConfigElement :config="config" :render-children="false" />
  </div>
</template>

<style scoped>
.virtual-config-row {
  position: relative;
  display: flow-root;
  --indent-step: 38px;
  --indent-line-offset: 10px;
  --indent-line-width: 2px;
  --indent-line-color: var(
    --vscode-tree-indentGuidesStroke,
    var(--vscode-panel-border, rgba(128, 128, 128, 0.45))
  );
  padding-left: calc(var(--indent-depth) * var(--indent-step));
  z-index: 0;
}

.virtual-config-row > * {
  position: relative;
  z-index: 1;
}

.virtual-config-row.has-depth::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: calc(var(--indent-depth) * var(--indent-step));
  background-image: linear-gradient(
    to right,
    var(--indent-line-color) 0,
    var(--indent-line-color) var(--indent-line-width),
    transparent var(--indent-line-width),
    transparent var(--indent-step)
  );
  background-repeat: repeat;
  background-size: var(--indent-step) 100%;
  background-position: var(--indent-line-offset) 0;
  opacity: 1;
  z-index: 0;
  pointer-events: none;
}
</style>
