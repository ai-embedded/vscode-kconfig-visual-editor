// Kconfig-editor for VSCode
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

import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  InitializeParams,
  ProposedFeatures,
  TextDocumentPositionParams,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Stack } from "../utils/stack";

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
let _hasDiagnosticRelatedInfoCapability: boolean = false;
const problemSourceName = "kconfig";

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  hasConfigCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );

  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  _hasDiagnosticRelatedInfoCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  return {
    capabilities: {
      completionProvider: {
        resolveProvider: true,
      },
      textDocumentSync: 1, // TextDocumentSyncKind.Full
    },
  };
});

connection.onInitialized(() => {
  if (hasConfigCapability) {
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      // Workspace folder change received
    });
  }
});

// Kconfig Settings interface
interface IKconfigSettings {
  enableValidation: boolean;
}

const defaultSettings: IKconfigSettings = {
  enableValidation: true,
};
let globalSettings: IKconfigSettings = defaultSettings;

// Cache of open documents settings
const docsSettings: Map<string, Thenable<IKconfigSettings>> = new Map();

connection.onDidChangeConfiguration((change) => {
  if (hasConfigCapability) {
    docsSettings.clear();
  } else {
    globalSettings = (change.settings.kconfig ||
      defaultSettings) as IKconfigSettings;
  }
  documents.all().forEach(validateKConfigDocument);
});

function getDocumentsSettings(resource: string): Thenable<IKconfigSettings> {
  if (!hasConfigCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = docsSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: "kconfig",
    });
    docsSettings.set(resource, result);
  }
  return result;
}

documents.onDidClose((e) => {
  docsSettings.delete(e.document.uri);
});

// The document content has changed, which triggers the next method
documents.onDidChangeContent((change) => {
  validateKConfigDocument(change.document);
});

async function validateKConfigDocument(
  kconfigDocument: TextDocument
): Promise<void> {
  // This method would perform a lot of syntax validation ensuring file is ok.
  // const settings = await getDocumentsSettings(kconfigDocument.uri);

  const menuPattern = /^(\s*)\bmenu\b/g;
  const endmenuPattern = /^(\s*)\bendmenu\b/gm;

  const choicePattern = /^(\s*)\bchoice\b/g;
  const endChoicePattern = /^(\s*)\bendchoice\b/gm;

  const settings = await getDocumentsSettings(kconfigDocument.uri);

  const diagnostics: Diagnostic[] = [];

  diagnostics.push(
    ...getBlockDiagnosticsFor(menuPattern, endmenuPattern, kconfigDocument, [
      "menu",
      "endmenu",
    ])
  );
  diagnostics.push(
    ...getBlockDiagnosticsFor(
      choicePattern,
      endChoicePattern,
      kconfigDocument,
      ["choice", "enchoice"]
    )
  );

  // Use enhanced validation if enabled
  if (settings.enableValidation) {
    const stringDiagnostics = getStringDiagnostics(kconfigDocument);
    const lineDiagnostics = getLineDiagnostics(kconfigDocument);
    const indentDiagnostics = getTreeIndentDiagnostics(kconfigDocument);

    // 只保留错误和警告，过滤掉 Information 和 Hint 级别
    const filteredStringDiagnostics = stringDiagnostics.filter(d =>
      d.severity === DiagnosticSeverity.Error || d.severity === DiagnosticSeverity.Warning
    );
    const filteredLineDiagnostics = lineDiagnostics.filter(d =>
      d.severity === DiagnosticSeverity.Error || d.severity === DiagnosticSeverity.Warning
    );
    const filteredIndentDiagnostics = indentDiagnostics.filter(d =>
      d.severity === DiagnosticSeverity.Error || d.severity === DiagnosticSeverity.Warning
    );

    diagnostics.push(...filteredStringDiagnostics);
    diagnostics.push(...filteredLineDiagnostics);
    diagnostics.push(...filteredIndentDiagnostics);

    // 空块检查仍然禁用，因为容易误报
    // diagnostics.push(...getEmptyBlocksDiagnostics(kconfigDocument));
  }

  connection.sendDiagnostics({ uri: kconfigDocument.uri, diagnostics });
}

