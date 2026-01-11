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

import * as path from "path";
import * as vscode from "vscode";
import { Menu, menuType } from "./Menu";
import { KconfigMenuLoader } from "./KconfigMenuLoader";
import { KconfigServer } from "./KconfigServer";
import { Logger } from "../logger/logger";
import { t } from "../i18n";

type WebviewColorTheme = "light" | "dark";

export class MenuconfigPanel {
  public static currentPanel: MenuconfigPanel | undefined;
  private _disposed = false;
  private static readonly supportedThemes = ["default", "modern"] as const;

  public static createOrShow(
    extensionUri: vscode.Uri,
    curWorkspaceFolder: vscode.Uri,
    initialValues: Menu[],
    targetFile?: vscode.Uri
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    
    // 检查现有面板是否仍然有效
    if (MenuconfigPanel.currentPanel && !MenuconfigPanel.currentPanel.isDisposed()) {
      try {
        MenuconfigPanel.currentPanel.panel.reveal(column);
        return;
      } catch (error) {
        // 如果reveal失败，说明面板已经无效，需要清理引用
        Logger.error('Failed to reveal existing panel, creating new one', error as Error);
        MenuconfigPanel.currentPanel = undefined;
      }
    }
    
    // 创建新面板
    MenuconfigPanel.currentPanel = new MenuconfigPanel(
      extensionUri,
      column || vscode.ViewColumn.One,
      curWorkspaceFolder,
      initialValues,
      targetFile
    );
  }

  public isDisposed(): boolean {
    return this._disposed;
  }

  private static readonly viewType = "kconfig-menuconfig";
  private readonly curWorkspaceFolder: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private menuLoader: KconfigMenuLoader;
  private kconfigServer: KconfigServer | null = null;
  private targetFile?: vscode.Uri;

