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
    private static outputChannel: any | null = null;
    
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
        if (!vscode) {
            return {
                enabled: true,
                levels: {
                    info: true,
                    warn: true,
                    error: true,
                    debug: false
                }
            };
        }
        
        const logConfig = vscode.workspace.getConfiguration('kconfig.log');
        return {
            enabled: logConfig.get('enabled', false),
            levels: {
                info: logConfig.get('level.info', true),
                warn: logConfig.get('level.warn', true),
                error: logConfig.get('level.error', true),
                debug: logConfig.get('level.debug', false)
            }
        };
    }
    
    /**
     * 获取调试配置
     */
    private static getDebugConfig(): any {
        if (!vscode) {
            return {
                enabled: false,
                parser: false,
                visibility: false,
                menu: false,
                select: false,
                source: false
            };
        }
        
        const config = vscode.workspace.getConfiguration('kconfig.debug');
        return {
            enabled: config.get('enabled', false),
            parser: config.get('parser', false),
            visibility: config.get('visibility', false),
            menu: config.get('menu', false),
            select: config.get('select', false),
            source: config.get('source', false)
        };
    }
    
    /**
     * 通用调试日志方法
     */
    private static debugLog(category: string, message: string, categoryEnabled: boolean): void {
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
        const logMessage = `[${timestamp}] [DEBUG:${category}] ${message}`;
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(logMessage);
        }
        // console.debug(logMessage);
    }
    
    public static info(message: string): void {
        const logConfig = Logger.getLogConfig();
        if (!logConfig.enabled || !logConfig.levels.info) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [INFO] ${message}`;
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(logMessage);
        }
////console.log(logMessage);
    }
    
    public static warn(message: string): void {
        const logConfig = Logger.getLogConfig();
        if (!logConfig.enabled || !logConfig.levels.warn) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [WARN] ${message}`;
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(logMessage);
        }
        // console.warn(logMessage);
    }
    
    public static error(message: string, error?: Error, context?: string): void {
        const logConfig = Logger.getLogConfig();
        if (!logConfig.enabled || !logConfig.levels.error) {
            return;
        }
        
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
    
    public static debug(message: string): void {
        const logConfig = Logger.getLogConfig();
        if (!logConfig.enabled || !logConfig.levels.debug) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [DEBUG] ${message}`;
        const channel = Logger.getOutputChannel();
        if (channel) {
            channel.appendLine(logMessage);
        }
        // console.debug(logMessage);
    }
    
    /**
     * 解析器调试日志 (CONFIG_PARSER, IF_PARSER)
     */
    public static debugParser(message: string): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('PARSER', message, debugConfig.parser);
    }
    
    /**
     * 可见性调试日志 (VISIBILITY_DEBUG)
     */
    public static debugVisibility(message: string): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('VISIBILITY', message, debugConfig.visibility);
    }
    
    /**
     * 菜单渲染调试日志 (MENU_RENDER_DEBUG, INDENT_DEBUG)
     */
    public static debugMenu(message: string): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('MENU', message, debugConfig.menu);
    }
    
    /**
     * select语句调试日志 (SELECT_INIT)
     */
    public static debugSelect(message: string): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('SELECT', message, debugConfig.select);
    }
    
    /**
     * 源文件处理调试日志 (SOURCE_DEBUG)
     */
    public static debugSource(message: string): void {
        const debugConfig = Logger.getDebugConfig();
        Logger.debugLog('SOURCE', message, debugConfig.source);
    }

    /**
     * 配置写入调试日志 (WRITER_DEBUG)
     */
    public static debugWriter(message: string): void {
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
    }
}