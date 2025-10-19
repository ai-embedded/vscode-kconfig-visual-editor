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

/**
 * Expression types in Kconfig
 */
/* eslint-disable no-unused-vars */
export enum ExprType {
    SYMBOL = 'SYMBOL',
    STRING = 'STRING',
    NUMBER = 'NUMBER',
    AND = 'AND',
    OR = 'OR',
    NOT = 'NOT',
    EQUAL = 'EQUAL',
    UNEQUAL = 'UNEQUAL',
    LESS = 'LESS',
    LESS_EQUAL = 'LESS_EQUAL',
    GREATER = 'GREATER',
    GREATER_EQUAL = 'GREATER_EQUAL',
}

/**
 * Expression node in the AST
 */
export interface ExprNode {
    type: ExprType;
    value?: string | number;
    left?: ExprNode;
    right?: ExprNode;
}

/**
 * Parser for Kconfig expressions.
 * Converts string expressions to AST and provides dependency analysis.
 * 
 * This implementation matches Kconfiglib's expression handling,
 * particularly the _expr_depends_on function behavior.
 */
export class ExpressionParser {
    private pos: number = 0;
    private expr: string = '';
    
    /**
     * Parse a Kconfig expression into an AST.
     * 
     * Grammar:
     * expression   := or_expr
     * or_expr      := and_expr ('||' and_expr)*
     * and_expr     := not_expr ('&&' not_expr)*
     * not_expr     := '!' not_expr | comparison
     * comparison   := primary (('=' | '!=' | '<' | '<=' | '>' | '>=') primary)?
     * primary      := '(' expression ')' | SYMBOL | STRING | NUMBER
     */
    parse(expr: string): ExprNode {
        this.expr = expr.trim();
        this.pos = 0;
        
        if (!this.expr) {
            // Empty expression defaults to 'y' (always true)
            return { type: ExprType.SYMBOL, value: 'y' };
        }
        
        const result = this.parseOr();
        
        // Ensure we've consumed the entire expression
        this.skipWhitespace();
        if (this.pos < this.expr.length) {
            throw new Error(`Unexpected token at position ${this.pos}: ${this.expr.substring(this.pos)}`);
        }
        
        return result;
    }
    
    private parseOr(): ExprNode {
        let left = this.parseAnd();
        
        while (this.consumeToken('||')) {
            const right = this.parseAnd();
            left = { type: ExprType.OR, left, right };
        }
        
        return left;
    }
    
    private parseAnd(): ExprNode {
        let left = this.parseNot();
        
        while (this.consumeToken('&&')) {
            const right = this.parseNot();
            left = { type: ExprType.AND, left, right };
        }
        
        return left;
    }
    
    private parseNot(): ExprNode {
        if (this.consumeToken('!')) {
            return {
                type: ExprType.NOT,
                left: this.parseNot()  // Support nested NOT
            };
        }
        return this.parseComparison();
    }
    
    private parseComparison(): ExprNode {
        const left = this.parsePrimary();
        
        // Check for comparison operators
        if (this.consumeToken('>=')) {
            return { type: ExprType.GREATER_EQUAL, left, right: this.parsePrimary() };
        }
        if (this.consumeToken('<=')) {
            return { type: ExprType.LESS_EQUAL, left, right: this.parsePrimary() };
        }
        if (this.consumeToken('!=')) {
            return { type: ExprType.UNEQUAL, left, right: this.parsePrimary() };
        }
        if (this.consumeToken('=')) {
            return { type: ExprType.EQUAL, left, right: this.parsePrimary() };
        }
        if (this.consumeToken('>')) {
            return { type: ExprType.GREATER, left, right: this.parsePrimary() };
        }
        if (this.consumeToken('<')) {
            return { type: ExprType.LESS, left, right: this.parsePrimary() };
        }
        
        return left;
    }
    
    private parsePrimary(): ExprNode {
        this.skipWhitespace();
        
        // Parenthesized expression
        if (this.expr[this.pos] === '(') {
            this.pos++;
            const node = this.parseOr();
            this.skipWhitespace();
            if (this.expr[this.pos] !== ')') {
                throw new Error(`Expected ')' at position ${this.pos}`);
            }
            this.pos++;
            return node;
        }
        
        // String literal
        if (this.expr[this.pos] === '"') {
            return this.parseString();
        }
        
        // Number or symbol
        return this.parseSymbolOrNumber();
    }
    
    private parseString(): ExprNode {
        this.pos++; // Skip opening quote
        const start = this.pos;
        
        while (this.pos < this.expr.length && this.expr[this.pos] !== '"') {
            if (this.expr[this.pos] === '\\') {
                this.pos++; // Skip escape character
            }
            this.pos++;
        }
        
        if (this.pos >= this.expr.length) {
            throw new Error('Unterminated string');
        }
        
        const value = this.expr.substring(start, this.pos);
        this.pos++; // Skip closing quote
        
        return { type: ExprType.STRING, value };
    }
    
    private parseSymbolOrNumber(): ExprNode {
        this.skipWhitespace();
        const start = this.pos;
        
        // Match symbol names (alphanumeric, underscore)
        // Kconfig symbols typically use uppercase, but we support all cases
        while (this.pos < this.expr.length && 
               /[A-Za-z0-9_]/.test(this.expr[this.pos])) {
            this.pos++;
        }
        
        if (this.pos === start) {
            throw new Error(`Expected symbol or number at position ${this.pos}`);
        }
        
        const value = this.expr.substring(start, this.pos);
        
        // Check if it's a number
        if (/^\d+$/.test(value)) {
            return { type: ExprType.NUMBER, value: parseInt(value, 10) };
        }
        
        // It's a symbol
        return { type: ExprType.SYMBOL, value };
    }
    
