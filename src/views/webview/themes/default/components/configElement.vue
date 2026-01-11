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
import { Menu, menuType } from "../../../../../menuconfig/Menu";
import { useMenuconfigStore } from "../../../store";
import { storeToRefs } from "pinia";
import ConfigElement from "./configElement.vue";
import SelectDropdown from "./SelectDropdown.vue";
import Checkbox from "./checkbox.vue";
import NumberInput from "./NumberInput.vue";
import StringInput from "./StringInput.vue";
import HexInput from "./HexInput.vue";
import TristateToggle from "./TristateToggle.vue";
import { IconQuestion } from "@iconify-prerendered/vue-codicon";
import { onMounted, ref, computed, watch, nextTick } from "vue";
import { t } from "../../../i18n";

const props = defineProps<{
  config: Menu;
  renderChildren?: boolean;
}>();
const store = useMenuconfigStore();
const { closeAllHelpTimestamp } = storeToRefs(store);

// 元素引用，用于获取实际缩进
const elementRef = ref<HTMLElement | null>(null);

// Local collapsed state for this menu - mainmenu defaults to expanded, others collapsed
const isMainMenu = computed(() => {
  if (props.config.isMainMenu === true) {
    return true;
  }
  const id = props.config.id || "";
  if (typeof id === 'string' && id.startsWith("mainmenu-")) {
    return true;
  }
  if (props.config.name === "__MAINMENU__") {
    return true;
  }
  return false;
});
// 输出关键的缩进信息
// Debug function removed - no longer needed in production

// 对于 menuconfig，根据其值决定初始折叠状态
const getInitialCollapsedState = () => {
  // 只对 menu 类型显示折叠状态日志，减少噪音
  if (props.config.type === 'menu' || props.config.isMenuconfig) {
    //console.log(`[MENUCONFIG_DEBUG] ===== 计算初始折叠状态 =====`);
    //console.log(`[MENUCONFIG_DEBUG] 配置信息:`);
    //console.log(`[MENUCONFIG_DEBUG]   - ID: ${props.config.id}`);
    //console.log(`[MENUCONFIG_DEBUG]   - Name: ${props.config.name}`);
    //console.log(`[MENUCONFIG_DEBUG]   - Title: ${props.config.title}`);
    //console.log(`[MENUCONFIG_DEBUG]   - Type: ${props.config.type}`);
    //console.log(`[MENUCONFIG_DEBUG]   - isMenuconfig: ${props.config.isMenuconfig}`);
    //console.log(`[MENUCONFIG_DEBUG]   - isVirtual: ${props.config.isVirtual}`);
    //console.log(`[MENUCONFIG_DEBUG]   - value: ${props.config.value}`);
    //console.log(`[MENUCONFIG_DEBUG]   - isCollapsed: ${props.config.isCollapsed}`);
    //console.log(`[MENUCONFIG_DEBUG]   - isMainMenu: ${isMainMenu.value}`);
    //console.log(`[MENUCONFIG_DEBUG]   - has children: ${props.config.children && props.config.children.length > 0}`);
  }
  
  if (isMainMenu.value) {
    if (props.config.type === 'menu' || props.config.isMenuconfig) {
      //console.log(`[MENUCONFIG_DEBUG] ✅ 主菜单不折叠`);
      //console.log(`[MENUCONFIG_DEBUG] ===== 折叠状态计算完成 =====`);
    }
    return false;
  }
  
  // 对于所有的 menu 类型（包括 RT-Thread Kernel 等顶级菜单），默认应该是折叠状态
  // 只有用户点击展开箭头后才会展开
  
  // 如果是 menu 类型或 menuconfig 类型
  if (props.config.type === 'menu' || props.config.isMenuconfig) {
    if (typeof props.config.isCollapsed === 'boolean') {
      return props.config.isCollapsed;
    }
    //console.log(`[MENUCONFIG_DEBUG] 🔍 Menu 节点默认折叠`);
    //console.log(`[MENUCONFIG_DEBUG]   - Title: ${props.config.title}`);
    //console.log(`[MENUCONFIG_DEBUG]   - Type: ${props.config.type}`);
    //console.log(`[MENUCONFIG_DEBUG]   - isMenuconfig: ${props.config.isMenuconfig}`);
    
    // menuconfig 类型如果值为 true，可以默认展开
    if (props.config.isMenuconfig && props.config.value === true) {
      //console.log(`[MENUCONFIG_DEBUG] ✅ menuconfig 已选中，默认展开`);
      //console.log(`[MENUCONFIG_DEBUG] ===== 折叠状态计算完成 =====`);
      return false;
    }
    
    // 其他情况默认折叠
    //console.log(`[MENUCONFIG_DEBUG] ✅ 默认折叠状态: true`);
    //console.log(`[MENUCONFIG_DEBUG] ===== 折叠状态计算完成 =====`);
    return true;
  }
  
  // 非 menu 类型的配置项不需要折叠
  //console.log(`[MENUCONFIG_DEBUG] 非 menu 类型，不需要折叠`);
  if (typeof props.config.isCollapsed === 'boolean') {
    return props.config.isCollapsed;
  }
  return false;
};
const isCollapsed = ref(getInitialCollapsedState());
const isHelpVisible = ref(false);

