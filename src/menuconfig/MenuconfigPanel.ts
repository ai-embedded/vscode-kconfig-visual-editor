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
import { KconfigServer } from "./KconfigServer";
import { MenuChunkTask, groupChunkTasksForBatches, splitMenusForChunkedTransfer } from "./MenuTransferSerializer";
import { runUnsavedCloseFlow } from "./unsavedCloseFlow";
import { Logger } from "../logger/logger";
import { t } from "../i18n";

type WebviewColorTheme = "light" | "dark";

interface InitialTransferStartupMeta {
  sessionId: number;
  panelAgeMs: number;
  serverInitMs: number;
  getMenusMs: number;
  serializeMs: number;
  totalChunks: number;
  totalTaskBatches: number;
}

export class MenuconfigPanel {
  public static currentPanel: MenuconfigPanel | undefined;
  private static panelSeq = 0;
  private _disposed = false;
  private static readonly supportedThemes = ["default", "modern"] as const;
  private static readonly initialPayloadChunkSize = 120;
  private static readonly initialPayloadTaskBatchSize = 32;
  private static readonly startupSlowThresholdMs = 1500;

  public static createOrShow(
    extensionUri: vscode.Uri,
    curWorkspaceFolder: vscode.Uri,
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
  private kconfigServer: KconfigServer | null = null;
  private targetFile?: vscode.Uri;
  private kconfigServerReady = false;
  private pendingInitValuesRequest = false;
  private initialPayloadTransferToken = 0;
  private lastInitialValuesSentAt = 0;
  private initializationToken = 0;
  private readonly panelId: number;
  private readonly panelCreatedAt = Date.now();
  private kconfigServerInitDurationMs = 0;
  private initialTransferSessionSeq = 0;
  private disposeFlowStarted = false;

  private constructor(
    extensionUri: vscode.Uri,
    column: vscode.ViewColumn,
    curWorkspaceFolder: vscode.Uri,
    targetFile?: vscode.Uri
  ) {
    this.panelId = ++MenuconfigPanel.panelSeq;
    this.curWorkspaceFolder = curWorkspaceFolder;
    this.targetFile = targetFile;
    this.trace(`constructor start target=${targetFile?.fsPath || "(active)"}`);

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
    this.trace("webview html assigned");
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
      () => {
        void this.handlePanelDisposed();
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
            // Logger.info(`[PANEL] updateValue processed and delta events dispatched`);
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
          this.trace(`requestInitValues received ready=${this.kconfigServerReady} hasServer=${!!this.kconfigServer}`);
          if (!this.kconfigServerReady || !this.kconfigServer) {
            this.pendingInitValuesRequest = true;
            Logger.info("[PANEL] requestInitValues received before KconfigServer is ready; request queued.");
            break;
          }
          this.sendInitialValues();
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
        case "requestMenuDetail": {
          if (!this.kconfigServer) {
            break;
          }
          const requestedId = typeof message.id === "string" ? message.id : "";
          if (!requestedId) {
            break;
          }
          try {
            const detail = this.kconfigServer.getMenuDetailById(requestedId);
            this.panel.webview.postMessage({
              command: "menu_detail",
              id: requestedId,
              detail,
            });
          } catch (error) {
            Logger.error("Failed to send menu detail", error as Error);
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
        default:
          Logger.error(`Unrecognized command: ${message.command}`);
          break;
      }
    });

    // Initialize KconfigServer if Kconfig file exists
    this.initializeKconfigServer();
  }

  public dispose() {
    if (this._disposed) {
      return;
    }
    this.trace("dispose requested");
    try {
      this.panel.dispose();
    } catch (error) {
      Logger.error("Error disposing panel", error as Error);
      this.disposeInternal(true);
    }
  }

  private async handlePanelDisposed(): Promise<void> {
    if (this.disposeFlowStarted) {
      return;
    }
    this.disposeFlowStarted = true;
    this.trace("onDidDispose fired");

    try {
      await runUnsavedCloseFlow({
        hasUnsavedChanges: this.kconfigServer?.hasUnsavedChanges() ?? false,
        saveConfig: async () => {
          if (!this.kconfigServer) {
            return;
          }
          await this.kconfigServer.saveConfig();
        },
        showWarningMessage: async (message, options, ...items) =>
          vscode.window.showWarningMessage(message, options, ...items),
        showErrorMessage: (message) => {
          vscode.window.showErrorMessage(message);
        },
        setStatusBarMessage: (message, hideAfterTimeout) => {
          if (typeof hideAfterTimeout === "number") {
            vscode.window.setStatusBarMessage(message, hideAfterTimeout);
            return;
          }
          vscode.window.setStatusBarMessage(message);
        },
        text: {
          unsavedMessage: t("close.unsavedMessage"),
          saveButton: t("close.saveButton"),
          noSaveButton: t("close.noSaveButton"),
          saveSuccess: t("close.saveSuccess"),
          saveFailed: t("close.saveFailed"),
        },
      });
    } finally {
      this.disposeInternal(false);
    }
  }

  private disposeInternal(disposePanel: boolean): void {
    if (this._disposed) {
      return;
    }

    this.trace(`disposeInternal disposePanel=${disposePanel}`);
    this._disposed = true;
    this.initializationToken += 1;
    this.initialPayloadTransferToken += 1;
    MenuconfigPanel.currentPanel = undefined;

    if (this.kconfigServer) {
      this.kconfigServer.dispose();
      this.kconfigServer = null;
    }

    if (disposePanel) {
      try {
        this.panel.dispose();
      } catch (error) {
        Logger.error('Error disposing panel', error as Error);
      }
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
    const initToken = ++this.initializationToken;
    const initStartedAt = Date.now();
    try {
      this.trace("initializeKconfigServer start");
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
        this.trace(`initializeKconfigServer init target=${kconfigFile}`);
        const server = await KconfigServer.init({
          workspaceFolder: this.curWorkspaceFolder,
          kconfigFile: kconfigFile,
        });
        if (this._disposed || initToken !== this.initializationToken) {
          this.trace(`initializeKconfigServer stale result dropped token=${initToken}`);
          server.dispose();
          return;
        }
        this.kconfigServer = server;
        this.kconfigServerInitDurationMs = Date.now() - initStartedAt;
        this.trace("initializeKconfigServer init done");
        
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

        this.kconfigServerReady = true;
        this.trace(`kconfigServer ready pendingInit=${this.pendingInitValuesRequest}`);
        if (this.pendingInitValuesRequest) {
          this.pendingInitValuesRequest = false;
          this.sendInitialValues();
        }
      }
    } catch (error) {
      this.kconfigServerInitDurationMs = Date.now() - initStartedAt;
      this.trace(`initializeKconfigServer failed: ${error instanceof Error ? error.message : String(error)}`);
      Logger.error("Failed to initialize KconfigServer", error as Error);
    }
  }

  private sendInitialValues(): void {
    if (this._disposed || !this.kconfigServer) {
      this.trace("sendInitialValues skipped no server");
      return;
    }
    const now = Date.now();
    if (now - this.lastInitialValuesSentAt < 250) {
      this.trace("sendInitialValues throttled");
      return;
    }
    this.lastInitialValuesSentAt = now;
    this.trace("sendInitialValues dispatch");
    const getMenusStartedAt = Date.now();
    const loadedMenus = this.kconfigServer.getMenus();
    const getMenusDurationMs = Date.now() - getMenusStartedAt;
    this.setDefaultCollapsedState(loadedMenus);

    const debugConfigSection = vscode.workspace.getConfiguration('kconfig.debug');
    const debugConfig = {
      enabled: debugConfigSection.get('enabled', false),
      menu: debugConfigSection.get('menu', false),
      startup: debugConfigSection.get('startup', false),
      startupSlowThresholdMs: debugConfigSection.get('startupSlowThresholdMs', MenuconfigPanel.startupSlowThresholdMs)
    };

    this.safelySendMenuData("load_initial_values", loadedMenus, {
      debugConfig,
      startupMetrics: {
        sessionId: ++this.initialTransferSessionSeq,
        panelAgeMs: Date.now() - this.panelCreatedAt,
        serverInitMs: this.kconfigServerInitDurationMs,
        getMenusMs: getMenusDurationMs,
      },
    });
  }

  private setDefaultCollapsedState(menus: Menu[]): void {
    const setDefault = (menuList: Menu[]) => {
      menuList.forEach(menu => {
        if (menu.type === menuType.menu) {
          menu.isCollapsed = true;
        }
        if (menu.children && menu.children.length > 0) {
          setDefault(menu.children);
        }
      });
    };
    setDefault(menus);
  }

  /**
   * Safely send menu data to webview with error handling and optimization
   */
  private safelySendMenuData(command: string, menus: Menu[], additionalData: any = {}) {
    if (this._disposed) {
      this.trace(`safelySendMenuData skipped disposed command=${command}`);
      return;
    }
    this.trace(`safelySendMenuData command=${command} menus=${menus?.length || 0}`);
    //console.log(`[PANEL] safelySendMenuData called with command: ${command}, menus count: ${menus.length}`);
    if (menus.length > 0 && command === "load_initial_values") {
      //console.log(`[PANEL] Sending first menu: name=${menus[0].name}, title=${menus[0].title}, children=${menus[0].children?.length || 0}`);
    }
    try {
      if (command === "load_initial_values") {
        const serializeStartedAt = Date.now();
        const { skeletonMenus, chunks } = splitMenusForChunkedTransfer(
          menus,
          MenuconfigPanel.initialPayloadChunkSize
        );
        const serializeMs = Date.now() - serializeStartedAt;
        const chunkBatches = groupChunkTasksForBatches(
          chunks,
          MenuconfigPanel.initialPayloadTaskBatchSize
        );
        const startupMetrics = (additionalData?.startupMetrics || {}) as Partial<InitialTransferStartupMeta>;
        const startupMeta: InitialTransferStartupMeta = {
          sessionId: typeof startupMetrics.sessionId === "number" ? startupMetrics.sessionId : ++this.initialTransferSessionSeq,
          panelAgeMs: typeof startupMetrics.panelAgeMs === "number" ? startupMetrics.panelAgeMs : Date.now() - this.panelCreatedAt,
          serverInitMs: typeof startupMetrics.serverInitMs === "number" ? startupMetrics.serverInitMs : this.kconfigServerInitDurationMs,
          getMenusMs: typeof startupMetrics.getMenusMs === "number" ? startupMetrics.getMenusMs : 0,
          serializeMs,
          totalChunks: chunks.length,
          totalTaskBatches: chunkBatches.length,
        };
        const restAdditionalData = { ...(additionalData || {}) } as Record<string, unknown>;
        delete restAdditionalData.startupMetrics;
        const transferToken = ++this.initialPayloadTransferToken;
        this.trace(`initial payload begin token=${transferToken} roots=${skeletonMenus.length} chunks=${chunks.length} taskBatches=${chunkBatches.length}`);

        this.panel.webview.postMessage({
          command: "load_initial_values_begin",
          menus: skeletonMenus,
          meta: {
            totalChunks: chunks.length,
            chunkSize: MenuconfigPanel.initialPayloadChunkSize,
            totalTaskBatches: chunkBatches.length,
            taskBatchSize: MenuconfigPanel.initialPayloadTaskBatchSize,
            startup: startupMeta,
          },
          ...restAdditionalData
        });

        const transferStartedAt = Date.now();
        this.streamInitialPayloadChunks(
          chunkBatches,
          transferToken,
          0,
          0,
          chunks.length,
          startupMeta,
          transferStartedAt
        );
        return;
      }

      const messageData = {
        command,
        menus,
        ...additionalData
      };

      this.panel.webview.postMessage(messageData);
    } catch (error) {
      Logger.error(`Failed to send ${command} data to webview`, error as Error);
      vscode.window.showErrorMessage(`Failed to update configuration display. ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private streamInitialPayloadChunks(
    chunkBatches: MenuChunkTask[][],
    transferToken: number,
    batchIndex: number,
    sentChunkCount: number,
    totalChunks: number,
    startupMeta: InitialTransferStartupMeta,
    transferStartedAt: number
  ): void {
    if (this._disposed || transferToken !== this.initialPayloadTransferToken) {
      this.trace(`streamInitialPayloadChunks cancelled token=${transferToken} current=${this.initialPayloadTransferToken} disposed=${this._disposed}`);
      return;
    }

    if (batchIndex >= chunkBatches.length) {
      this.trace(`initial payload end token=${transferToken} chunks=${totalChunks}`);
      this.panel.webview.postMessage({
        command: "load_initial_values_end",
        totalChunks,
        startup: {
          sessionId: startupMeta.sessionId,
          streamMs: Date.now() - transferStartedAt,
          panelToEndMs: Date.now() - this.panelCreatedAt,
        },
      });
      return;
    }

    const currentBatch = chunkBatches[batchIndex];
    const chunkPayload = currentBatch.map((chunk, localIndex) => ({
      parentId: chunk.parentId,
      menus: chunk.children,
      chunkIndex: sentChunkCount + localIndex + 1,
      totalChunks,
    }));

    this.panel.webview.postMessage({
      command: "load_initial_values_batch",
      chunks: chunkPayload,
      batchIndex: batchIndex + 1,
      totalBatches: chunkBatches.length,
    });

    if (batchIndex + 1 < chunkBatches.length) {
      setTimeout(() => {
        this.streamInitialPayloadChunks(
          chunkBatches,
          transferToken,
          batchIndex + 1,
          sentChunkCount + currentBatch.length,
          totalChunks,
          startupMeta,
          transferStartedAt
        );
      }, 0);
      return;
    }

    this.trace(`initial payload end token=${transferToken} chunks=${totalChunks}`);
    this.panel.webview.postMessage({
      command: "load_initial_values_end",
      totalChunks,
      startup: {
        sessionId: startupMeta.sessionId,
        streamMs: Date.now() - transferStartedAt,
        panelToEndMs: Date.now() - this.panelCreatedAt,
      },
    });
  }

  private trace(message: string): void {
    Logger.debug(() => `[PANEL:${this.panelId}] ${message}`);
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
    if (this._disposed) {
      this.trace("sendVisibilityDelta skipped disposed");
      return;
    }
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
