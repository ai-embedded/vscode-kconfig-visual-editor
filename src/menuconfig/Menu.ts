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

export enum menuType {
  string = "string",
  bool = "bool",
  tristate = "tristate",
  int = "int",
  choice = "choice",
  hex = "hex",
  menu = "menu",
  comment = "comment",
}

export interface Menu {
  children: Menu[];
  help: string;
  id: string;
  name: string;
  range: number[];
  title: string;
  type: menuType;
  isVisible: boolean;
  isCollapsed: boolean;
  value: any;
  dependsOn: string;
  isMenuconfig: boolean;
  // Kconfig visibility - true if this config has a prompt (can be shown to user)
  hasPrompt: boolean;         // Whether this config has a prompt (determines base visibility according to Kconfig spec)
  // Select functionality
  select: string[];           // Configuration items to automatically select when this item is selected
  selectConditions?: { [target: string]: string }; // Conditions for each select statement (e.g., "select TARGET if CONDITION")
  selectedBy: string[];       // Configuration items that select this item
  // UI state for select functionality
  isReadonly?: boolean;       // Whether this item is readonly due to being selected by others
  readonlyReason?: string;    // Explanation of why this item is readonly
  autoSelectedValue?: boolean; // Whether the current value was set automatically by select statements
  autoSelectedPreviousValue?: boolean | string | number; // 记录被自动选择前的原始值
  autoSelectedPreviousWasDefault?: boolean; // 记录原值是否来自 default
  isDefaultValue?: boolean;    // Whether current值来自 default 语义（用于后续重算）
  // Source file tracking
  sourceFiles?: string[];      // List of files included via source/rsource/osource/orsource directives
  sourceFile?: string;         // The file this menu was sourced from (if any)
  // Indent level for visual hierarchy (e.g., items within if blocks)
  indentLevel?: number;        // Indentation level for UI display (0 = no indent, 1 = first level, etc.)
  // Controls whether children should be indented in the UI
  shouldIndentChildren?: boolean; // True for implicit menus (config with children but not menuconfig), false for normal menus
  // Implicit container handling - for configs without prompt but with visible children
  isImplicitContainer?: boolean; // True for configs that have no prompt but have visible children (like RT_USING_USER_MAIN)
  isContainerVisible?: boolean; // True if this item should act as a visible container for its children (even if the item itself is not visible)
  // Conditional default values
  defaults?: Array<{ value: any; condition?: string }>; // List of default values with optional conditions
  optionEnvVar?: string | null;
  optionDefconfigList?: boolean;
  optionModules?: boolean;
  implies?: string[];
  implyConditions?: { [target: string]: string };
  autoImpliedValue?: 'y' | 'm' | boolean;
  allowedTristateValues?: Array<'n' | 'm' | 'y'>;
  
  // Main menu marker
  isMainMenu?: boolean;        // True when this menu represents the top-level mainmenu container

  // Enhanced help information (matching Kconfiglib's help display)
  linenr?: number;              // Line number where this config is defined
  menuPath?: string;            // Full menu path (e.g., "(Top) -> RT-Thread Kernel")
  directDepValue?: string;      // Evaluated value of direct dependencies (e.g., "=y")
  directDepExpr?: string;       // Direct dependency expression in readable format
  prompt?: string;              // Prompt text (usually same as title, but kept for compatibility)
  selectInfo?: string;          // Information about what this symbol selects
  selectedByInfo?: string;      // Information about what selects this symbol
  implyInfo?: string;           // Information about what this symbol implies
}
