// Copyright 2025 Kconfig VSCode Extension Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Try to import vscode, but make it optional for testing
let vscode: any;
try {
    vscode = require("vscode");
} catch (e) {
    // Running outside of VSCode environment (e.g., in tests)
    vscode = null;
}

export class Logger {
    private static resolveMessage(message: string | (() => string)): string {
        if (typeof message === "function") {
            try {
                return message();
            } catch (error) {
                return `[LOGGER_MESSAGE_FACTORY_ERROR] ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        return message;
    }

    private static outputChannel: any | null = null;
    private static readonly CONFIG_CACHE_TTL_MS = 1000;
    private static logConfigCache: { value: any; timestamp: number } | null = null;
    private static debugConfigCache: { value: any; timestamp: number } | null = null;
    
    private static getOutputChannel(): any {
        if (!Logger.outputChannel && vscode) {
            Logger.outputChannel = vscode.window.createOutputChannel("Kconfig");
        }
        return Logger.outputChannel;
    }
    
    /**
     * 获取日志配置
     */
    private static getLogConfig(): any {
        const now = Date.now();
        if (Logger.logConfigCache && (now - Logger.logConfigCache.timestamp) < Logger.CONFIG_CACHE_TTL_MS) {
            return Logger.logConfigCache.value;
        }

        let configValue: any;
        if (!vscode) {
            configValue = {
                enabled: false,
                levels: {
                    info: false,
                    warn: false,
                    error: false,
                    debug: false
                }
            };
        } else {
            const logConfig = vscode.workspace.getConfiguration('kconfig.log');
            configValue = {
                enabled: logConfig.get('enabled', false),
                levels: {
                    info: logConfig.get('level.info', false),
                    warn: logConfig.get('level.warn', false),
                    error: logConfig.get('level.error', false),
                    debug: logConfig.get('level.debug', false)
                }
            };
        }

        Logger.logConfigCache = { value: configValue, timestamp: now };
        return configValue;
    }
    
    /**
     * 获取调试配置
     */
    private static getDebugConfig(): any {
        const now = Date.now();
        if (Logger.debugConfigCache && (now - Logger.debugConfigCache.timestamp) < Logger.CONFIG_CACHE_TTL_MS) {
            return Logger.debugConfigCache.value;
        }

        let configValue: any;
        if (!vscode) {
            configValue = {
                enabled: false,
                parser: false,
                visibility: false,
                menu: false,
                select: false,
                source: false
            };
        } else {
            const config = vscode.workspace.getConfiguration('kconfig.debug');
            configValue = {
                enabled: config.get('enabled', false),
                parser: config.get('parser', false),
                visibility: config.get('visibility', false),
                menu: config.get('menu', false),
                select: config.get('select', false),
                source: config.get('source', false)
            };
        }

        Logger.debugConfigCache = { value: configValue, timestamp: now };
        return configValue;
    }
    
    /**
     * 通用调试日志方法
     */
    private static debugLog(category: string, message: string | (() => string), categoryEnabled: boolean): void {
        const debugConfig = Logger.getDebugConfig();
        
        // 总开关未开启时直接返回
        if (!debugConfig.enabled) {
            return;
        }
        
        // 分类开关未开启时直接返回
        if (!categoryEnabled) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const resolvedMessage = Logger.resolveMessage(message);
        const logMessage = `[${timestamp}] [DEBUG:${category}] ${resolvedMessage}`;
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(logMessage);
        }
        // console.debug(logMessage);
    }
    
    public static info(message: string | (() => string)): void {
        const logConfig = Logger.getLogConfig();
        if (!logConfig.enabled || !logConfig.levels.info) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const resolvedMessage = Logger.resolveMessage(message);
        const logMessage = `[${timestamp}] [INFO] ${resolvedMessage}`;
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(logMessage);
        }
////console.log(logMessage);
    }
    
    public static warn(message: string | (() => string)): void {
        const logConfig = Logger.getLogConfig();
        if (!logConfig.enabled || !logConfig.levels.warn) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const resolvedMessage = Logger.resolveMessage(message);
        const logMessage = `[${timestamp}] [WARN] ${resolvedMessage}`;
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(logMessage);
        }
        // console.warn(logMessage);
    }
    
    public static error(message: string, error?: Error, context?: string): void {
        // Error logs are treated as important and are always emitted.
        const timestamp = new Date().toISOString();
        let errorMessage = `[${timestamp}] [ERROR] ${message}`;
        
        if (context) {
            errorMessage += ` (Context: ${context})`;
        }
        
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(errorMessage);
        }
        // console.error(errorMessage);
        
        if (error) {
            const stackTrace = `[${timestamp}] [ERROR] Stack trace: ${error.stack || error.message}`;
            if (channel) {
                channel.appendLine(stackTrace);
            }
            // console.error(stackTrace);
        }
    }
    
    public static debug(message: string | (() => string)): void {
        const logConfig = Logger.getLogConfig();
        if (!logConfig.enabled || !logConfig.levels.debug) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const resolvedMessage = Logger.resolveMessage(message);
        const logMessage = `[${timestamp}] [DEBUG] ${resolvedMessage}`;
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(logMessage);
        }
        // console.debug(logMessage);
    }
    
    /**
     * 解析器调试日志 (CONFIG_PARSER, IF_PARSER)
     */
    public static debugParser(message: string | (() => string)): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('PARSER', message, debugConfig.parser);
    }
    
    /**
     * 可见性调试日志 (VISIBILITY_DEBUG)
     */
    public static debugVisibility(message: string | (() => string)): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('VISIBILITY', message, debugConfig.visibility);
    }
    
    /**
     * 菜单渲染调试日志 (MENU_RENDER_DEBUG, INDENT_DEBUG)
     */
    public static debugMenu(message: string | (() => string)): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('MENU', message, debugConfig.menu);
    }
    
    /**
     * select语句调试日志 (SELECT_INIT)
     */
    public static debugSelect(message: string | (() => string)): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('SELECT', message, debugConfig.select);
    }
    
    /**
     * 源文件处理调试日志 (SOURCE_DEBUG)
     */
    public static debugSource(message: string | (() => string)): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('SOURCE', message, debugConfig.source);
    }

    /**
     * 配置写入调试日志 (WRITER_DEBUG)
     */
    public static debugWriter(message: string | (() => string)): void {
        const debugConfig = Logger.getDebugConfig();
        // For now, use the debug config enabled flag
        // In the future, we could add a separate writer debug flag
        Logger.debugLog('WRITER', message, debugConfig.enabled);
    }

    public static show(): void {
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.show();
        }
    }
    
    public static dispose(): void {
        if (Logger.outputChannel) {
            Logger.outputChannel.dispose();
            Logger.outputChannel = null;
        }
        Logger.logConfigCache = null;
        Logger.debugConfigCache = null;
    }
}
