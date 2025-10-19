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

// i18n 国际化支持
import * as vscode from 'vscode';

// 支持的语言
export enum Language {
    ZH_CN = 'zh-cn',  // eslint-disable-line no-unused-vars
    EN_US = 'en-us'   // eslint-disable-line no-unused-vars
}

// 文本键定义
export interface I18nKeys {
    // 通用按钮文本
    'common.confirm': string;
    'common.cancel': string;
    
    // Reset 相关
    'reset.confirmTitle': string;
    'reset.confirmMessage': string;
    'reset.confirmButton': string;
    'reset.cancelButton': string;
    'reset.progress.title': string;
    'reset.progress.clearing': string;
    'reset.progress.loading': string;
    'reset.progress.complete': string;
    'reset.success': string;
    'reset.failed': string;
    
    // Discard 相关
    'discard.confirmTitle': string;
    'discard.confirmMessage': string;
    'discard.success': string;
    'discard.failed': string;
    
    // Save 相关
    'save.success': string;
    'save.failed': string;
    
    // Close 相关
    'close.unsavedTitle': string;
    'close.unsavedMessage': string;
    'close.saveButton': string;
    'close.noSaveButton': string;
    'close.saveSuccess': string;
    'close.saveFailed': string;
}

// 中文文本
const zhCN: I18nKeys = {
    'common.confirm': '确定',
    'common.cancel': '取消',
    
    'reset.confirmTitle': '确认重置配置',
    'reset.confirmMessage': '您确定要将所有配置重置为 Kconfig 默认值吗？这将删除当前的 .config 文件并恢复所有配置项到默认状态。此操作无法撤销。',
    'reset.confirmButton': '确认重置',
    'reset.cancelButton': '取消',
    'reset.progress.title': '正在重置配置',
    'reset.progress.clearing': '删除配置文件并恢复默认值',
    'reset.progress.loading': '重新加载配置',
    'reset.progress.complete': '重置完成',
    'reset.success': '配置已成功重置为默认值',
    'reset.failed': '重置失败',
    
    'discard.confirmTitle': '确认丢弃更改',
    'discard.confirmMessage': '您确定要丢弃所有未保存的更改吗？此操作无法撤销。',
    'discard.success': '已成功丢弃所有未保存的更改',
    'discard.failed': '丢弃更改失败',
    
    'save.success': '配置已成功保存',
    'save.failed': '保存配置失败',
    
    'close.unsavedTitle': '未保存的更改',
    'close.unsavedMessage': '配置编辑器中有未保存的更改，是否要在关闭前保存？',
    'close.saveButton': '是',
    'close.noSaveButton': '否',
    'close.saveSuccess': '配置已保存',
    'close.saveFailed': '保存失败，将继续关闭'
};

// 英文文本
const enUS: I18nKeys = {
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    
    'reset.confirmTitle': 'Confirm Reset Configuration',
    'reset.confirmMessage': 'Are you sure you want to reset all configurations to Kconfig default values? This will delete the current .config file and restore all configuration items to their default state. This action cannot be undone.',
    'reset.confirmButton': 'Confirm Reset',
    'reset.cancelButton': 'Cancel',
    'reset.progress.title': 'Resetting Configuration',
    'reset.progress.clearing': 'Deleting configuration file and restoring defaults',
    'reset.progress.loading': 'Reloading configuration',
    'reset.progress.complete': 'Reset Complete',
    'reset.success': 'Configuration successfully reset to default values',
    'reset.failed': 'Reset Failed',
    
    'discard.confirmTitle': 'Confirm Discard Changes',
    'discard.confirmMessage': 'Are you sure you want to discard all unsaved changes? This action cannot be undone.',
    'discard.success': 'Successfully discarded all unsaved changes',
    'discard.failed': 'Failed to discard changes',
    
    'save.success': 'Configuration saved successfully',
    'save.failed': 'Failed to save configuration',
    
    'close.unsavedTitle': 'Unsaved Changes',
    'close.unsavedMessage': 'There are unsaved changes in the configuration editor. Do you want to save before closing?',
    'close.saveButton': 'Yes',
    'close.noSaveButton': 'No',
    'close.saveSuccess': 'Configuration saved',
    'close.saveFailed': 'Save failed, will continue closing'
};

// 语言包映射
const languagePacks: Record<Language, I18nKeys> = {
    [Language.ZH_CN]: zhCN,
    [Language.EN_US]: enUS
};

// 获取当前语言
export function getCurrentLanguage(): Language {
    const locale = vscode.env.language.toLowerCase();
    if (locale.startsWith('zh')) {
        return Language.ZH_CN;
    }
    return Language.EN_US;
}

// 获取文本
export function t(key: keyof I18nKeys): string {
    const currentLanguage = getCurrentLanguage();
    const languagePack = languagePacks[currentLanguage];
    return languagePack[key] || key;
}

// 导出默认翻译函数
export default t;