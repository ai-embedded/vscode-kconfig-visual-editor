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

import * as vscode from 'vscode';
// import { Logger } from '../logger/logger';

export class FileWatcher {
    private static instance: FileWatcher | undefined;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private context: vscode.ExtensionContext;
    private ignoreNextChangeTimestamp: number = 0;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        FileWatcher.instance = this;
    }

    public static getInstance(): FileWatcher | undefined {
        return FileWatcher.instance;
    }

    /**
     * 忽略接下来一段时间内的文件变化通知（用于内部保存）
     * @param durationMs 忽略时长（毫秒），默认 1000ms
     */
    public ignoreNextChange(durationMs: number = 1000): void {
        this.ignoreNextChangeTimestamp = Date.now() + durationMs;
    }

    public initialize() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Watch for kconfig and defconfig file changes
        const configPattern = new vscode.RelativePattern(workspaceFolder, '**/{sdkconfig,defconfig,.config}');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(configPattern);

        // Handle file creation
        this.fileWatcher.onDidCreate((uri) => {
            // Logger.info(`Configuration file created: ${uri.fsPath}`);

            // 检查是否应该忽略这次创建（内部保存操作触发的）
            if (Date.now() < this.ignoreNextChangeTimestamp) {
                // Logger.info(`Ignoring file creation notification for internal save: ${uri.fsPath}`);
                return;
            }

            this.handleConfigFileChange(uri);
        });

        // Handle file changes
        this.fileWatcher.onDidChange((uri) => {
            // Logger.info(`Configuration file changed: ${uri.fsPath}`);
            this.handleConfigFileChange(uri);
        });

        // Handle file deletion
        this.fileWatcher.onDidDelete((_uri) => {
            // Logger.info(`Configuration file deleted: ${_uri.fsPath}`);

            // 检查是否应该忽略这次删除（内部 reset 操作触发的）
            if (Date.now() < this.ignoreNextChangeTimestamp) {
                // Logger.info(`Ignoring file deletion notification for internal reset: ${_uri.fsPath}`);
                return;
            }

            vscode.window.showWarningMessage('Configuration file has been deleted.');
        });

        this.context.subscriptions.push(this.fileWatcher);
    }

    private handleConfigFileChange(_uri: vscode.Uri) {
        // 检查是否应该忽略这次变化（内部保存触发的）
        if (Date.now() < this.ignoreNextChangeTimestamp) {
            // Logger.info(`Ignoring file change notification for internal save: ${_uri.fsPath}`);
            return;
        }

        // 只有外部修改时才通知
        const fileName = _uri.fsPath.split('/').pop() || 'Unknown';
        vscode.window.showInformationMessage(
            `Configuration file ${fileName} has been modified externally.`
        );
    }

    public dispose() {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}