function getLineDiagnostics(kconfigDocument: TextDocument) {
  const MAX_LINE_SIZE = 300; // 进一步放宽行长度限制
  const text = kconfigDocument.getText();
  const diagnostics: Diagnostic[] = [];
  const lines = text.split("\n");
  let textPosition = 0;
  let lineNum = 0;
  let inHelpBlock = false;

  for (const line of lines) {
    lineNum += 1;
    
    // 检查是否进入或离开 help 块
    if (line.trim() === "help" || line.trim() === "---help---") {
      inHelpBlock = true;
    } else if (inHelpBlock && line.trim().length > 0 && !line.startsWith("  ") && !line.startsWith("\t")) {
      inHelpBlock = false;
    }
    
    // 在 help 块内跳过大多数检查
    if (inHelpBlock) {
      textPosition += line.length + "\n".length;
      continue;
    }
    
    // 只对极长的行进行提醒
    if (line.length > MAX_LINE_SIZE) {
      const diagnostic: Diagnostic = {
        message: `Line ${lineNum} is extremely long (${line.length} chars).`,
        range: {
          end: kconfigDocument.positionAt(textPosition + line.length),
          start: kconfigDocument.positionAt(textPosition),
        },
        severity: DiagnosticSeverity.Hint, // 降低到最低级别
        source: `${problemSourceName}`,
      };
      diagnostics.push(diagnostic);
    }

    // 移除反斜杠检查，因为它们在 Kconfig 中是合法的
    
    // 尾随空格检查 - 只对非空行且非注释行进行检查
    const hasTrailingSpace = line.length > 0 && line[line.length - 1] === " ";
    if (hasTrailingSpace && line.trim().length > 0 && !line.trim().startsWith("#")) {
      // 进一步降低严重级别，只作为最轻微的提示
      // 实际上，我们可以完全跳过这个检查，因为尾随空格在很多情况下是无害的
      // diagnostics.push(...) - 注释掉这个检查
    }

    textPosition += line.length + "\n".length;
  }

  return diagnostics;
}

function getTreeIndentDiagnostics(kconfigDocument: TextDocument) {
  const indentSize = 4; // connection.workspace.getConfiguration("editor.tabSize");
  const text = kconfigDocument.getText();
  const diagnostics: Diagnostic[] = [];

  const lines = text.split("\n");
  let textPosition = 0;
  const parentStack = new Stack();
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    const indentRegex = /^(?!=\n)([ ]+)/g;
    const lineMatch = indentRegex.exec(line);
    // 扩展关键字识别，包含完整的 Kconfig 语法
    const openingMatches = /^(\s*)\b(menu|choice|config|menuconfig|endmenu|endchoice|help|mainmenu|bool|tristate|string|hex|int|default|select|depends|range|prompt|visible|source|rsource|osource|orsource|comment|if|endif)\b/g.exec(
      line
    );

    // 简化堆栈管理逻辑，减少对正确语法的误报
    if (
      parentStack.size() > 0 &&
      openingMatches &&
      (openingMatches[0].trim() === "menu" ||
        openingMatches[0].trim() === "menuconfig" ||
        openingMatches[0].trim() === "choice" ||
        openingMatches[0].trim() === "config")
    ) {
      if (parentStack.peek() === "help") {
        parentStack.pop();
        if (parentStack.peek() !== "choice") {
          parentStack.pop();
        }
      } else if (
        parentStack.peek() === "config" ||
        parentStack.peek() === "menuconfig"
      ) {
        parentStack.pop();
      }
    } else if (
      parentStack.size() > 0 &&
      openingMatches &&
      (openingMatches[0].trim() === "endmenu" ||
        openingMatches[0].trim() === "endchoice" ||
        openingMatches[0].trim() === "endif")
    ) {
      while (parentStack.size() > 0) {
        const startingWord = parentStack.pop();
        if (
          (startingWord === "menu" && openingMatches[0].trim() === "endmenu") ||
          (startingWord === "choice" && openingMatches[0].trim() === "endchoice") ||
          (startingWord === "if" && openingMatches[0].trim() === "endif")
        ) {
          break;
        }
      }
    }

    // 进一步放宽缩进检查，只对严重的缩进错误报警
    // 对于 config 属性和 help 文本，允许更灵活的缩进
    const isConfigAttribute = openingMatches && (
      openingMatches[0].trim() === "bool" ||
      openingMatches[0].trim() === "tristate" ||
      openingMatches[0].trim() === "string" ||
      openingMatches[0].trim() === "hex" ||
      openingMatches[0].trim() === "int" ||
      openingMatches[0].trim() === "default" ||
      openingMatches[0].trim() === "select" ||
      openingMatches[0].trim() === "depends" ||
      openingMatches[0].trim() === "range" ||
      openingMatches[0].trim() === "prompt" ||
      openingMatches[0].trim() === "visible"
    );
    
    // 进一步放宽缩进检查条件
    const shouldCheckIndent = lineMatch && 
      !isConfigAttribute && // 不对 config 属性进行缩进检查
      parentStack.peek() !== "help" && // 不对 help 文本进行严格缩进检查
      line.trim().length > 0 && // 跳过空行
      !line.startsWith('#'); // 跳过注释行
    
    if (shouldCheckIndent) {
      // 只有缩进差异很大时才报警（超过2个缩进级别的差异）
      const expectedIndent = indentSize * parentStack.size();
      const actualIndent = lineMatch[1].length;
      const indentDiff = Math.abs(actualIndent - expectedIndent);
      
      if (indentDiff > indentSize * 2) {
        const diagnostic: Diagnostic = {
          message: `Line ${lineNum} indentation seems unusual (${actualIndent} spaces, expected around ${expectedIndent})`,
          range: {
            end: kconfigDocument.positionAt(
              textPosition + lineMatch.index + lineMatch[1].length
            ),
            start: kconfigDocument.positionAt(textPosition),
          },
          severity: DiagnosticSeverity.Hint, // 进一步降低严重级别
          source: `${problemSourceName}`,
        };
        diagnostics.push(diagnostic);
      }
    }

    if (openingMatches) {
      const keyword = openingMatches[0].trim();
      // 只有这些关键字需要管理缩进层级
      if (
        keyword === "menu" ||
        keyword === "choice" ||
        keyword === "config" ||
        keyword === "menuconfig" ||
        keyword === "help" ||
        keyword === "if"
      ) {
        parentStack.push(keyword);
      }
    }

    textPosition += line.length + "\n".length;
  }
  return diagnostics;
}