  private constructor(
    extensionUri: vscode.Uri,
    column: vscode.ViewColumn,
    curWorkspaceFolder: vscode.Uri,
    initialValues: Menu[],
    targetFile?: vscode.Uri
  ) {
    this.curWorkspaceFolder = curWorkspaceFolder;
    this.targetFile = targetFile;
    this.menuLoader = new KconfigMenuLoader(curWorkspaceFolder, targetFile);

    const menuconfigPanelTitle = targetFile 
      ? `Kconfig Visual Editor - ${path.basename(targetFile.fsPath)}`
      : "Kconfig Visual Editor";
    this.panel = vscode.window.createWebviewPanel(
      MenuconfigPanel.viewType,
      menuconfigPanelTitle,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist"),
          vscode.Uri.joinPath(extensionUri, "dist", "views"),
          vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode", "codicons", "dist"),
        ],
      }
    );

    const scriptPath = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "views", "webview-bundle.js")
    );
    const themeKey = this.resolveUiTheme();
    const colorThemeKind = this.mapColorThemeKind(vscode.window.activeColorTheme.kind);
    this.panel.webview.html = this.createMenuconfigHtml(scriptPath, themeKey, colorThemeKind);
    this.registerColorThemeSync();

    const menuconfigViewDict = {
      save: "Save",
      discard: "Discard",
      reset: "Reset",
    };
    this.panel.webview.postMessage({
      command: "load_dictionary",
      text_dictionary: menuconfigViewDict,
    });

    this.panel.onDidDispose(
      async () => {
        // 标记为已disposed
        this._disposed = true;
        
        // Check for unsaved changes before closing
        if (this.kconfigServer && this.kconfigServer.hasUnsavedChanges()) {
          const yesButton: vscode.MessageItem = {
            title: t('close.saveButton'),
            isCloseAffordance: false
          };
          const noButton: vscode.MessageItem = {
            title: t('close.noSaveButton'),
            isCloseAffordance: true  // 这将替代默认的Cancel按钮
          };
          
          const result = await vscode.window.showWarningMessage(
            t('close.unsavedMessage'),
            { modal: true },
            yesButton,
            noButton
          );
          
          if (result === yesButton) {
            try {
              await this.kconfigServer.saveConfig();
              // 使用状态栏消息，3秒后自动关闭
              vscode.window.setStatusBarMessage(`$(check) ${t('close.saveSuccess')}`, 3000);
            } catch (error) {
              vscode.window.showErrorMessage(t('close.saveFailed'));
            }
          }
          // No 按钮或关闭对话框时直接继续关闭流程
        }
        this.dispose();
      },
      null,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "updateValue": {
          // Handle value update
          const updatedMenu = JSON.parse(message.updated_value) as Menu;
          // Logger.info(`[PANEL] Received updateValue message: ${message.updated_value}`);
          // Logger.info(`[PANEL] Parsed menu: id=${updatedMenu.id}, name=${updatedMenu.name}, type=${updatedMenu.type}, value=${updatedMenu.value}`);
          
          if (this.kconfigServer) {
            this.kconfigServer.updateValue(updatedMenu);
            // Logger.info(`[PANEL] Sent visibility_updated with ${updatedMenus.length} menus after updateValue`);
          } else {
            Logger.error(`[PANEL] KconfigServer not available for updateValue`);
          }
          break;
        }
        case "saveChanges":
          // Logger.info(`[PANEL] Received saveChanges message`);
          if (this.kconfigServer) {
            try {
              await this.kconfigServer.saveConfig();
              // 使用状态栏消息，3秒后自动关闭
              vscode.window.setStatusBarMessage(`$(check) ${t('save.success')}`, 3000);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              vscode.window.showErrorMessage(`${t('save.failed')}: ${errorMessage}`);
              Logger.error("Save configuration failed", error as Error);
            }
          } else {
            // Logger.warn(`[PANEL] KconfigServer not available for saveChanges`);
            vscode.window.setStatusBarMessage("$(check) Configuration saved!", 3000);
          }
          break;
        case "discardChanges":
          // Logger.info(`[PANEL] Received discardChanges message`);
          if (this.kconfigServer) {
            try {
              await this.kconfigServer.discardChanges();
              // 使用状态栏消息，3秒后自动关闭
              vscode.window.setStatusBarMessage(`$(discard) ${t('discard.success')}`, 3000);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              vscode.window.showErrorMessage(`${t('discard.failed')}: ${errorMessage}`);
              Logger.error("Discard changes failed", error as Error);
            }
          } else {
            // Logger.warn(`[PANEL] KconfigServer not available for discardChanges`);
            vscode.window.setStatusBarMessage("$(discard) Changes discarded!", 3000);
          }
          break;
        case "requestInitValues": {
          //console.log("[PANEL] requestInitValues received");
          // Load initial values from Kconfig files
          const loadedMenus = this.kconfigServer ? this.kconfigServer.getMenus() : await this.menuLoader.loadKconfigMenus();
          //console.log(`[PANEL] Loaded ${loadedMenus.length} menus`);
          if (loadedMenus.length > 0) {
            //console.log(`[PANEL] First menu: name=${loadedMenus[0].name}, title=${loadedMenus[0].title}, children=${loadedMenus[0].children?.length || 0}`);
            if (loadedMenus[0].children && loadedMenus[0].children.length > 0) {
              //console.log(`[PANEL] First child: name=${loadedMenus[0].children[0].name}, title=${loadedMenus[0].children[0].title}`);
            }
          }
          
          // Set default collapsed state for all menus
          const setDefaultCollapsedState = (menus: Menu[]) => {
            menus.forEach(menu => {
              if (menu.type === menuType.menu) {
                menu.isCollapsed = true; // Default to collapsed
              }
              if (menu.children && menu.children.length > 0) {
                setDefaultCollapsedState(menu.children);
              }
            });
          };
          setDefaultCollapsedState(loadedMenus);
          
          // Log menus before sending
          const logMenus = (menus: Menu[], depth = 0) => {
            const _indent = "  ".repeat(depth);
            menus.forEach(menu => {
              if (menu.type !== menuType.menu) {
                // Logger.info(`${indent}[MENUCONFIG_PANEL] Config: ${menu.name}, type: ${menu.type}, value: ${menu.value}, isVisible: ${menu.isVisible}`);
              }
              if (menu.children && menu.children.length > 0) {
                logMenus(menu.children, depth + 1);
              }
            });
          };
          // Logger.info("[MENUCONFIG_PANEL] Sending initial menus to webview:");
          logMenus(loadedMenus);

          // Debug: Check critical configs before sending
          const findMenuByName = (menus: Menu[], name: string): Menu | null => {
            for (const menu of menus) {
              if (menu.name === name) return menu;
              if (menu.children) {
                const found = findMenuByName(menu.children, name);
                if (found) return found;
              }
            }
            return null;
          };

          const dfsUsingPosix = findMenuByName(loadedMenus, 'DFS_USING_POSIX');
          const rtUsingPosixFs = findMenuByName(loadedMenus, 'RT_USING_POSIX_FS');

          Logger.info(`[MENUCONFIG_PANEL] Before sending to webview:`);
          if (dfsUsingPosix) {
            Logger.info(`[MENUCONFIG_PANEL]   DFS_USING_POSIX:`);
            Logger.info(`[MENUCONFIG_PANEL]     - value: ${dfsUsingPosix.value}`);
            Logger.info(`[MENUCONFIG_PANEL]     - type: ${dfsUsingPosix.type}`);
            Logger.info(`[MENUCONFIG_PANEL]     - selectedBy: [${dfsUsingPosix.selectedBy?.join(', ') || 'none'}]`);
            Logger.info(`[MENUCONFIG_PANEL]     - isReadonly: ${dfsUsingPosix.isReadonly}`);
            Logger.info(`[MENUCONFIG_PANEL]     - readonlyReason: ${dfsUsingPosix.readonlyReason || 'none'}`);
            Logger.info(`[MENUCONFIG_PANEL]     - isVisible: ${dfsUsingPosix.isVisible}`);
          } else {
            Logger.info(`[MENUCONFIG_PANEL]   DFS_USING_POSIX: NOT FOUND in menu tree`);
          }

          if (rtUsingPosixFs) {
            Logger.info(`[MENUCONFIG_PANEL]   RT_USING_POSIX_FS:`);
            Logger.info(`[MENUCONFIG_PANEL]     - value: ${rtUsingPosixFs.value}`);
            Logger.info(`[MENUCONFIG_PANEL]     - type: ${rtUsingPosixFs.type}`);
            Logger.info(`[MENUCONFIG_PANEL]     - select: [${rtUsingPosixFs.select?.join(', ') || 'none'}]`);
            Logger.info(`[MENUCONFIG_PANEL]     - isVisible: ${rtUsingPosixFs.isVisible}`);
          } else {
            Logger.info(`[MENUCONFIG_PANEL]   RT_USING_POSIX_FS: NOT FOUND in menu tree`);
          }
          
          // 获取调试配置并发送给前端
          const debugConfig = {
            enabled: vscode.workspace.getConfiguration('kconfig.debug').get('enabled', false),
            menu: vscode.workspace.getConfiguration('kconfig.debug').get('menu', false)
          };

          // Add error handling and data size check for large menu structures
          try {
            const menuData = {
              command: "load_initial_values",
              menus: loadedMenus,
              debugConfig: debugConfig
            };
            
            // Check data size before sending
            const dataString = JSON.stringify(menuData);
            const dataSizeInMB = dataString.length / (1024 * 1024);
            
            if (dataSizeInMB > 50) { // If data is larger than 50MB
              Logger.warn(`Large menu data detected: ${dataSizeInMB.toFixed(2)}MB. This may cause communication issues.`);
              
              // Optimize data by removing debug properties and compressing
              const optimizedMenus = this.optimizeMenusForTransfer(loadedMenus);
              const optimizedData = {
                command: "load_initial_values",
                menus: optimizedMenus,
              };
              
              this.panel.webview.postMessage(optimizedData);
            } else {
              this.panel.webview.postMessage(menuData);
            }
          } catch (error) {
            Logger.error("Failed to send menu data to webview", error as Error);
            vscode.window.showErrorMessage("Failed to load configuration data. The configuration may be too complex.");
          }
          break;
        }
        case "setDefault":
          if (this.kconfigServer) {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: t('reset.progress.title'),
              cancellable: false
            }, async (progress) => {
              try {
                progress.report({ increment: 30, message: t('reset.progress.clearing') });
                await this.kconfigServer!.resetToDefaults();

                progress.report({ increment: 60, message: t('reset.progress.loading') });
                const resetMenus = this.kconfigServer!.getMenus();
                this.safelySendMenuData("load_initial_values", resetMenus);

                progress.report({ increment: 100, message: t('reset.progress.complete') });
                // 使用状态栏消息，3秒后自动关闭
                vscode.window.setStatusBarMessage(`$(refresh) ${t('reset.success')}`, 3000);
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`${t('reset.failed')}: ${errorMessage}`);
                Logger.error("Reset to defaults failed", error as Error);
              }
            });
          }
          break;
        case "loadVirtualNode": {
          // Handle virtual node lazy loading
          const nodeId = message.nodeId;
          Logger.info(`[PANEL] Received loadVirtualNode request for node: ${nodeId}`);
//////console.log(`📡 [PANEL_DEBUG] 收到懒加载请求: ${nodeId}`);
          
          if (this.kconfigServer) {
            try {
              const updatedMenus = await this.kconfigServer.loadVirtualNodeContent(nodeId);
              this.safelySendMenuData("virtual_node_loaded", updatedMenus, { nodeId });
              Logger.info(`[PANEL] Successfully loaded virtual node: ${nodeId}`);
            } catch (error) {
              Logger.error(`[PANEL] Failed to load virtual node: ${nodeId}`, error as Error);
//////console.log(`💥 [PANEL_DEBUG] 懒加载失败: ${error}`);
            }
          } else {
            Logger.warn(`[PANEL] KconfigServer not available for loadVirtualNode`);
//////console.log(`⚠️ [PANEL_DEBUG] KconfigServer 不可用`);
          }
          break;
        }
        case "saveDefconfig":
          if (this.kconfigServer) {
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(path.join(this.curWorkspaceFolder.fsPath, "defconfig")),
              filters: {
                "Defconfig files": ["defconfig"],
                "All files": ["*"]
              }
            });
            if (uri) {
              await this.kconfigServer.saveDefconfig(uri.fsPath);
            }
          }
          break;
        case "expandPackageNode": {
          // Handle lazy loading of package nodes
          const nodeId = message.nodeId;
          if (!nodeId) {
            Logger.error(`[PANEL] expandPackageNode message missing nodeId`);
            break;
          }
          
          Logger.info(`[PANEL] Received expandPackageNode request for: ${nodeId}`);
          
          try {
            // Use menu loader to handle lazy loading
            const children = await this.menuLoader.expandPackageNode(nodeId);
            if (children && children.length > 0) {
              Logger.info(`[PANEL] Loaded ${children.length} items for node: ${nodeId}`);
              this.safelySendMenuData("packageNodeExpanded", children, { nodeId });
            } else {
              Logger.warn(`[PANEL] No content loaded for node: ${nodeId}`);
              this.panel.webview.postMessage({
                command: "packageNodeExpandFailed",
                nodeId: nodeId,
                error: "No content found"
              });
            }
          } catch (error) {
            Logger.error(`[PANEL] Failed to expand package node ${nodeId}`, error as Error);
            this.panel.webview.postMessage({
              command: "packageNodeExpandFailed", 
              nodeId: nodeId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          break;
        }
        default:
          Logger.error(`Unrecognized command: ${message.command}`);
          break;
      }
    });

    // Initialize KconfigServer if Kconfig file exists
    this.initializeKconfigServer().then(() => {
      // Load initial values
      setTimeout(() => {
        const menus = this.kconfigServer ? this.kconfigServer.getMenus() : initialValues;
        
        // Set default collapsed state for all menus
        const setDefaultCollapsedState = (menuList: Menu[]) => {
          menuList.forEach(menu => {
            if (menu.type === menuType.menu) {
              menu.isCollapsed = true; // Default to collapsed
            }
            if (menu.children && menu.children.length > 0) {
              setDefaultCollapsedState(menu.children);
            }
          });
        };
        setDefaultCollapsedState(menus);
        
        this.safelySendMenuData("load_initial_values", menus);
      }, 100);
    });
  }

  public dispose() {
    if (this._disposed) {
      return; // 避免重复dispose
    }
    
    this._disposed = true;
    MenuconfigPanel.currentPanel = undefined;
    
    if (this.kconfigServer) {
      this.kconfigServer.dispose();
      this.kconfigServer = null;
    }
    
    // 安全地dispose panel
    try {
      this.panel.dispose();
    } catch (error) {
      Logger.error('Error disposing panel', error as Error);
    }
    
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        try {
          disposable.dispose();
        } catch (error) {
          Logger.error('Error disposing disposable', error as Error);
        }
      }
    }
  }
  
  private getExtensionPath(): string {
    // Get extension path from webview URI
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join("dummy"))
    ).toString();
    const match = scriptUri.match(/^.*\/([a-z0-9-]+)\/dummy$/);
    if (match) {
      return path.dirname(path.dirname(scriptUri.replace(/^.*\/\//, "")));
    }
    return "";  
  }
  
  private async initializeKconfigServer(): Promise<void> {
    try {
      let kconfigFile: string | undefined;
      
      // If a specific target file was provided, use it
      if (this.targetFile) {
        kconfigFile = this.targetFile.fsPath;
      } else {
        // Look for Kconfig file in workspace
        const kconfigPath = path.join(this.curWorkspaceFolder.fsPath, "Kconfig");
        const kconfigAltPath = path.join(this.curWorkspaceFolder.fsPath, "kconfig");
        
        if (require("fs").existsSync(kconfigPath)) {
          kconfigFile = kconfigPath;
        } else if (require("fs").existsSync(kconfigAltPath)) {
          kconfigFile = kconfigAltPath;
        }
      }
      
      if (kconfigFile && require("fs").existsSync(kconfigFile)) {
        this.kconfigServer = await KconfigServer.init({
          workspaceFolder: this.curWorkspaceFolder,
          kconfigFile: kconfigFile,
        });
        
        // Listen to server events
        this.kconfigServer.on("valueChanged", (menu: Menu) => {
          // Enhanced value change notification with debug info
          const message = {
            command: "value_updated",
            menu: menu,
            timestamp: Date.now(),
            debug: process.env.NODE_ENV === 'development'
          };

          this.panel.webview.postMessage(message);
        });

        // configSaved event is now handled in the saveChanges message handler
        // No need to show duplicate notification here
        
        this.kconfigServer.on("configReset", (menus: Menu[]) => {
          this.safelySendMenuData("load_initial_values", menus);
        });
        
        this.kconfigServer.on("changesDiscarded", (menus: Menu[]) => {
          // Logger.info(`[PANEL] Received changesDiscarded event, sending ${menus.length} menus to UI`);

          // Log a few sample menu values for debugging
          for (let i = 0; i < Math.min(menus.length, 5); i++) {
            const menu = menus[i];
            if (menu.name) {
              // Logger.info(`[PANEL] Menu sample ${i}: ${menu.name} (${menu.type}) = ${menu.value}`);
            }
          }

          this.safelySendMenuData("load_initial_values", menus);
          // Notification is already shown in the discardChanges message handler
        });
        
        // Listen to visibility changes
        this.kconfigServer.on("visibilityChanged", (changes: Array<{
          id: string;
          isVisible?: boolean;
          isContainerVisible?: boolean;
          isReadonly?: boolean;
          readonlyReason?: string;
          selectedBy?: string[];
          autoSelectedValue?: boolean;
          autoImpliedValue?: 'y' | 'm' | boolean;
          value?: any;
        }>) => {
          if (!changes || changes.length === 0) {
            return;
          }
          this.sendVisibilityDelta(changes);
        });
      }
    } catch (error) {
      Logger.error("Failed to initialize KconfigServer", error as Error);
    }
  }

  /**
   * Optimize menu data for transfer by removing unnecessary properties
   * and compressing large structures to prevent communication failures
   */
  private optimizeMenusForTransfer(menus: Menu[]): Menu[] {
    const optimizeMenu = (menu: Menu): Menu => {
      // Create a copy with only essential properties
      const optimized: Menu = {
        id: menu.id,
        name: menu.name,
        title: menu.title,
        type: menu.type,
        value: menu.value,
        isVisible: menu.isVisible,
        isCollapsed: menu.isCollapsed,
        isMenuconfig: menu.isMenuconfig,
        hasPrompt: menu.hasPrompt,
        dependsOn: menu.dependsOn,
        help: menu.help?.length > 500 ? menu.help.substring(0, 500) + "..." : menu.help, // Truncate long help text
        range: menu.range,
        select: menu.select,
        selectedBy: menu.selectedBy,
        indentLevel: menu.indentLevel,
        shouldIndentChildren: menu.shouldIndentChildren,
        isImplicitContainer: menu.isImplicitContainer,
        isContainerVisible: menu.isContainerVisible,
        isReadonly: menu.isReadonly,
        readonlyReason: menu.readonlyReason,
        autoSelectedValue: menu.autoSelectedValue,
        defaults: menu.defaults,
        isVirtual: menu.isVirtual,
        childrenParsed: menu.childrenParsed,
        lazyLoadPath: menu.lazyLoadPath,
        sourceFiles: menu.sourceFiles,
        sourceFile: menu.sourceFile,
        isMainMenu: menu.isMainMenu,
        children: menu.children ? menu.children.map(optimizeMenu) : []
      };
      return optimized;
    };

    return menus.map(optimizeMenu);
  }

  /**
   * Safely send menu data to webview with error handling and optimization
   */
  private safelySendMenuData(command: string, menus: Menu[], additionalData: any = {}) {
    //console.log(`[PANEL] safelySendMenuData called with command: ${command}, menus count: ${menus.length}`);
    if (menus.length > 0 && command === "load_initial_values") {
      //console.log(`[PANEL] Sending first menu: name=${menus[0].name}, title=${menus[0].title}, children=${menus[0].children?.length || 0}`);
    }
    try {
      const messageData = {
        command,
        menus,
        ...additionalData
      };
      
      // Check data size before sending
      const dataString = JSON.stringify(messageData);
      const dataSizeInMB = dataString.length / (1024 * 1024);
      
      if (dataSizeInMB > 30) { // Lower threshold for safety
        Logger.warn(`Large menu data detected for command ${command}: ${dataSizeInMB.toFixed(2)}MB. Optimizing data.`);
        
        const optimizedMenus = this.optimizeMenusForTransfer(menus);
        const optimizedData = {
          command,
          menus: optimizedMenus,
          ...additionalData
        };
        
        this.panel.webview.postMessage(optimizedData);
      } else {
        this.panel.webview.postMessage(messageData);
      }
    } catch (error) {
      Logger.error(`Failed to send ${command} data to webview`, error as Error);
      vscode.window.showErrorMessage(`Failed to update configuration display. ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private sendVisibilityDelta(changes: Array<{
    id: string;
    isVisible?: boolean;
    isContainerVisible?: boolean;
    isReadonly?: boolean;
    readonlyReason?: string;
    selectedBy?: string[];
    autoSelectedValue?: boolean;
    autoImpliedValue?: 'y' | 'm' | boolean;
    value?: any;
  }>): void {
    try {
      this.panel.webview.postMessage({
        command: "visibility_delta",
        changes
      });
    } catch (error) {
      Logger.error("Failed to send visibility delta", error as Error);
    }
  }

  private resolveUiTheme(): string {
    const configured = vscode.workspace
      .getConfiguration("kconfig")
      .get<string>("uiTheme", MenuconfigPanel.supportedThemes[0]);

    if (configured && MenuconfigPanel.supportedThemes.includes(configured as typeof MenuconfigPanel.supportedThemes[number])) {
      return configured;
    }
    return MenuconfigPanel.supportedThemes[0];
  }

  private mapColorThemeKind(kind: vscode.ColorThemeKind): WebviewColorTheme {
    switch (kind) {
      case vscode.ColorThemeKind.Light:
      case vscode.ColorThemeKind.HighContrastLight:
        return "light";
      case vscode.ColorThemeKind.Dark:
      case vscode.ColorThemeKind.HighContrast:
      default:
        return "dark";
    }
  }

  private registerColorThemeSync(): void {
    const disposable = vscode.window.onDidChangeActiveColorTheme((theme) => {
      const mapped = this.mapColorThemeKind(theme.kind);
      try {
        this.panel.webview.postMessage({
          command: "color_theme_changed",
          themeKind: mapped,
        });
      } catch (error) {
        Logger.error("Failed to notify webview about color theme change", error as Error);
      }
    });

    this.disposables.push(disposable);
  }

  private createMenuconfigHtml(scriptPath: vscode.Uri, themeKey: string, colorThemeKind: WebviewColorTheme) {
    const nonce = this.getNonce();
    const sanitizedTheme = themeKey.replace(/"/g, "&quot;");
    const sanitizedColorKind = colorThemeKind.replace(/"/g, "&quot;");
    
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; font-src ${this.panel.webview.cspSource}; img-src ${this.panel.webview.cspSource} https: data:; connect-src ${this.panel.webview.cspSource};">
            <title>Kconfig Visual Editor</title>
            <style>
              body {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100vh;
                overflow: hidden;
              }
              #menuconfig {
                width: 100%;
                height: 100%;
              }
            </style>
            </head>
            <body>
              <div id="menuconfig">Loading...</div>
              <script nonce="${nonce}">window.__KCONFIG_THEME__ = "${sanitizedTheme}";window.__KCONFIG_VSCODE_COLOR_THEME__ = "${sanitizedColorKind}";</script>
              <script nonce="${nonce}" src="${scriptPath}"></script>
            </body>
        </html>`;
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
