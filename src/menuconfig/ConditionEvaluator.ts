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

import { Logger } from "../logger/logger";

/**
 * Configuration context that stores current values of all config items
 */
export interface ConfigContext {
    [configName: string]: any;
}

/**
 * Abstract syntax tree node for condition expressions
 */
export interface ConditionNode {
    type: 'AND' | 'OR' | 'NOT' | 'VARIABLE' | 'COMPARISON' | 'LITERAL';
    left?: ConditionNode;
    right?: ConditionNode;
    value?: string | number | boolean;
    operator?: '=' | '!=' | '>' | '<' | '>=' | '<=';
    variable?: string;
    literalKind?: 'string' | 'number' | 'hex' | 'boolean' | 'tristate';
    rawValue?: string;
}

/**
 * Condition expression evaluator for Kconfig
 * Supports:
 * - Boolean operations: &&, ||, !
 * - Comparisons: =, !=, >, <, >=, <=
 * - Variable references
 * - Literal values (strings, numbers, booleans)
 */
export class ConditionEvaluator {
    private context: ConfigContext;

    constructor(context: ConfigContext = {}) {
        this.context = context;
    }

    /**
     * Update the configuration context
     */
    public updateContext(newContext: ConfigContext): void {
        this.context = { ...this.context, ...newContext };
    }

    /**
     * Set a single configuration value
     */
    public setValue(configName: string, value: any): void {
        this.context[configName] = value;
    }

    /**
     * Get a configuration value
     */
    public getValue(configName: string): any {
        return this.context[configName];
    }

    /**
     * Parse and evaluate a condition expression
     */
    public evaluate(expression: string): boolean {
        if (!expression || expression.trim() === '') {
            return true; // Empty condition is always true
        }

        try {
            const ast = this.parseExpression(expression.trim());
            return this.evaluateNode(ast);
        } catch (error) {
            Logger.warn(`Failed to evaluate condition: ${expression}. Error: ${error}`);
            return true; // Default to visible if evaluation fails
        }
    }

    /**
     * Parse condition expression into AST
     */
    private parseExpression(expression: string): ConditionNode {
        // Logger.debug(`[PARSE_EXPR] Input expression: "${expression}"`);
        
        // Remove outer parentheses if they wrap the entire expression
        const cleanedExpression = this.removeOuterParentheses(expression);
        // Logger.debug(`[PARSE_EXPR] After removeOuterParentheses: "${cleanedExpression}"`);
        expression = cleanedExpression;
        
        // Parse OR expressions (lowest precedence)
        const orMatch = this.findOperator(expression, '||');
        if (orMatch) {
            // Logger.debug(`[PARSE_EXPR] Found OR operator, left="${orMatch.left}", right="${orMatch.right}"`);
            return {
                type: 'OR',
                left: this.parseExpression(orMatch.left),
                right: this.parseExpression(orMatch.right)
            };
        }

        // Parse AND expressions
        const andMatch = this.findOperator(expression, '&&');
        if (andMatch) {
            // Logger.debug(`[PARSE_EXPR] Found AND operator, left="${andMatch.left}", right="${andMatch.right}"`);
            return {
                type: 'AND',
                left: this.parseExpression(andMatch.left),
                right: this.parseExpression(andMatch.right)
            };
        }

        // Parse NOT expressions
        if (expression.startsWith('!')) {
            return {
                type: 'NOT',
                left: this.parseExpression(expression.substring(1).trim())
            };
        }

        // Parse comparison expressions
        const comparisonMatch = this.findComparison(expression);
        if (comparisonMatch) {
            return {
                type: 'COMPARISON',
                left: this.parseExpression(comparisonMatch.left),
                right: this.parseExpression(comparisonMatch.right),
                operator: comparisonMatch.operator as any
            };
        }

        // Parse literals and variables
        return this.parseLiteral(expression);
    }

    /**
     * Remove outer parentheses if they wrap the entire expression
     */
    private removeOuterParentheses(expression: string): string {
        let trimmed = expression.trim();

        while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
            let depth = 0;
            let canStrip = true;

            for (let i = 0; i < trimmed.length; i++) {
                const ch = trimmed[i];

                if (ch === '(') {
                    depth++;
                } else if (ch === ')') {
                    depth--;
                    if (depth === 0 && i < trimmed.length - 1) {
                        canStrip = false;
                        break;
                    }
                }
            }

            if (!canStrip) {
                break;
            }

            trimmed = trimmed.substring(1, trimmed.length - 1).trim();
        }