function getStringDiagnostics(kconfigDocument: TextDocument): Diagnostic[] {
  // 进一步限制字符串检查，避免对正常语法的误报
  const text = kconfigDocument.getText();
  const lines = text.split("\n");
  const diagnostics: Diagnostic[] = [];
  let textPosition = 0;
  let inHelpBlock = false;

  for (const line of lines) {
    // 跳过 help 文本块内的所有行
    if (line.trim() === "help" || line.trim() === "---help---") {
      inHelpBlock = true;
      textPosition += line.length + "\n".length;
      continue;
    }
    
    // 检查是否离开 help 块
    if (inHelpBlock && line.trim().length > 0 && !line.startsWith("  ") && !line.startsWith("\t")) {
      inHelpBlock = false;
    }
    
    // 在 help 块内则跳过所有检查
    if (inHelpBlock) {
      textPosition += line.length + "\n".length;
      continue;
    }
    
    // 只对真正必须有字符串参数且格式明显错误的行进行检查
    const requiredKeyPattern = /^(\s*)\b(menu|mainmenu)\s*$/g;
    const keyMatch = requiredKeyPattern.exec(line);
    
    if (keyMatch !== null) {
      const keyword = keyMatch[0].trim();
      // 只对 menu 和 mainmenu 进行严格检查，且仅当行末没有字符串时
      const diagnostic: Diagnostic = {
        message: `${keyword} requires a quoted string parameter`,
        range: {
          end: kconfigDocument.positionAt(textPosition + line.length),
          start: kconfigDocument.positionAt(
            textPosition + keyMatch.index + keyMatch[1].length
          ),
        },
        severity: DiagnosticSeverity.Hint, // 进一步降低严重级别
        source: `${problemSourceName}`,
      };
      diagnostics.push(diagnostic);
    }
    
    textPosition += line.length + "\n".length;
  }

  return diagnostics;
}

