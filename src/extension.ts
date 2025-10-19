/*
 * Kconfig-editor for VSCode
 * 
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
import { KconfigLangClient } from './kconfig/index';
import { MenuconfigPanel } from './menuconfig/MenuconfigPanel';
import { KconfigMenuLoader } from './menuconfig/KconfigMenuLoader';
import { KconfigServer } from './menuconfig/KconfigServer';
import { FileWatcher } from './menuconfig/fileWatcher';
import { Logger } from './logger/logger';

export function activate(context: vscode.ExtensionContext) {
    Logger.info('Kconfig-editor extension is now active');

    // Start the Kconfig language server
    KconfigLangClient.startKconfigLangServer(context);

    // Register commands
    const helloWorldCommand = vscode.commands.registerCommand('kconfig.helloWorld', () => {
        vscode.window.showInformationMessage('Hello from Kconfig-editor!');
    });

    const menuconfigCommand = vscode.commands.registerCommand('kconfig.menuconfig.start', async (uri?: vscode.Uri) => {
        // If called from context menu, uri will be the selected file
        // If called from command palette, uri will be undefined
        let targetFile: vscode.Uri | undefined = uri;
        let workspaceFolder: vscode.WorkspaceFolder | undefined;

        if (targetFile) {
            // Command was called from context menu with a specific file
            workspaceFolder = vscode.workspace.getWorkspaceFolder(targetFile);
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('The selected file is not in a workspace folder.');
                return;
            }
        } else {
            // Command was called from command palette, use active editor or workspace
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                targetFile = activeEditor.document.uri;
                workspaceFolder = vscode.workspace.getWorkspaceFolder(targetFile);
            } else {
                workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            }
            
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Please open a workspace folder first.');
                return;
            }
        }

        try {
            const menuLoader = new KconfigMenuLoader(workspaceFolder.uri, targetFile);
            const initialMenus = await menuLoader.loadKconfigMenus();
            
            MenuconfigPanel.createOrShow(
                context.extensionUri,
                workspaceFolder.uri,
                initialMenus,
                targetFile
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open Kconfig visual editor: ${error.message}`);
        }
    });


    // Command for saving default configuration
    const saveDefconfigCommand = vscode.commands.registerCommand('kconfig.saveDefconfig', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Please open a workspace folder first.');
            return;
        }

        // Use built-in implementation
        const kconfigServer = KconfigServer.getInstance();
        if (!kconfigServer) {
            vscode.window.showErrorMessage('Please open the Kconfig visual editor first.');
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${workspaceFolder.uri.fsPath}/defconfig`),
            filters: {
                'Defconfig files': ['defconfig'],
                'All files': ['*']
            }
        });

        if (uri) {
            try {
                await kconfigServer.saveDefconfig(uri.fsPath);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to save defconfig: ${error.message}`);
            }
        }
    });

    context.subscriptions.push(helloWorldCommand);
    context.subscriptions.push(menuconfigCommand);
    context.subscriptions.push(saveDefconfigCommand);

    // Initialize file watcher for sdkconfig files
    const fileWatcher = new FileWatcher(context);
    fileWatcher.initialize();

    // Register for configuration changes
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kconfig')) {
            vscode.window.showInformationMessage('Kconfig configuration changed. Please reload the window for changes to take effect.');
        }
    });

    context.subscriptions.push(configChangeListener);
}

export function deactivate(): Thenable<void> | undefined {
    Logger.info('Kconfig-editor extension is now deactivated');
    
    // Stop the language server
    KconfigLangClient.stopKconfigLangServer();
    
    return undefined;
}
