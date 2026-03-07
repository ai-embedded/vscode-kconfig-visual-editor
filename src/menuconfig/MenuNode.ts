// Copyright 2025 Kconfig VSCode Extension Contributors
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

import { Menu } from "./Menu";

/**
 * MenuNode represents a node in the Kconfig tree structure.
 * This is modeled after Kconfiglib's MenuNode class for compatibility.
 */
export class MenuNode {
    // Core properties matching Kconfiglib
    item: Menu | null = null;                       // Associated menu item (config/menuconfig/choice)
    prompt: [string, string] | null = null;         // [prompt text, condition]
    parent: MenuNode | null = null;                 // Parent node in the tree
    list: MenuNode | null = null;                   // First child node (linked list head)
    next: MenuNode | null = null;                   // Next sibling node
    dep: string | null = null;                      // Dependency condition expression (combined from all sources)
    explicit_dep: string | null = null;             // Explicit "depends on" from config definition (not from if blocks)
    if_dep: string | null = null;                   // Dependency from if blocks (only affects visibility, not menu structure)
    if_indent_level: number = 0;                    // Number of if blocks this node was nested in (for indentation)
    // Menu-only: 'visible if' condition
    visibility: string | null = null;               // Visibility condition for menu nodes (propagated to child prompts)
    
    // Node metadata
    is_menuconfig: boolean = false;                 // Whether this is a menuconfig node
    node_type: 'if' | 'menu' | 'config' | 'choice' | 'menuconfig' | 'comment' | null = null;
    
    // Source tracking
    filename: string | null = null;                 // Source file where this node was defined
    linenr: number = 0;                             // Line number in source file
    
    // For tracking next index during parsing (temporary field)
    nextIndex?: number;
    
    constructor() {
        // Initialize with null values, matching Kconfiglib's approach
    }
    
    /**
     * Add a child node to this node.
     * Maintains the linked list structure of children.
     */
    addChild(child: MenuNode): void {
        child.parent = this;
        
        if (!this.list) {
            // First child
            this.list = child;
        } else {
            // Find the last child and append
            let last = this.list;
            while (last.next) {
                last = last.next;
            }
            last.next = child;
        }
    }
    
    /**
     * Get all children as an array.
     * Converts the linked list to an array for easier manipulation.
     */
    getChildren(): MenuNode[] {
        const children: MenuNode[] = [];
        let child = this.list;
        while (child) {
            children.push(child);
            child = child.next;
        }
        return children;
    }
    
    /**
     * Calculate indentation level dynamically by traversing parent chain.
     * This matches Kconfiglib's dynamic indentation calculation.
     *
     * Key rules:
     * - Start from this node and traverse up the parent chain
     * - Stop when reaching the root
     * - Count nodes that create visual hierarchy (menu, menuconfig, implicit submenus)
     * - Add extra indentation for if blocks (stored in if_indent_level)
     * - Implicit submenus are config nodes with children
     */
    calculateIndent(): number {
        let indent = 0;
        let parent = this.parent;

        // Traverse up the parent chain to calculate full indentation
        while (parent) {
            // Skip the root menuconfig node (mainmenu) - it doesn't contribute to indent
            if (parent.node_type === 'menuconfig' && !parent.parent) {
                parent = parent.parent;
                continue;
            }

            // Count nodes that contribute to visual hierarchy:
            // - menu nodes create one level of indentation
            // - menuconfig nodes create one level of indentation
            // - config/choice nodes with children (implicit submenus) create one level
            // Note: if nodes should already be flattened and removed at this point
            if (parent.node_type === 'menu' ||
                parent.node_type === 'menuconfig' ||
                parent.is_menuconfig ||
                parent.node_type === 'choice' ||
                (parent.node_type === 'config' && parent.list !== null)) {
                indent++;
            }

            parent = parent.parent;
        }

        // 与 Kconfiglib 一致：if 层级不产生缩进，仅作为依赖传播
        return indent;
    }
    
    /**
     * Check if this node should be flattened.
     * Nodes without prompts (like if nodes) should be flattened,
     * UNLESS they are selected by other configs (implicit containers).
     */
    shouldFlatten(): boolean {
        // Flatten nodes that:
        // 1. Have children (list is not null)
        // 2. Have no prompt (not visible in menu)
        // 3. Are not Choice nodes (special case in Kconfiglib)
        // 4. Are not implicit containers (configs selected by others that need to maintain structure)
        
        // Check if this is an implicit container (selected config without prompt)
        const isImplicitContainer = this.item && 
                                   this.item.isImplicitContainer === true;
        
        return this.list !== null && 
               this.prompt === null && 
               this.node_type !== 'choice' &&
               !isImplicitContainer;
    }
    
    /**
     * Check if this is an if node.
     * if nodes are recognized by having no item and node_type === 'if'.
     */
    isIfNode(): boolean {
        return this.item === null && this.node_type === 'if';
    }
    
    /**
     * Clone this node (shallow copy).
     * Used during tree transformations.
     */
    clone(): MenuNode {
        const cloned = new MenuNode();
        cloned.item = this.item;
        cloned.prompt = this.prompt;
        cloned.dep = this.dep;
        cloned.is_menuconfig = this.is_menuconfig;
        cloned.node_type = this.node_type;
        cloned.filename = this.filename;
        cloned.linenr = this.linenr;
        // Note: parent, list, next are not cloned (tree structure needs to be rebuilt)
        return cloned;
    }
    
    /**
     * Debug helper: Get a string representation of this node.
     */
    toString(): string {
        if (this.item) {
            return `MenuNode(${this.node_type}: ${this.item.name || this.item.title})`;
        } else if (this.node_type === 'if') {
            return `MenuNode(if: ${this.dep})`;
        } else {
            return `MenuNode(${this.node_type})`;
        }
    }
    
    /**
     * Debug helper: Print the tree structure.
     */
    printTree(indent: number = 0): void {
        const _prefix = '  '.repeat(indent);
        // Logger.debugParser(`${prefix}${this.toString()}`);
        
        let child = this.list;
        while (child) {
            child.printTree(indent + 1);
            child = child.next;
        }
    }
}
