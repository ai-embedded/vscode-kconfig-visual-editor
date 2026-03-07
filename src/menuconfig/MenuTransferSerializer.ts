import { Menu } from "./Menu";

export interface MenuInitialPayload {
  id: string;
  name: string;
  title: string;
  type: Menu["type"];
  value: any;
  children: MenuInitialPayload[];
  isVisible?: boolean;
  isCollapsed?: boolean;
  isMenuconfig?: boolean;
  hasPrompt?: boolean;
  range?: number[];
  select?: string[];
  selectedBy?: string[];
  isReadonly?: boolean;
  readonlyReason?: string;
  isImplicitContainer?: boolean;
  isContainerVisible?: boolean;
  allowedTristateValues?: Array<"n" | "m" | "y">;
  autoSelectedValue?: boolean;
  autoImpliedValue?: "y" | "m" | boolean;
  isMainMenu?: boolean;
  indentLevel?: number;
  shouldIndentChildren?: boolean;
}

export interface MenuDetailPayload {
  help?: string;
  prompt?: string;
  directDepExpr?: string;
  directDepValue?: string;
  sourceFile?: string;
  sourceFiles?: string[];
  linenr?: number;
  menuPath?: string;
  dependsOn?: string;
  defaults?: Array<{ value: any; condition?: string }>;
  selectInfo?: string;
  selectedByInfo?: string;
  implyInfo?: string;
}

export interface MenuChunkTask {
  parentId: string;
  children: MenuInitialPayload[];
}

export function groupChunkTasksForBatches(
  tasks: MenuChunkTask[],
  batchSize: number
): MenuChunkTask[][] {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  const normalizedBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 16;
  const grouped: MenuChunkTask[][] = [];
  for (let i = 0; i < tasks.length; i += normalizedBatchSize) {
    grouped.push(tasks.slice(i, i + normalizedBatchSize));
  }
  return grouped;
}

function toInitialPayload(menu: Menu, children: MenuInitialPayload[] = []): MenuInitialPayload {
  return {
    id: menu.id,
    name: menu.name,
    title: menu.title,
    type: menu.type,
    value: menu.value,
    children,
    isVisible: menu.isVisible,
    isCollapsed: menu.isCollapsed,
    isMenuconfig: menu.isMenuconfig,
    hasPrompt: menu.hasPrompt,
    range: menu.range ? [...menu.range] : undefined,
    select: menu.select ? [...menu.select] : undefined,
    selectedBy: menu.selectedBy ? [...menu.selectedBy] : undefined,
    isReadonly: menu.isReadonly,
    readonlyReason: menu.readonlyReason,
    isImplicitContainer: menu.isImplicitContainer,
    isContainerVisible: menu.isContainerVisible,
    allowedTristateValues: menu.allowedTristateValues ? [...menu.allowedTristateValues] : undefined,
    autoSelectedValue: menu.autoSelectedValue,
    autoImpliedValue: menu.autoImpliedValue,
    isMainMenu: menu.isMainMenu,
    indentLevel: menu.indentLevel,
    shouldIndentChildren: menu.shouldIndentChildren,
  };
}

export function createInitialTransferMenus(menus: Menu[]): MenuInitialPayload[] {
  const convert = (menu: Menu): MenuInitialPayload => {
    const children = (menu.children || []).map((child) => convert(child));
    return toInitialPayload(menu, children);
  };
  return menus.map((menu) => convert(menu));
}

export function createMenuDetailPayload(menu: Menu): MenuDetailPayload {
  return {
    help: menu.help,
    prompt: menu.prompt,
    directDepExpr: menu.directDepExpr,
    directDepValue: menu.directDepValue,
    sourceFile: menu.sourceFile,
    sourceFiles: menu.sourceFiles ? [...menu.sourceFiles] : undefined,
    linenr: menu.linenr,
    menuPath: menu.menuPath,
    dependsOn: menu.dependsOn,
    defaults: menu.defaults ? menu.defaults.map((entry) => ({ ...entry })) : undefined,
    selectInfo: menu.selectInfo,
    selectedByInfo: menu.selectedByInfo,
    implyInfo: menu.implyInfo,
  };
}

export function splitMenusForChunkedTransfer(
  sourceMenus: Menu[],
  chunkSize: number
): { skeletonMenus: MenuInitialPayload[]; chunks: MenuChunkTask[] } {
  const normalizedChunkSize = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 20;
  const chunks: MenuChunkTask[] = [];
  const skeletonMenus = sourceMenus.map((menu) => toInitialPayload(menu, []));
  const queue: Menu[] = [...sourceMenus];

  while (queue.length > 0) {
    const parentMenu = queue.shift();
    if (!parentMenu || !parentMenu.id) {
      continue;
    }

    const children = parentMenu.children || [];
    if (children.length === 0) {
      continue;
    }

    const shallowChildren = children.map((child) => toInitialPayload(child, []));
    for (let i = 0; i < shallowChildren.length; i += normalizedChunkSize) {
      const chunkChildren = shallowChildren.slice(i, i + normalizedChunkSize);
      if (chunkChildren.length > 0) {
        chunks.push({
          parentId: parentMenu.id,
          children: chunkChildren,
        });
      }
    }

    for (const child of children) {
      queue.push(child);
    }
  }

  return { skeletonMenus, chunks };
}