watch(
  () => props.config.isCollapsed,
  (newValue) => {
    if (typeof newValue === 'boolean' && newValue !== isCollapsed.value) {
      isCollapsed.value = newValue;
    }
  }
);

onMounted(() => {
  // Component initialization
});

function toggleHelp() {
  isHelpVisible.value = !isHelpVisible.value;
}

function onChange(e: any) {
  if (props.config.isReadonly) {
    ////console.log(`[MENUCONFIG_DEBUG] ⚠️ 配置为只读，忽略变更: ${props.config.readonlyReason || '未知'}`);
    return;
  }
  
  // 对于 menuconfig 类型的配置项，根据值的变化自动控制折叠/展开状态
  if (props.config.isMenuconfig) {
    const newCollapsedState = !e;
    ////console.log(`[MENUCONFIG_DEBUG] 🔧 menuconfig 折叠状态: ${isCollapsed.value} → ${newCollapsedState}`);
    
    isCollapsed.value = newCollapsedState;
    props.config.isCollapsed = isCollapsed.value;
    
    // 如果选中且是虚拟节点，触发懒加载
    if (e === true && props.config.isVirtual && !props.config.childrenParsed) {
      ////console.log(`[MENUCONFIG_DEBUG] 🚀 menuconfig 选中，触发懒加载: ${props.config.id}`);
      store.loadVirtualNodeContent(props.config.id);
    }
  }
  
  const updatedConfig = {
    ...props.config,
    value: e,
    lastModified: Date.now()
  };
  
  ////console.log(`[MENUCONFIG_DEBUG] 📤 发送新值到后端: ${updatedConfig.value}`);
  store.sendNewValue(updatedConfig);
}

function toggleCollapse() {
  if (isMainMenu.value) {
    return;
  }

  // 记录状态变更前的信息
  const wasCollapsed = isCollapsed.value;
  //console.log(`[MENUCONFIG_DEBUG] 状态变更前: ${wasCollapsed ? '折叠' : '展开'}`);

  // menuconfig 的折叠状态必须与其选中状态保持一致
  if (props.config.isMenuconfig) {
    if (props.config.value !== true) {
      // 未选中的 menuconfig 不允许展开
      //console.log(`[MENUCONFIG_DEBUG] ⚠️ menuconfig 未选中，不允许展开`);
      isCollapsed.value = true;
      props.config.isCollapsed = true;
      return;
    } else {
      // 已选中的 menuconfig 允许切换
      isCollapsed.value = !isCollapsed.value;
      props.config.isCollapsed = isCollapsed.value;
    }
  } else {
    // 普通 menu 正常切换
    isCollapsed.value = !isCollapsed.value;
    props.config.isCollapsed = isCollapsed.value;
  }

  ////console.log(`[MENUCONFIG_DEBUG] 🔄 状态变更: ${wasCollapsed ? '折叠' : '展开'} → ${isCollapsed.value ? '折叠' : '展开'}`);

  // 检查是否需要懒加载
  if (!isCollapsed.value && props.config.isVirtual && !props.config.childrenParsed) {
    ////console.log(`[MENUCONFIG_DEBUG] 🚀 触发懒加载: ${props.config.id}`);
    store.loadVirtualNodeContent(props.config.id);
  }

  ////console.log(`[MENUCONFIG_DEBUG] ===== 折叠状态切换完成 =====`);
}

