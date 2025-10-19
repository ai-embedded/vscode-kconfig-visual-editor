/*
 * 前端调试工具
 * 提供与后端 Logger 类似的调试功能，但在前端运行
 */

interface DebugConfig {
    enabled: boolean;
    menu: boolean;
}

class FrontendDebugger {
    private static config: DebugConfig = {
        enabled: false,
        menu: false
    };

    /**
     * 初始化调试配置（从后端接收）
     */
    static initConfig(config: DebugConfig) {
        this.config = config;
    }

    /**
     * 菜单渲染调试日志
     */
    static debugMenu(message: string): void {
        if (!this.config.enabled || !this.config.menu) {
            return;
        }

        const timestamp = new Date().toISOString();
        const _logMessage = `[${timestamp}] [DEBUG:MENU] ${message}`;
        //console.debug(logMessage);
    }

    /**
     * 通用调试日志
     */
    static debug(message: string): void {
        if (!this.config.enabled) {
            return;
        }

        const timestamp = new Date().toISOString();
        const _logMessage = `[${timestamp}] [DEBUG] ${message}`;
        //console.debug(logMessage);
    }
}

export default FrontendDebugger;