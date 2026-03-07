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

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Menu, menuType } from "./Menu";
import { formatHelpText } from "./helpTextFormatter";
import { Logger } from "../logger/logger";
import { ensureRtThreadEnvironment } from "../rtthread/environment";
import { KconfigParser } from "./KconfigParser";
import { KconfigSessionCache } from "./KconfigSessionCache";

export class KconfigMenuLoader {
  public static updateValues(
    config: Menu,
    values: { values: any; visible: any; ranges: any }
  ): Menu {
    const newConfig: Menu = config;
    if (
      Object.prototype.hasOwnProperty.call(values.values, newConfig.name) &&
      newConfig.type !== menuType.choice
    ) {
      newConfig.value =
        newConfig.type === menuType.hex
          ? values.values[newConfig.name].toString(16)
          : values.values[newConfig.name];
    }
    if (Object.prototype.hasOwnProperty.call(values.visible, newConfig.id)) {
      newConfig.isVisible = values.visible[newConfig.id];
    }
    if (Object.prototype.hasOwnProperty.call(values.ranges, newConfig.name)) {
      newConfig.range = values.ranges[newConfig.name];
    }
    for (let i = 0; i < newConfig.children.length; i++) {
      newConfig.children[i] = this.updateValues(newConfig.children[i], values);
      if (newConfig.type === menuType.choice) {
        values.values[newConfig.children[i].name]
          ? (newConfig.value = newConfig.children[i].name)
          : (newConfig.children[i].value = false);
      }
    }
    return newConfig;
  }

  private workspaceFolder: vscode.Uri;
  private targetFile?: vscode.Uri;

  constructor(workspaceFolder: vscode.Uri, targetFile?: vscode.Uri) {
    this.workspaceFolder = workspaceFolder;
    this.targetFile = targetFile;
  }

  public async loadKconfigMenus(): Promise<Menu[]> {
    ensureRtThreadEnvironment(this.workspaceFolder);

    // If a specific target file was provided, use it
    if (this.targetFile) {
      const targetPath = this.targetFile.fsPath;
      if (fs.existsSync(targetPath)) {
        Logger.info(`Parsing specific Kconfig file: ${targetPath}`);
        
        try {
          const parsedMenus = await this.parseMenusWithCache(targetPath);
          
          if (parsedMenus.length === 0) {
            Logger.warn("No menus parsed from target Kconfig file, using demo menus");
            return this.createDemoMenus();
          }
          
          Logger.info(`Successfully parsed ${parsedMenus.length} menus from target Kconfig file`);
          return parsedMenus;
        } catch (error) {
          Logger.error("Failed to parse target Kconfig file", error as Error);
          return this.createDemoMenus();
        }
      } else {
        Logger.warn(`Target Kconfig file not found: ${targetPath}`);
      }
    }
    
    // Fallback to finding Kconfig files in the workspace
    const kconfigFiles = this.findKconfigFiles();
    
    if (kconfigFiles.length === 0) {
      Logger.warn("No Kconfig files found, using demo menus");
      return this.createDemoMenus();
    }

    // Use the main Kconfig file (usually just "Kconfig")
    const mainKconfigFile = kconfigFiles.find(f => path.basename(f) === "Kconfig") || kconfigFiles[0];
    
    try {
      const parsedMenus = await this.parseMenusWithCache(mainKconfigFile);
      
      if (parsedMenus.length === 0) {
        Logger.warn("No menus parsed from Kconfig files, using demo menus");
        return this.createDemoMenus();
      }
      
      Logger.info(`Successfully parsed ${parsedMenus.length} menus from Kconfig files`);
      return parsedMenus;
    } catch (error) {
      Logger.error("Failed to parse Kconfig files", error as Error);
      return this.createDemoMenus();
    }
  }

  private async parseMenusWithCache(mainKconfigFile: string): Promise<Menu[]> {
    const cache = new KconfigSessionCache(this.workspaceFolder.fsPath);
    const cacheKey = KconfigSessionCache.buildCacheKey(mainKconfigFile);

    const cachedMenus = await cache.load(cacheKey);
    if (cachedMenus && cachedMenus.length > 0) {
      Logger.info(() => `[SESSION_CACHE] Loaded ${cachedMenus.length} menus from cache: ${mainKconfigFile}`);
      return cachedMenus;
    }

    const parser = new KconfigParser({
      workspaceFolder: this.workspaceFolder.fsPath,
      mainKconfigFile: mainKconfigFile
    });

    const parsedMenus = await parser.parse();
    if (parsedMenus.length > 0) {
      await cache.save(cacheKey, parsedMenus, parser.getParsedFiles());
    }
    return parsedMenus;
  }