function getBlockDiagnosticsFor(
  openingPattern: RegExp,
  closingPattern: RegExp,
  kconfigDocument: TextDocument,
  blockName: string[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const openIndices = [];
  const closeIndices = [];
  const text = kconfigDocument.getText();
  let openMatch = openingPattern.exec(text);
  const openWordLength = blockName[0].length;
  let closeMatch = closingPattern.exec(text);

  while (openMatch !== null) {
    openIndices.push(openMatch.index);
    openMatch = openingPattern.exec(text);
  }

  while (closeMatch !== null) {
    closeIndices.push(closeMatch.index);
    closeMatch = closingPattern.exec(text);
  }

  for (let i = 0; i < openIndices.length; i++) {
    if (closeIndices.length === 0) {
      const diagnostic: Diagnostic = {
        message: `${blockName[0]} statement doesn't have corresponding ${blockName[1]}`,
        range: {
          end: kconfigDocument.positionAt(openIndices[i] + openWordLength),
          start: kconfigDocument.positionAt(openIndices[i]),
        },
        severity: DiagnosticSeverity.Error,
        source: `${problemSourceName}`,
      };
      diagnostics.push(diagnostic);
      continue;
    }

    let isCloseFound = false;
    for (const closingIndex of closeIndices) {
      if (closingIndex > openIndices[i] && closingIndex < openIndices[i + 1]) {
        isCloseFound = true;
        break;
      } else if (
        i === openIndices.length - 1 &&
        closingIndex > openIndices[i]
      ) {
        isCloseFound = true;
        break;
      }
    }
    if (!isCloseFound) {
      const diagnostic: Diagnostic = {
        message: `${blockName[0]} statement doesn't have corresponding ${blockName[1]}`,
        range: {
          end: kconfigDocument.positionAt(openIndices[i] + openWordLength),
          start: kconfigDocument.positionAt(openIndices[i]),
        },
        severity: DiagnosticSeverity.Error,
        source: `${problemSourceName}`,
      };
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

function _getEmptyBlocksDiagnostics(
  kconfigDocument: TextDocument
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const menuPattern = /^menu "(.*)"\s*([\s\S]+?)endmenu$/gm;
  const choicePattern = /^choice (.*)([\s\S]+?)endchoice$/gm;
  const ifBlockPattern = /^if (.*)([\s\S]+?)endif$/gm;
  const text = kconfigDocument.getText();
  let menuMatch = menuPattern.exec(text);
  let choiceMatch = choicePattern.exec(text);
  let ifBlockMatch = ifBlockPattern.exec(text);

  while (menuMatch !== null) {
    if (menuMatch[2] && menuMatch[2].length > 0 && menuMatch[2] === "\n") {
      const diagnostic: Diagnostic = {
        message: `menu statement doesn't have corresponding any sub-settings.`,
        range: {
          end: kconfigDocument.positionAt(
            menuMatch.index +
              `menu ""`.length +
              menuMatch[1].length +
              menuMatch[2].length
          ),
          start: kconfigDocument.positionAt(
            menuMatch.index + menuMatch[1].length
          ),
        },
        severity: DiagnosticSeverity.Error,
        source: `${problemSourceName}`,
      };
      diagnostics.push(diagnostic);
    }
    menuMatch = menuPattern.exec(text);
  }

  while (choiceMatch !== null) {
    if (
      choiceMatch[2] &&
      choiceMatch[2].length > 0 &&
      choiceMatch[2] === "\n"
    ) {
      const diagnostic: Diagnostic = {
        message: `choice statement doesn't have any config options.`,
        range: {
          end: kconfigDocument.positionAt(
            choiceMatch.index +
              `choice `.length +
              choiceMatch[1].length +
              choiceMatch[2].length
          ),
          start: kconfigDocument.positionAt(
            choiceMatch.index + choiceMatch[1].length
          ),
        },
        severity: DiagnosticSeverity.Error,
        source: `${problemSourceName}`,
      };
      diagnostics.push(diagnostic);
    }
    choiceMatch = choicePattern.exec(text);
  }

  while (ifBlockMatch !== null) {
    if (
      ifBlockMatch[2] &&
      ifBlockMatch[2].length > 0 &&
      ifBlockMatch[2] === "\n"
    ) {
      const diagnostic: Diagnostic = {
        message: `if statement doesn't have any config options.`,
        range: {
          end: kconfigDocument.positionAt(
            ifBlockMatch.index +
              `if `.length +
              ifBlockMatch[1].length +
              ifBlockMatch[2].length
          ),
          start: kconfigDocument.positionAt(
            ifBlockMatch.index + ifBlockMatch[1].length
          ),
        },
        severity: DiagnosticSeverity.Error,
        source: `${problemSourceName}`,
      };
      diagnostics.push(diagnostic);
    }
    ifBlockMatch = ifBlockPattern.exec(text);
  }

  return diagnostics;
}

// This handler provides a list of completion items
connection.onCompletion(
  (_kconfigDocumentPosition: TextDocumentPositionParams) => {
    return [
      {
        data: 1,
        kind: CompletionItemKind.Text,
        label: "config ",
      },
      {
        data: 2,
        kind: CompletionItemKind.Text,
        label: "menu ",
      },
      {
        data: 3,
        kind: CompletionItemKind.Text,
        label: "endmenu",
      },
      {
        data: 4,
        kind: CompletionItemKind.Text,
        label: "bool ",
      },
      {
        data: 5,
        kind: CompletionItemKind.Text,
        label: "depends on ",
      },
      {
        data: 6,
        kind: CompletionItemKind.Text,
        label: "help ",
      },
      {
        data: 7,
        kind: CompletionItemKind.Text,
        label: "hex ",
      },
      {
        data: 8,
        kind: CompletionItemKind.Text,
        label: "tristate ",
      },
      {
        data: 9,
        kind: CompletionItemKind.Text,
        label: "int ",
      },
      {
        data: 10,
        kind: CompletionItemKind.Text,
        label: "string ",
      },
      {
        data: 11,
        kind: CompletionItemKind.Text,
        label: "prompt ",
      },
      {
        data: 12,
        kind: CompletionItemKind.Text,
        label: "default ",
      },
      {
        data: 13,
        kind: CompletionItemKind.Text,
        label: "if ",
      },
      {
        data: 14,
        kind: CompletionItemKind.Text,
        label: "endif",
      },
      {
        data: 15,
        kind: CompletionItemKind.Text,
        label: "visible if ",
      },
      {
        data: 16,
        kind: CompletionItemKind.Text,
        label: "range ",
      },
      {
        data: 17,
        kind: CompletionItemKind.Text,
        label: "option ",
      },
      {
        data: 18,
        kind: CompletionItemKind.Text,
        label: "defconfig_list",
      },
      {
        data: 19,
        kind: CompletionItemKind.Text,
        label: "modules ",
      },
      {
        data: 20,
        kind: CompletionItemKind.Text,
        label: "allnoconfig_y",
      },
      {
        data: 21,
        kind: CompletionItemKind.Text,
        label: "menuconfig ",
      },
      {
        data: 22,
        kind: CompletionItemKind.Text,
        label: "comment ",
      },
      {
        data: 23,
        kind: CompletionItemKind.Text,
        label: "source ",
      },
      {
        data: 24,
        kind: CompletionItemKind.Text,
        label: "choice ",
      },
      {
        data: 25,
        kind: CompletionItemKind.Text,
        label: "endchoice",
      },
      {
        data: 26,
        kind: CompletionItemKind.Text,
        label: "mainmenu ",
      },
      {
        data: 27,
        kind: CompletionItemKind.Text,
        label: "rsource ",
      },
      {
        data: 28,
        kind: CompletionItemKind.Text,
        label: "osource ",
      },
      {
        data: 29,
        kind: CompletionItemKind.Text,
        label: "orsource ",
      },
    ];
  }
);

connection.onCompletionResolve(
  (item: CompletionItem): CompletionItem => {
    switch (item.data) {
      case 1:
        item.detail = "config <symbol>";
        item.documentation = "This defines a config symbol <symbol>.";
        break;
      case 2:
        item.detail = "menu <symbol>";
        item.documentation =
          "This defines a menu block <symbol>. Should end with 'endmenu'";
        break;
      case 21:
        item.detail = "menuconfig <symbol>";
        item.documentation =
          "Define a config entry <symbol> with frontend hint to separate suboptions.";
        break;
      case 24:
        item.detail = "choice <symbol>";
        item.documentation = `This defines a choice group <symbol> accepting config or menuconfig as options.
                    Should end with 'endchoice'`;
        break;
      case 22:
        item.detail = "comment <prompt>";
        item.documentation =
          "This defines a comment displayed to the user during configuration process.";
        break;
      case 13:
        item.detail = "if <expression>";
        item.documentation =
          "This defines an if block. Should end with 'endif'";
        break;
      case 23:
        item.detail = "source <prompt>";
        item.documentation =
          "This reads the specified configuration file. This file is always parsed.";
        break;
      case 26:
        item.detail = "mainmenu <prompt>";
        item.documentation =
          "This sets the config program's title bar if the config program chooses to use it.";
        break;
      case 27:
        item.detail = "rsource <prompt>";
        item.documentation =
          "This reads the specified configuration file using relative path. Path is relative to the directory of the current Kconfig file.";
        break;
      case 28:
        item.detail = "osource <prompt>";
        item.documentation =
          "This optionally reads the specified configuration file. If the file doesn't exist, no error is raised.";
        break;
      case 29:
        item.detail = "orsource <prompt>";
        item.documentation =
          "This optionally reads the specified configuration file using relative path. Path is relative to the directory of the current Kconfig file. If the file doesn't exist, no error is raised.";
        break;
      default:
        break;
    }
    return item;
  }
);

// Text document manager listens to connection for open change and close events
// of Kconfig document events
documents.listen(connection);

connection.listen();