// 监听全局关闭所有帮助信息
watch(closeAllHelpTimestamp, () => {
  if (isHelpVisible.value) {
    isHelpVisible.value = false;
  }
});
</script>

<template>
  <div
    ref="elementRef"
    v-if="props.config.isVisible !== false || props.config.isContainerVisible"
    :class="{ 'config-el': props.config.type !== 'menu' }"
  >
    <SelectDropdown
      v-if="props.config.type === 'choice' && props.config.isVisible"
      :config="props.config"
      @change="onChange"
    />
    <Checkbox
      v-if="props.config.type === 'bool' && props.config.isVisible"
      :config="props.config"
      @change="onChange"
    />
    <TristateToggle
      v-if="props.config.type === 'tristate' && props.config.isVisible"
      :config="props.config"
      @change="onChange"
    />
    <NumberInput
      v-if="props.config.type === 'int' && props.config.isVisible"
      :config="props.config"
      @change="onChange"
    />
    <StringInput
      v-if="props.config.type === 'string' && props.config.isVisible"
      :config="props.config"
      @change="onChange"
    />
    <HexInput
      v-if="props.config.type === 'hex' && props.config.isVisible"
      :config="props.config"
      @change="onChange"
    />
    <div
      v-if="props.config.type === 'menu' && props.config.isVisible"
      :id="props.config.id"
      class="submenu"
    >
      <div class="menu-header">
        <div class="collapse-slot">
          <button
            v-if="(props.config.children && props.config.children.length > 0) || props.config.isVirtual"
            class="collapse-button"
            @click="toggleCollapse"
            :aria-expanded="!isCollapsed"
            :aria-label="isCollapsed ? t('menu.expand') : t('menu.collapse')"
          >
            <svg
              class="collapse-icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              :class="{ 'rotated': !isCollapsed }"
            >
              <path
                d="m12.14 8.753-5.482 4.796c-.646.566-1.658.106-1.658-.753V3.204a1 1 0 0 1 1.659-.753l5.48 4.796a1 1 0 0 1 0 1.506z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <h4 class="menu-title" v-text="props.config.title" />
        <Checkbox
          class="menuconfig"
          v-if="props.config.isMenuconfig"
          :config="props.config"
          @change="onChange"
        />
      </div>

      <!-- Enhanced help information for menu -->
      <div v-show="!isMainMenu && isHelpVisible" class="menu-help-section">
        <p class="menu-help-kconfig-title">
          <strong>Name:</strong> {{ props.config.name }}
        </p>

        <p v-if="props.config.prompt" class="menu-help-kconfig-title">
          <strong>Prompt:</strong> {{ props.config.prompt }}
        </p>

        <p class="menu-help-kconfig-title">
          <strong>Type:</strong> {{ props.config.type }}
        </p>

        <div v-if="props.config.help" class="menu-help-kconfig-title">
          <strong>Help:</strong>
          <div class="menu-help-content" v-html="props.config.help" />
        </div>

        <p v-if="props.config.directDepExpr" class="menu-help-kconfig-title">
          <strong>Direct dependencies:</strong><br>
          {{ props.config.directDepExpr }}
        </p>

        <div class="menu-help-kconfig-title">
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

    <div 
      v-if="props.renderChildren !== false && props.config.type !== 'choice' && props.config.type === 'menu' && !isCollapsed" 
      :class="{ 'config-children': props.config.shouldIndentChildren, 'menu-children': true }"
    >
      <ConfigElement
        v-for="child in props.config.children"
        :key="child.id"
        :config="child"
      />
    </div>
    
    <div 
      v-if="props.renderChildren !== false && props.config.type !== 'choice' && props.config.type !== 'menu' && (!props.config.isMenuconfig || (props.config.isMenuconfig && !isCollapsed))" 
      :class="{ 'config-children': props.config.shouldIndentChildren }"
    >
      <ConfigElement
        v-for="child in props.config.children"
        :key="child.id"
        :config="child"
      />
    </div>
  </div>
