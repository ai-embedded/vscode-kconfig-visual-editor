/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *    http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Frontend i18n support for Vue components
// This is separate from the backend i18n to avoid dependency on vscode module

export enum Language {
    ZH_CN = 'zh-cn',  // eslint-disable-line no-unused-vars
    EN_US = 'en-us'   // eslint-disable-line no-unused-vars
}

export interface FrontendI18nKeys {
    // Common buttons
    'common.confirm': string;
    'common.cancel': string;

    // Reset dialog
    'reset.confirmTitle': string;
    'reset.confirmMessage': string;

    // Discard dialog
    'discard.confirmTitle': string;
    'discard.confirmMessage': string;

    // Toolbar
    'toolbar.expandAll': string;
    'toolbar.collapseAll': string;
    'toolbar.closeAllHelp': string;

    // Menu
    'menu.expand': string;
    'menu.collapse': string;

    // Config
    'config.readonlyDefault': string;
}

// Chinese texts
const zhCN: FrontendI18nKeys = {
    'common.confirm': '确定',
    'common.cancel': '取消',

    'reset.confirmTitle': '确认重置配置',
    'reset.confirmMessage': '您确定要将所有配置重置为 Kconfig 默认值吗？这将删除当前的 .config 文件并恢复所有配置项到默认状态。此操作无法撤销。',

    'discard.confirmTitle': '确认丢弃更改',
    'discard.confirmMessage': '您确定要丢弃所有未保存的更改吗？此操作无法撤销。',

    'toolbar.expandAll': '展开所有菜单',
    'toolbar.collapseAll': '折叠所有菜单',
    'toolbar.closeAllHelp': '关闭所有帮助信息',

    'menu.expand': '展开',
    'menu.collapse': '折叠',

    'config.readonlyDefault': '此选项已被自动选择',
};

// English texts
const enUS: FrontendI18nKeys = {
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',

    'reset.confirmTitle': 'Confirm Reset Configuration',
    'reset.confirmMessage': 'Are you sure you want to reset all configurations to Kconfig default values? This will delete the current .config file and restore all configuration items to their default state. This action cannot be undone.',

    'discard.confirmTitle': 'Confirm Discard Changes',
    'discard.confirmMessage': 'Are you sure you want to discard all unsaved changes? This action cannot be undone.',

    'toolbar.expandAll': 'Expand All Menus',
    'toolbar.collapseAll': 'Collapse All Menus',
    'toolbar.closeAllHelp': 'Close All Help',

    'menu.expand': 'Expand',
    'menu.collapse': 'Collapse',

    'config.readonlyDefault': 'This option has been automatically selected',
};

// Language packs mapping
const languagePacks: Record<Language, FrontendI18nKeys> = {
    [Language.ZH_CN]: zhCN,
    [Language.EN_US]: enUS
};

// Get current language from browser or use default
export function getCurrentLanguage(): Language {
    // Try to get language from navigator
    const browserLanguage = navigator.language.toLowerCase();
    if (browserLanguage.startsWith('zh')) {
        return Language.ZH_CN;
    }
    return Language.EN_US;
}

// Get text by key
export function t(key: keyof FrontendI18nKeys): string {
    const currentLanguage = getCurrentLanguage();
    const languagePack = languagePacks[currentLanguage];
    return languagePack[key] || key;
}

// Export default translation function
export default t;