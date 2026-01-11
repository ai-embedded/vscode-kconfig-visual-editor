import * as path from "path";
import * as vscode from "vscode";

import { Logger } from "../logger/logger";
import { formatPkgsDirForConfig, type RtThreadPkgsDirSource } from "./pkgsDir";
import { findRtThreadRoot, pickAutoPkgsDir, resolvePath } from "./pkgsDirResolver";

export interface RtThreadEnvironmentInfo {
    pkgsDir?: string;
    source: RtThreadPkgsDirSource;
    root?: string;
}

export function ensureRtThreadEnvironment(workspace: vscode.Uri): RtThreadEnvironmentInfo {
    const workspacePath = path.resolve(workspace.fsPath);
    const configuration = vscode.workspace.getConfiguration("kconfig", workspace);
    const configuredPkgsDir = (configuration.get<string>("rtThread.pkgsDir") || "").trim();

    const rtThreadRoot = findRtThreadRoot(workspacePath);

    if (configuredPkgsDir) {
        const resolved = resolvePath(configuredPkgsDir, workspacePath);
        if (resolved) {
            setPkgsDir(resolved, "configuration");
            return { pkgsDir: resolved, source: "configuration", root: rtThreadRoot };
        }
    }

    const envResolved = pickAutoPkgsDir(workspacePath, rtThreadRoot);
    if (envResolved) {
        const { path: resolved, source } = envResolved;
        setPkgsDir(resolved, source);
        persistWorkspaceValue(configuration, resolved, source);
        return { pkgsDir: resolved, source, root: rtThreadRoot };
    }

    if (rtThreadRoot) {
        Logger.warn("未能检测到 RT-Thread PKGS_DIR，相关包将无法加载。");
    }
    return { pkgsDir: undefined, source: "none", root: rtThreadRoot };
}


function setPkgsDir(value: string, source: RtThreadPkgsDirSource): void {
    if (process.env.PKGS_DIR === value) {
        return;
    }
    process.env.PKGS_DIR = value;
    Logger.info(`已设置 PKGS_DIR=${value} (来源: ${source})`);
}

function persistWorkspaceValue(
    configuration: vscode.WorkspaceConfiguration,
    value: string,
    source: RtThreadPkgsDirSource
): void {
    const displayValue = formatPkgsDirForConfig(value, source);
    const inspected = configuration.inspect<string>("rtThread.pkgsDir");
    const hasUserValue = Boolean(
        inspected?.workspaceValue ??
        inspected?.workspaceFolderValue ??
        inspected?.globalValue
    );

    if (!hasUserValue && inspected?.defaultValue !== displayValue) {
        configuration
            .update("rtThread.pkgsDir", displayValue, vscode.ConfigurationTarget.Workspace)
            .then(undefined, (error: unknown) => {
                Logger.warn(`更新工作区 PKGS_DIR 配置失败: ${String(error)}`);
            });
    }
}
