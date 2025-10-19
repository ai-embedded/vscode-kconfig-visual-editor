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

import * as fs from "fs";
import * as path from "path";
import { Logger } from "../logger/logger";
import { ConcurrentFileProcessor } from "./ConcurrentFileProcessor";

/**
 * 依赖扫描器：快速扫描Kconfig文件的依赖关系
 * 用于智能预加载优化
 */
export class DependencyScanner {
    private scannedFiles: Set<string> = new Set();
    private dependencies: Map<string, Set<string>> = new Map();
    private allDependencies: Set<string> = new Set();
    private fileContentCache: Map<string, string[]>;
    private concurrentProcessor: ConcurrentFileProcessor;

    // 正则表达式用于匹配source指令
    private static readonly SOURCE_REGEX = /^\s*(?:o?r?source|o?source)\s+["']?([^"'\s]+)["']?\s*(?:#.*)?$/;
    private static readonly VARIABLE_REGEX = /\$\(([^)]+)\)|\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g;

    constructor(
        fileContentCache: Map<string, string[]>,
        concurrentProcessor: ConcurrentFileProcessor
    ) {
        this.fileContentCache = fileContentCache;
        this.concurrentProcessor = concurrentProcessor;
    }
    
    /**
     * 扫描文件并递归构建依赖树
     * @param startFile 起始文件路径
     * @returns 所有依赖文件的集合
     */
    public async scanDependencies(startFile: string): Promise<Set<string>> {
        const _startTime = Date.now();
//////console.log(`[DEPENDENCY_SCANNER] 🔍 开始扫描依赖: ${startFile}`);
        
        // 清空之前的扫描结果
        this.scannedFiles.clear();
        this.dependencies.clear();
        this.allDependencies.clear();
        
        // 递归扫描
        await this.scanFileRecursively(startFile);
        
        const _scanTime = Date.now() - _startTime;
//////console.log(`[DEPENDENCY_SCANNER] ✅ 扫描完成: 发现 ${this.allDependencies.size} 个依赖文件 (耗时 ${scanTime}ms)`);
        
        return new Set(this.allDependencies);
    }
    
    /**
     * 递归扫描单个文件的依赖
     */
    private async scanFileRecursively(filePath: string, depth: number = 0): Promise<void> {
        // 规范化路径
        const normalizedPath = path.resolve(filePath);
        
        // 避免重复扫描
        if (this.scannedFiles.has(normalizedPath)) {
            return;
        }
        
        // 限制递归深度，防止无限循环
        if (depth > 100) {
            Logger.warn(`[DEPENDENCY_SCANNER] 递归深度超过限制: ${normalizedPath}`);
            return;
        }
        
        // 标记为已扫描
        this.scannedFiles.add(normalizedPath);
        
        // 检查文件是否存在
        if (!fs.existsSync(normalizedPath)) {
            // 不记录警告，因为osource可能指向不存在的文件
            return;
        }
        
        // 将此文件添加到依赖集合
        this.allDependencies.add(normalizedPath);
        
        try {
            // 获取文件内容
            let lines: string[];
            
            // 优先从缓存获取
            if (this.fileContentCache.has(normalizedPath)) {
                lines = this.fileContentCache.get(normalizedPath)!;
            } else {
                // 读取文件
                const content = await fs.promises.readFile(normalizedPath, 'utf-8');
                lines = content.split('\n');
                // 缓存内容
                this.fileContentCache.set(normalizedPath, lines);
            }
            
            // 扫描每一行查找source指令
            const foundDependencies = new Set<string>();
            let inIfBlock = false;
            let ifDepth = 0;
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                
                // 跟踪if块深度（简单实现，可能需要改进）
                if (trimmedLine.startsWith('if ')) {
                    inIfBlock = true;
                    ifDepth++;
                } else if (trimmedLine === 'endif') {
                    ifDepth = Math.max(0, ifDepth - 1);
                    if (ifDepth === 0) {
                        inIfBlock = false;
                    }
                }
                
                // 跳过注释和空行
                if (!trimmedLine || trimmedLine.startsWith('#')) {
                    continue;
                }
                
                // 匹配source指令
                const match = DependencyScanner.SOURCE_REGEX.exec(trimmedLine);
                if (match) {
                    let sourcePath = match[1];
                    
                    // 展开变量
                    sourcePath = this.expandVariables(sourcePath);
                    
                    // 解析相对路径
                    let resolvedPath: string;
                    if (path.isAbsolute(sourcePath)) {
                        resolvedPath = sourcePath;
                    } else {
                        resolvedPath = path.join(path.dirname(normalizedPath), sourcePath);
                    }
                    
                    // 规范化路径
                    resolvedPath = path.resolve(resolvedPath);
                    
                    // 如果不在if块中，或者是osource/orsource（可选的），添加到依赖
                    // 注意：为了完整性，我们也扫描if块中的依赖，但可以根据需要调整策略
                    if (!inIfBlock || trimmedLine.includes('osource') || trimmedLine.includes('orsource')) {
                        foundDependencies.add(resolvedPath);
                    }
                }
            }
            
            // 存储此文件的依赖
            if (foundDependencies.size > 0) {
                this.dependencies.set(normalizedPath, foundDependencies);
                
                // 并发递归扫描所有依赖
                const scanPromises: Promise<void>[] = [];
                for (const depPath of foundDependencies) {
                    scanPromises.push(this.scanFileRecursively(depPath, depth + 1));
                }
                
                // 等待所有依赖扫描完成
                await Promise.all(scanPromises);
            }
            
        } catch (error) {
            // 静默处理错误，继续扫描其他文件
            Logger.debug(`[DEPENDENCY_SCANNER] 扫描文件失败 ${normalizedPath}: ${error}`);
        }
    }
    
    /**
     * 展开变量
     */
    private expandVariables(text: string): string {
        let result = text;
        let match: RegExpExecArray | null;
        
        // 重置正则表达式
        DependencyScanner.VARIABLE_REGEX.lastIndex = 0;
        
        while ((match = DependencyScanner.VARIABLE_REGEX.exec(text)) !== null) {
            const varName = match[1] || match[2] || match[3];
            let value: string | undefined;

            // 从系统环境变量获取
            value = process.env[varName];

            if (value) {
                result = result.replace(match[0], value);
            }
        }
        
        return result;
    }
    
    /**
     * 获取依赖统计信息
     */
    public getStatistics(): {
        totalFiles: number;
        totalDependencies: number;
        averageDependenciesPerFile: number;
        maxDependencies: number;
        filesWithMostDependencies: string | null;
    } {
        let maxDeps = 0;
        let maxDepsFile: string | null = null;
        let totalDeps = 0;
        
        for (const [file, deps] of this.dependencies) {
            const depCount = deps.size;
            totalDeps += depCount;
            
            if (depCount > maxDeps) {
                maxDeps = depCount;
                maxDepsFile = file;
            }
        }
        
        const avgDeps = this.dependencies.size > 0 ? totalDeps / this.dependencies.size : 0;
        
        return {
            totalFiles: this.scannedFiles.size,
            totalDependencies: this.allDependencies.size,
            averageDependenciesPerFile: avgDeps,
            maxDependencies: maxDeps,
            filesWithMostDependencies: maxDepsFile
        };
    }
    
    /**
     * 清理资源
     */
    public clear(): void {
        this.scannedFiles.clear();
        this.dependencies.clear();
        this.allDependencies.clear();
    }
}