        return trimmed;
    }

    /**
     * Find operator at the top level (not inside parentheses)
     */
    private findOperator(expression: string, operator: string): { left: string; right: string } | null {
        // Logger.debug(`[FIND_OP] Looking for "${operator}" in "${expression}"`);
        let depth = 0;
        let lastFoundIndex = -1;

        // 从左向右扫描，正确处理括号嵌套
        for (let i = 0; i < expression.length - operator.length + 1; i++) {
            if (expression[i] === '(') {
                depth++;
                // Logger.debug(`[FIND_OP] At index ${i}, char='(', depth=${depth}`);
            } else if (expression[i] === ')') {
                depth--;
                // Logger.debug(`[FIND_OP] At index ${i}, char=')', depth=${depth}`);
            } else if (depth === 0 && expression.substring(i, i + operator.length) === operator) {
                // Logger.debug(`[FIND_OP] Found "${operator}" at index ${i}, depth=${depth}`);
                lastFoundIndex = i;
                // 继续寻找最后一个操作符（优先右结合）
            }
        }

        if (lastFoundIndex !== -1) {
            const result = {
                left: expression.substring(0, lastFoundIndex).trim(),
                right: expression.substring(lastFoundIndex + operator.length).trim()
            };
            // Logger.debug(`[FIND_OP] Split: left="${result.left}", right="${result.right}"`);
            return result;
        }

        // Logger.debug(`[FIND_OP] Operator "${operator}" not found`);
        return null;
    }

    /**
     * Find comparison operator at the top level
     */
    private findComparison(expression: string): { left: string; right: string; operator: string } | null {
        const operators = ['!=', '>=', '<=', '=', '>', '<'];
        
        for (const op of operators) {
            let depth = 0;
            let lastFoundIndex = -1;

            for (let i = expression.length - op.length; i >= 0; i--) {
                if (expression[i] === ')') {
                    depth++;
                } else if (expression[i] === '(') {
                    depth--;
                } else if (depth === 0 && expression.substring(i, i + op.length) === op) {
                    lastFoundIndex = i;
                    break;
                }
            }

            if (lastFoundIndex !== -1) {
                return {
                    left: expression.substring(0, lastFoundIndex).trim(),
                    right: expression.substring(lastFoundIndex + op.length).trim(),
                    operator: op
                };
            }
        }

        return null;
    }

    /**
     * Parse literal values and variables
     */
    private parseLiteral(expression: string): ConditionNode {
        expression = expression.trim();

        // String literal
        if (expression.startsWith('"') && expression.endsWith('"')) {
            return {
                type: 'LITERAL',
                value: expression.substring(1, expression.length - 1),
                literalKind: 'string',
                rawValue: expression
            };
        }

        // Number literal
        if (/^-?\d+$/.test(expression)) {
            return {
                type: 'LITERAL',
                value: parseInt(expression),
                literalKind: 'number',
                rawValue: expression
            };
        }

        // Hex literal
        if (/^0x[0-9a-fA-F]+$/.test(expression)) {
            return {
                type: 'LITERAL',
                value: parseInt(expression, 16),
                literalKind: 'hex',
                rawValue: expression
            };
        }

        // Boolean literals
        if (expression === 'm' || expression === 'M') {
            return {
                type: 'LITERAL',
                value: 'm',
                literalKind: 'tristate',
                rawValue: expression
            };
        }

        if (expression === 'y' || expression === 'true') {
            return {
                type: 'LITERAL',
                value: true,
                literalKind: expression === 'y' ? 'tristate' : 'boolean',
                rawValue: expression
            };
        }

        if (expression === 'n' || expression === 'false') {
            return {
                type: 'LITERAL',
                value: false,
                literalKind: expression === 'n' ? 'tristate' : 'boolean',
                rawValue: expression
            };
        }

        // Variable reference
        return {
            type: 'VARIABLE',
            variable: expression
        };
    }

    /**
     * Evaluate AST node
     */
    private evaluateNode(node: ConditionNode): boolean {
        switch (node.type) {
            case 'AND':
                return this.evaluateNode(node.left!) && this.evaluateNode(node.right!);
            
            case 'OR':
                return this.evaluateNode(node.left!) || this.evaluateNode(node.right!);
            
            case 'NOT':
                return !this.evaluateNode(node.left!);
            
            case 'COMPARISON':
                return this.evaluateComparison(node);
            
            case 'VARIABLE':
                return this.evaluateVariable(node.variable!);
            
            case 'LITERAL':
                return this.toLiteral(node.value!);
            
            default:
                Logger.warn(`Unknown node type: ${node.type}`);
                return true;
        }
    }

    /**
     * Evaluate comparison node
     */
    private evaluateComparison(node: ConditionNode): boolean {
        const leftValue = this.getNodeValue(node.left!);
        const rightValue = this.getNodeValue(node.right!);

        const { left: leftNormalized, right: rightNormalized } = this.normalizeComparisonOperands(
            leftValue,
            rightValue,
            node.left!,
            node.right!
        );

        switch (node.operator) {
            case '=':
                return leftNormalized === rightNormalized;
            case '!=':
                return leftNormalized !== rightNormalized;
            case '>':
                return this.toNumber(leftNormalized) > this.toNumber(rightNormalized);
            case '<':
                return this.toNumber(leftNormalized) < this.toNumber(rightNormalized);
            case '>=':
                return this.toNumber(leftNormalized) >= this.toNumber(rightNormalized);
            case '<=':
                return this.toNumber(leftNormalized) <= this.toNumber(rightNormalized);
            default:
                Logger.warn(`Unknown comparison operator: ${node.operator}`);
                return true;
        }
    }

    /**
     * Get the actual value from a node
     */
    private getNodeValue(node: ConditionNode): any {
        switch (node.type) {
            case 'VARIABLE':
                return this.context[node.variable!];
            case 'LITERAL':
                return node.value;
            default:
                return this.evaluateNode(node);
        }
    }

    /**
     * Evaluate variable reference
     */
    private evaluateVariable(variable: string): boolean {
        const value = this.context[variable];
        // Logger.debug(`[EVALUATOR] Variable ${variable} = ${value} (type: ${typeof value})`);
        const result = this.toBoolean(value);
        // Logger.debug(`[EVALUATOR] toBoolean(${value}) = ${result}`);
        return result;
    }

    /**
     * Convert value to boolean
     */
    private toBoolean(value: any): boolean {
        if (value === undefined || value === null) {
            return false;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            return value !== 0;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed === '') {
                return false;
            }

            const lower = trimmed.toLowerCase();
            if (lower === 'y' || lower === 'yes' || lower === 'true' || lower === 'on') {
                return true;
            }
            if (lower === 'm') {
                return true;
            }
            if (lower === 'n' || lower === 'no' || lower === 'false' || lower === 'off') {
                return false;
            }

            if (/^0x[0-9a-f]+$/i.test(trimmed)) {
                return parseInt(trimmed, 16) !== 0;
            }
            if (/^-?\d+$/.test(trimmed)) {
                return parseInt(trimmed, 10) !== 0;
            }

            return true;
        }
        return Boolean(value);
    }

    /**
     * Convert value to literal boolean
     */
    private toLiteral(value: any): boolean {
        if (typeof value === 'boolean') {
            return value;
        }
        return this.toBoolean(value);
    }

    /**
     * Convert value to number
     */
    private toNumber(value: any): number {
        if (typeof value === 'number') {
            return value;
        }
        if (typeof value === 'string') {
            const lower = value.toLowerCase();
            if (lower === 'y') {
                return 2;
            }
            if (lower === 'm') {
                return 1;
            }
            if (lower === 'n') {
                return 0;
            }
            if (value.startsWith('0x')) {
                return parseInt(value, 16);
            }
            return parseInt(value) || 0;
        }
        if (typeof value === 'boolean') {
            return value ? 1 : 0;
        }
        return 0;
    }

    private normalizeComparisonValue(value: any, options?: { forceString?: boolean }): any {
        if (value === undefined || value === null) {
            return value;
        }
        if (typeof value === 'boolean') {
            return value ? 'y' : 'n';
        }
        if (typeof value === 'number') {
            return value;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (options?.forceString) {
                return trimmed;
            }
            const lower = trimmed.toLowerCase();

            if (lower === 'y' || lower === 'm' || lower === 'n') {
                return lower;
            }
            if (lower === 'true') {
                return 'y';
            }
            if (lower === 'false') {
                return 'n';
            }

            const numericCandidate = this.tryConvertStringToNumber(trimmed);
            if (numericCandidate !== null) {
                return numericCandidate;
            }

            return trimmed;
        }
        return value;
    }

    private normalizeComparisonOperands(left: any, right: any, leftNode: ConditionNode, rightNode: ConditionNode): { left: any; right: any } {
        const leftIsPlainString = this.isPlainStringValue(left);
        const rightIsPlainString = this.isPlainStringValue(right);
        const treatAsString = this.isStringLiteral(leftNode) || this.isStringLiteral(rightNode);
        const forceString = treatAsString || leftIsPlainString || rightIsPlainString;

        let leftNormalized = this.normalizeComparisonValue(left, { forceString });
        let rightNormalized = this.normalizeComparisonValue(right, { forceString });

        if (leftIsPlainString && typeof rightNormalized === 'number') {
            rightNormalized = this.numericLiteralToString(rightNode, rightNormalized);
        }
        if (rightIsPlainString && typeof leftNormalized === 'number') {
            leftNormalized = this.numericLiteralToString(leftNode, leftNormalized);
        }

        if (typeof leftNormalized === 'number' && this.isTristateString(rightNormalized)) {
            rightNormalized = this.tristateToNumber(rightNormalized);
        } else if (typeof rightNormalized === 'number' && this.isTristateString(leftNormalized)) {
            leftNormalized = this.tristateToNumber(leftNormalized);
        }

        return { left: leftNormalized, right: rightNormalized };
    }

    private isPlainStringValue(value: any): boolean {
        if (typeof value !== 'string') {
            return false;
        }
        const trimmed = value.trim();
        const lower = trimmed.toLowerCase();
        if (lower === 'y' || lower === 'm' || lower === 'n') {
            return false;
        }
        if (lower === 'true' || lower === 'false' || lower === 'on' || lower === 'off') {
            return false;
        }
        if (this.tryConvertStringToNumber(trimmed) !== null) {
            return false;
        }
        return true;
    }

    private isTristateString(value: any): value is string {
        if (typeof value !== 'string') {
            return false;
        }
        const lower = value.toLowerCase();
        return lower === 'y' || lower === 'm' || lower === 'n';
    }

    private isStringLiteral(node: ConditionNode | undefined): boolean {
        if (!node) {
            return false;
        }
        return node.type === 'LITERAL' && node.literalKind === 'string';
    }

    private numericLiteralToString(node: ConditionNode | undefined, value: number): string {
        if (node && node.type === 'LITERAL') {
            if (node.literalKind === 'hex' && node.rawValue) {
                return node.rawValue;
            }
            if (node.literalKind === 'number' && node.rawValue) {
                return node.rawValue;
            }
        }
        return String(value);
    }

    private tryConvertStringToNumber(value: string): number | null {
        if (value === '') {
            return null;
        }

        const sign = value.startsWith('-') ? -1 : 1;
        const unsigned = (value[0] === '+' || value[0] === '-') ? value.substring(1) : value;

        if (unsigned === '') {
            return null;
        }

        if (/^0[xX][0-9a-fA-F]+$/.test(unsigned)) {
            return sign * parseInt(unsigned.substring(2), 16);
        }

        if (/^0[bB][01]+$/.test(unsigned)) {
            return sign * parseInt(unsigned.substring(2), 2);
        }

        if (/^0[oO][0-7]+$/.test(unsigned)) {
            return sign * parseInt(unsigned.substring(2), 8);
        }

        if (/^0+$/.test(unsigned)) {
            return 0;
        }

        if (/^[1-9][0-9]*$/.test(unsigned)) {
            return sign * parseInt(unsigned, 10);
        }

        return null;
    }

    private tristateToNumber(value: string): number {
        const lower = value.toLowerCase();
        if (lower === 'y') {
            return 2;
        }
        if (lower === 'm') {
            return 1;
        }
        return 0;
    }
}