  public mapJsonToMenuObject(config: any): Menu {
    const menu: Menu = {
      id: config.id,
      name: config.name,
      help: formatHelpText(config.help),
      range: config.range,
      title: config.title,
      type: config.type,
      isCollapsed: false,
      isMenuconfig: config.is_menuconfig,
      isVisible: false,
      dependsOn: config.depends_on,
      children: [],
      value: null,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    for (const child of config.children) {
      const childMenu: Menu = this.mapJsonToMenuObject(child);
      menu.children.push(childMenu);
    }
    return menu;
  }

  private findKconfigFiles(): string[] {
    const kconfigFiles: string[] = [];
    
    // Common Kconfig file names to look for
    const commonKconfigNames = [
      "Kconfig",
      "kconfig", 
      "Config.in",
      "Kconfig.projbuild",
      "Kconfig.in"
    ];
    
    for (const filename of commonKconfigNames) {
      const filepath = path.join(this.workspaceFolder.fsPath, filename);
      if (fs.existsSync(filepath)) {
        kconfigFiles.push(filepath);
      }
    }
    
    // Also look for Kconfig files in common subdirectories
    const commonSubdirs = ["components", "main", "src"];
    for (const subdir of commonSubdirs) {
      const subdirPath = path.join(this.workspaceFolder.fsPath, subdir);
      if (fs.existsSync(subdirPath)) {
        for (const filename of commonKconfigNames) {
          const filepath = path.join(subdirPath, filename);
          if (fs.existsSync(filepath)) {
            kconfigFiles.push(filepath);
          }
        }
      }
    }
    
    return kconfigFiles;
  }
  
  private createDemoMenus(): Menu[] {
    const demoMenus: Menu[] = [];

    const mainMenu: Menu = {
      id: "main",
      name: "MAIN_MENU", 
      title: "Main Menu",
      type: menuType.menu,
      isVisible: true,
      children: this.createDemoConfigItems(),
      help: "",
      range: [],
      isCollapsed: false,
      value: null,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };

    demoMenus.push(mainMenu);

    return demoMenus;
  }

  private createDemoConfigItems(): Menu[] {
    const items: Menu[] = [];

    // Bool config example
    const boolConfig: Menu = {
      id: "bool-example",
      name: "CONFIG_EXAMPLE_BOOL",
      title: "Enable Example Feature", 
      type: menuType.bool,
      value: true,
      help: "This is a demo boolean configuration option.",
      isVisible: true,
      children: [],
      range: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    items.push(boolConfig);

    // String config example
    const stringConfig: Menu = {
      id: "string-example",
      name: "CONFIG_EXAMPLE_STRING",
      title: "Example String Value",
      type: menuType.string,
      value: "default",
      help: "This is a demo string configuration option.",
      isVisible: true,
      children: [],
      range: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    items.push(stringConfig);

    // Int config example
    const intConfig: Menu = {
      id: "int-example",
      name: "CONFIG_EXAMPLE_INT",
      title: "Example Integer Value",
      type: menuType.int,
      value: 100,
      range: [1, 1000],
      help: "This is a demo integer configuration option.",
      isVisible: true,
      children: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    items.push(intConfig);

    // Hex config example
    const hexConfig: Menu = {
      id: "hex-example",
      name: "CONFIG_EXAMPLE_HEX",
      title: "Example Hex Value",
      type: menuType.hex,
      value: "0x1000",
      help: "This is a demo hex configuration option.",
      isVisible: true,
      children: [],
      range: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    items.push(hexConfig);

    // Choice config example
    const choiceConfig: Menu = {
      id: "choice-example",
      name: "CONFIG_EXAMPLE_CHOICE",
      title: "Example Choice",
      type: menuType.choice,
      value: "option1",
      help: "This is a demo choice configuration option.",
      isVisible: true,
      children: [],
      range: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    
    // Add choice options as children
    const option1: Menu = {
      id: "choice-option1",
      name: "CONFIG_EXAMPLE_CHOICE_OPTION1",
      title: "Option 1",
      type: menuType.bool,
      value: true,
      isVisible: true,
      children: [],
      help: "",
      range: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    
    const option2: Menu = {
      id: "choice-option2",
      name: "CONFIG_EXAMPLE_CHOICE_OPTION2",
      title: "Option 2",
      type: menuType.bool,
      value: false,
      isVisible: true,
      children: [],
      help: "",
      range: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    
    choiceConfig.children = [option1, option2];
    items.push(choiceConfig);

    // Submenu example
    const submenu: Menu = {
      id: "submenu-example",
      name: "SUBMENU_EXAMPLE",
      title: "Example Submenu",
      type: menuType.menu,
      isVisible: true,
      children: this.createSubMenuItems(),
      help: "",
      range: [],
      isCollapsed: false,
      value: null,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    items.push(submenu);

    return items;
  }

  private createSubMenuItems(): Menu[] {
    const items: Menu[] = [];

    const subBoolConfig: Menu = {
      id: "sub-bool-example",
      name: "CONFIG_SUB_EXAMPLE_BOOL",
      title: "Sub Example Bool",
      type: menuType.bool,
      value: false,
      help: "This is a demo boolean configuration in a submenu.",
      isVisible: true,
      children: [],
      range: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    items.push(subBoolConfig);

    const subStringConfig: Menu = {
      id: "sub-string-example",
      name: "CONFIG_SUB_EXAMPLE_STRING",
      title: "Sub Example String",
      type: menuType.string,
      value: "submenu-default",
      help: "This is a demo string configuration in a submenu.",
      isVisible: true,
      children: [],
      range: [],
      isCollapsed: false,
      dependsOn: "",
      isMenuconfig: false,
      select: [],
      selectedBy: [],
      hasPrompt: true
    };
    items.push(subStringConfig);

    return items;
  }
}