</template>

<style scoped>
.form-group {
  padding-left: 30px;
  overflow: hidden;
  margin-top: 9px;
  margin-bottom: 9px;
}
.config-el {
  /* 配置元素的基础样式 - 去掉额外的间距 */
  border-radius: 3px;
  transition: background-color 0.1s ease;
  position: relative;
}
.config-el:hover {
  background-color: var(--vscode-notifications-background);
}
.submenu {
  /* 子菜单的样式 - 与其他配置项保持一致，去掉内置padding让缩进统一 */
  overflow: hidden;
  padding: 0;
  margin: 9px 0;
  border-radius: 6px;
}


.menu-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.collapse-slot {
  width: 27px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.collapse-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--vscode-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 3px;
  transition: background-color 0.2s;
  box-sizing: border-box;
}

.collapse-button:hover {
  background-color: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
}

.collapse-button:active {
  background-color: var(--vscode-toolbar-activeBackground);
}

.collapse-icon {
  transition: transform 0.2s ease;
  color: var(--vscode-icon-foreground);
  opacity: 0.8;
  display: inline-block;
}

.collapse-icon:hover {
  opacity: 1;
}

/* 展开状态的箭头 - 向下旋转90度 */
.collapse-icon.rotated {
  transform: rotate(90deg);
}

.menuconfig {
  padding-left: 0px;
  display: inline-block;
  margin-left: 15px;
  vertical-align: middle;
}
.menu-title {
  font-family: var(--vscode-font-family, "Segoe WPC", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif);
  font-weight: 600;
  font-size: 14px;
  color: var(--vscode-settings-headerForeground, #888888);
  margin: 0;
  display: inline-block;
}

/* 为嵌套的子元素添加统一的递进缩进 - 确保所有层级缩进一致 */
.config-children {
  padding-left: 28px;
}

/* Menu 的子项容器样式 - 使用与 config-children 相同的缩进 */
.menu-children {
  padding-left: 28px;
  border-left: 2px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.2));
  margin-left: 10px;
}

/* 调整嵌套菜单标题大小 */
.config-children .menu-title {
  font-size: 13px;
}

.config-children .config-children .menu-title {
  font-size: 13px;
}

/* Menu help icon */
.menu-help-icon {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 8px;
  color: var(--vscode-foreground);
}

.menu-help-icon:hover {
  color: var(--vscode-textLink-activeForeground);
}

/* Menu help section */
.menu-help-section {
  margin-top: 8px;
  margin-left: 39px;
  padding: 12px 16px;
  background-color: var(--vscode-editorWidget-background, rgba(37, 37, 38, 0.6));
  border-left: 4px solid var(--vscode-textLink-foreground, #4db6ac);
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* 浅色主题的帮助信息背景 */
:global(.vscode-light) .menu-help-section {
  background-color: rgba(245, 245, 245, 0.8);
  border-left-color: var(--vscode-textLink-foreground, #0066b8);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 深色主题的帮助信息背景 */
:global(.vscode-dark) .menu-help-section {
  background-color: rgba(45, 45, 48, 0.6);
  border-left-color: var(--vscode-textLink-foreground, #4db6ac);
}

.menu-help-kconfig-title {
  padding: 0 18px;
  margin-left: 10px;
  margin-bottom: 6px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 1.5;
}

.menu-help-content {
  margin-left: 0;
  padding-left: 16px;
  margin-top: 4px;
}

</style>
