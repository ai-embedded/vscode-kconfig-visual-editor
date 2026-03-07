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
    private static readonly MAX_RESULT_CACHE_SIZE = 20000;
    private context: ConfigContext;
    private astCache: Map<string, ConditionNode> = new Map();
    private expressionVariableDeps: Map<string, string[]> = new Map();
    private evaluationCache: Map<string, { signature: string; result: boolean }> = new Map();
    private contextVersion: number = 0;
    private symbolVersions: Map<string, number> = new Map();

    constructor(context: ConfigContext = {}) {
        this.context = context;
    }

    /**
     * Update the configuration context
     */
    public updateContext(newContext: ConfigContext): void {
        let hasChanges = false;
        for (const [key, value] of Object.entries(newContext)) {
            if (!this.areValuesEqual(this.context[key], value)) {
                this.context[key] = value;
                hasChanges = true;
                this.bumpSymbolVersion(key);
            }
        }
        if (hasChanges) {
            this.contextVersion += 1;
        }
    }

    /**
     * Set a single configuration value
     */
    public setValue(configName: string, value: any): void {
        if (this.areValuesEqual(this.context[configName], value)) {
            return;
        }
        this.context[configName] = value;
        this.contextVersion += 1;
        this.bumpSymbolVersion(configName);
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
            const normalized = this.normalizeExpression(expression.trim());
            const ast = this.parseExpression(normalized);

            const deps = this.expressionVariableDeps.get(normalized) || [];
            const signature = this.buildExpressionSignature(deps);
            const cached = this.evaluationCache.get(normalized);
            if (cached && cached.signature === signature) {
                return cached.result;
            }

            const result = this.evaluateNode(ast);
            if (this.evaluationCache.size >= ConditionEvaluator.MAX_RESULT_CACHE_SIZE) {
                this.evaluationCache.clear();
            }
            this.evaluationCache.set(normalized, { signature, result });
            return result;
        } catch (error) {
            Logger.warn(`Failed to evaluate condition: ${expression}. Error: ${error}`);
            return true; // Default to visible if evaluation fails
        }
    }

    /**
     * Parse condition expression into AST
     */
    private parseExpression(expression: string): ConditionNode {
        const normalized = this.normalizeExpression(expression);

        if (normalized === '') {
            const literalTrue: ConditionNode = {
                type: 'LITERAL',
                value: true,
                literalKind: 'boolean',
                rawValue: 'true'
            };
            this.astCache.set(normalized, literalTrue);
            this.expressionVariableDeps.set(normalized, []);
            return literalTrue;
        }

        const cached = this.astCache.get(normalized);
        if (cached) {
            return cached;
        }

        // Parse OR expressions (lowest precedence)
        const orMatch = this.findOperator(normalized, '||');
        if (orMatch) {
            const result: ConditionNode = {
                type: 'OR',
                left: this.parseExpression(orMatch.left),
                right: this.parseExpression(orMatch.right)
            };
            this.astCache.set(normalized, result);
            this.expressionVariableDeps.set(normalized, this.collectVariableDeps(result));
            return result;
        }

        // Parse AND expressions
        const andMatch = this.findOperator(normalized, '&&');
        if (andMatch) {
            const result: ConditionNode = {
                type: 'AND',
                left: this.parseExpression(andMatch.left),
                right: this.parseExpression(andMatch.right)
            };
            this.astCache.set(normalized, result);
            this.expressionVariableDeps.set(normalized, this.collectVariableDeps(result));
            return result;
        }

        // Parse NOT expressions
        if (normalized.startsWith('!')) {
            const result: ConditionNode = {
                type: 'NOT',
                left: this.parseExpression(normalized.substring(1).trim())
            };
            this.astCache.set(normalized, result);
            this.expressionVariableDeps.set(normalized, this.collectVariableDeps(result));
            return result;
        }

        // Parse comparison expressions
        const comparisonMatch = this.findComparison(normalized);
        if (comparisonMatch) {
            const result: ConditionNode = {
                type: 'COMPARISON',
                left: this.parseExpression(comparisonMatch.left),
                right: this.parseExpression(comparisonMatch.right),
                operator: comparisonMatch.operator as any
            };
            this.astCache.set(normalized, result);
            this.expressionVariableDeps.set(normalized, this.collectVariableDeps(result));
            return result;
        }

        // Parse literals and variables
        const literalNode = this.parseLiteral(normalized);
        this.astCache.set(normalized, literalNode);
        this.expressionVariableDeps.set(normalized, this.collectVariableDeps(literalNode));
        return literalNode;
    }

    private collectVariableDeps(root: ConditionNode): string[] {
        const deps = new Set<string>();
        const stack: ConditionNode[] = [root];

        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) {
                continue;
            }
            if (node.type === 'VARIABLE' && node.variable) {
                deps.add(node.variable);
            }
            if (node.left) {
                stack.push(node.left);
            }
            if (node.right) {
                stack.push(node.right);
            }
        }

        return Array.from(deps).sort();
    }

    private buildExpressionSignature(variableNames: string[]): string {
        if (!variableNames || variableNames.length === 0) {
            return 'const';
        }
        const parts = new Array<string>(variableNames.length + 1);
        parts[0] = `v${this.contextVersion}`;
        for (let i = 0; i < variableNames.length; i++) {
            const name = variableNames[i];
            const version = this.symbolVersions.get(name) || 0;
            parts[i + 1] = `${name}:${version}`;
        }
        return parts.join('|');
    }

    private bumpSymbolVersion(symbol: string): void {
        const prev = this.symbolVersions.get(symbol) || 0;
        this.symbolVersions.set(symbol, prev + 1);
    }

    private areValuesEqual(a: any, b: any): boolean {
        return a === b;
    }

    private normalizeExpression(expression: string): string {
        if (!expression) {
            return '';
        }
        let normalized = expression.trim();
        normalized = this.removeOuterParentheses(normalized);
        return normalized;
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