    /**
     * Check if an expression depends on a symbol.
     * 
     * CRITICAL: This matches Kconfiglib's _expr_depends_on behavior:
     * - NOT operations return false (do not create dependency)
     * - This is key to proper indentation behavior
     */
    exprDependsOn(expr: ExprNode, symbol: string): boolean {
        // Helpers for constant detection
        const isConstY = (n?: ExprNode) => !!n && (n.type === ExprType.SYMBOL && n.value === 'y');
        const isConstM = (n?: ExprNode) => !!n && (n.type === ExprType.SYMBOL && n.value === 'm');
        const isConstN = (n?: ExprNode) => !!n && (n.type === ExprType.SYMBOL && n.value === 'n');
        const isSym = (n?: ExprNode, name?: string) => !!n && n.type === ExprType.SYMBOL && n.value === name;

        switch (expr.type) {
            case ExprType.SYMBOL:
                return expr.value === symbol;

            case ExprType.AND:
                // Only AND chain contributes dependency
                return (expr.left ? this.exprDependsOn(expr.left, symbol) : false) ||
                       (expr.right ? this.exprDependsOn(expr.right, symbol) : false);

            case ExprType.OR:
                // OR never creates dependency in Kconfiglib semantics
                return false;

            case ExprType.NOT:
                // NOT never creates dependency
                return false;

            case ExprType.EQUAL: {
                // A = y/m or y/m = A
                const L = expr.left, R = expr.right;
                if (isSym(L, symbol) && (isConstY(R) || isConstM(R))) return true;
                if (isSym(R, symbol) && (isConstY(L) || isConstM(L))) return true;
                return false;
            }

            case ExprType.UNEQUAL: {
                // A != n or n != A
                const L = expr.left, R = expr.right;
                if (isSym(L, symbol) && isConstN(R)) return true;
                if (isSym(R, symbol) && isConstN(L)) return true;
                return false;
            }

            case ExprType.LESS:
            case ExprType.LESS_EQUAL:
            case ExprType.GREATER:
            case ExprType.GREATER_EQUAL:
            case ExprType.STRING:
            case ExprType.NUMBER:
                return false;

            default:
                return false;
        }
    }
    
    /**
     * Check if an expression is a pure negation (e.g., !A or !A && !B).
     * Used to determine if an if block should be flattened.
     */
    isPureNegation(expr: ExprNode): boolean {
        switch (expr.type) {
            case ExprType.NOT:
                return true;
                
            case ExprType.AND:
                // All operands must be negations
                return (expr.left ? this.isPureNegation(expr.left) : true) &&
                       (expr.right ? this.isPureNegation(expr.right) : true);
                       
            default:
                return false;
        }
    }
    
    /**
     * Convert an expression node back to string (for debugging).
     */
    toString(expr: ExprNode): string {
        switch (expr.type) {
            case ExprType.SYMBOL:
                return expr.value as string;
            case ExprType.STRING:
                return `"${expr.value}"`;
            case ExprType.NUMBER:
                return expr.value!.toString();
            case ExprType.NOT:
                return `!${expr.left ? this.toString(expr.left) : ''}`;
            case ExprType.AND:
                return `(${expr.left ? this.toString(expr.left) : ''} && ${expr.right ? this.toString(expr.right) : ''})`;
            case ExprType.OR:
                return `(${expr.left ? this.toString(expr.left) : ''} || ${expr.right ? this.toString(expr.right) : ''})`;
            case ExprType.EQUAL:
                return `${expr.left ? this.toString(expr.left) : ''} = ${expr.right ? this.toString(expr.right) : ''}`;
            case ExprType.UNEQUAL:
                return `${expr.left ? this.toString(expr.left) : ''} != ${expr.right ? this.toString(expr.right) : ''}`;
            case ExprType.LESS:
                return `${expr.left ? this.toString(expr.left) : ''} < ${expr.right ? this.toString(expr.right) : ''}`;
            case ExprType.LESS_EQUAL:
                return `${expr.left ? this.toString(expr.left) : ''} <= ${expr.right ? this.toString(expr.right) : ''}`;
            case ExprType.GREATER:
                return `${expr.left ? this.toString(expr.left) : ''} > ${expr.right ? this.toString(expr.right) : ''}`;
            case ExprType.GREATER_EQUAL:
                return `${expr.left ? this.toString(expr.left) : ''} >= ${expr.right ? this.toString(expr.right) : ''}`;
            default:
                return '';
        }
    }
    
    private consumeToken(token: string): boolean {
        this.skipWhitespace();
        
        if (this.pos + token.length > this.expr.length) {
            return false;
        }
        
        // Check if the token matches at current position
        for (let i = 0; i < token.length; i++) {
            if (this.expr[this.pos + i] !== token[i]) {
                return false;
            }
        }
        
        // Make sure it's not part of a longer token (e.g., "=" vs "==")
        // This is especially important for operators
        if (token === '=' || token === '!' || token === '<' || token === '>') {
            const nextChar = this.expr[this.pos + token.length];
            if (nextChar === '=' || (token === '<' && nextChar === '=') || (token === '>' && nextChar === '=')) {
                return false;
            }
        }
        
        this.pos += token.length;
        return true;
    }
    
    private skipWhitespace(): void {
        while (this.pos < this.expr.length && /\s/.test(this.expr[this.pos])) {
            this.pos++;
        }
    }
}
