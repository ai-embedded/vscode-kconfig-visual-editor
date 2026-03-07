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
import { glob } from "glob";
import { Logger } from "../logger/logger";

/**
 * 并发文件处理器 - 解决 880+ packages 文件串行读取性能问题
 * 这是性能优化的核心组件，将同步串行处理改为异步并发处理
 */
export class ConcurrentFileProcessor {
    private static readonly DEFAULT_CONCURRENCY_LIMIT = 100;  // 增加并发限制以提高性能
    private static readonly MAX_RETRIES = 3;
    private static readonly OPTIMAL_BATCH_SIZE = 200;  // 优化的批次大小
    
    private concurrencyLimit: number;
    private fileContentCache: Map<string, string> = new Map();
    
    constructor(concurrencyLimit: number = ConcurrentFileProcessor.DEFAULT_CONCURRENCY_LIMIT) {
        this.concurrencyLimit = concurrencyLimit;
        Logger.info(`[CONCURRENT_PROCESSOR] Initialized with concurrency limit: ${concurrencyLimit}`);
    }
    
    /**
     * 异步并发读取多个文件
     * @param filePaths 要读取的文件路径数组
     * @returns Promise<Map<string, string>> 文件路径到内容的映射
     */
    public async readFilesAsync(filePaths: string[]): Promise<Map<string, string>> {
//////console.log(`[CONCURRENT_PROCESSOR] 🚀 开始并发读取 ${filePaths.length} 个文件...`);
        const _startTime = Date.now();
        
        const results = new Map<string, string>();
        
        // 创建分块处理，避免过多并发导致系统资源耗尽
        const chunks = this.chunkArray(filePaths, this.concurrencyLimit);
        
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const chunk = chunks[chunkIndex];
//////console.log(`[CONCURRENT_PROCESSOR] 处理第 ${chunkIndex + 1}/${chunks.length} 批，包含 ${chunk.length} 个文件`);
            
            const chunkPromises = chunk.map(filePath => this.readSingleFileWithRetry(filePath));
            const chunkResults = await Promise.allSettled(chunkPromises);
            
            // 处理结果
            chunkResults.forEach((result, index) => {
                const filePath = chunk[index];
                if (result.status === 'fulfilled' && result.value !== null) {
                    results.set(filePath, result.value);
                } else if (result.status === 'rejected') {
                    Logger.warn(`[CONCURRENT_PROCESSOR] 无法读取文件: ${filePath}`);
                    Logger.error(`[CONCURRENT_PROCESSOR] 读取错误: ${result.reason}`);
                }
            });
        }
        
        const totalTime = Date.now() - _startTime;
        const successCount = results.size;
        const _avgTime = successCount > 0 ? (totalTime / successCount).toFixed(1) : 0;
        
//////console.log(`[CONCURRENT_PROCESSOR] ✅ 并发读取完成:`);
//////console.log(`[CONCURRENT_PROCESSOR]   - 总时间: ${totalTime}ms`);
//////console.log(`[CONCURRENT_PROCESSOR]   - 成功读取: ${successCount}/${filePaths.length} 个文件`);
//////console.log(`[CONCURRENT_PROCESSOR]   - 平均每文件: ${avgTime}ms`);
//////console.log(`[CONCURRENT_PROCESSOR]   - 性能提升估算: ${this.estimateSpeedImprovement(filePaths.length, totalTime)}x`);
        
        return results;
    }
    
    /**
     * 异步解析 glob 模式并读取文件
     * @param globPattern glob 匹配模式
     * @returns Promise<Map<string, string>> 文件路径到内容的映射
     */
    public async processGlobPattern(globPattern: string): Promise<Map<string, string>> {
//////console.log(`[CONCURRENT_PROCESSOR] 🔍 解析 glob 模式: ${globPattern}`);
        const _startTime = Date.now();
        
        try {
            const matchedFiles = (await glob(globPattern, { nodir: true })).sort();
            const _globTime = Date.now() - _startTime;
            
//////console.log(`[CONCURRENT_PROCESSOR] Glob 解析完成，找到 ${matchedFiles.length} 个文件 (${globTime}ms)`);
            
            if (matchedFiles.length === 0) {
                Logger.warn(`[CONCURRENT_PROCESSOR] Glob 模式未匹配到任何文件: ${globPattern}`);
                return new Map();
            }
            
            return await this.readFilesAsync(matchedFiles);
        } catch (error) {
            Logger.error(`[CONCURRENT_PROCESSOR] Glob 解析失败: ${globPattern}`, error as Error);
            return new Map();
        }
    }
    
    /**
     * 带重试的单文件读取
     */
    private async readSingleFileWithRetry(filePath: string, retryCount: number = 0): Promise<string | null> {
        // 检查缓存
        if (this.fileContentCache.has(filePath)) {
            return this.fileContentCache.get(filePath)!;
        }
        
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            
            // 缓存内容
            this.fileContentCache.set(filePath, content);
            
            return content;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            if (retryCount < ConcurrentFileProcessor.MAX_RETRIES) {
                Logger.warn(`[CONCURRENT_PROCESSOR] 重试读取文件 ${filePath} (第 ${retryCount + 1} 次)`);
                await this.sleep(100 * (retryCount + 1)); // 递增延迟
                return this.readSingleFileWithRetry(filePath, retryCount + 1);
            }
            
            Logger.error(`[CONCURRENT_PROCESSOR] 读取文件失败，已达最大重试次数: ${filePath}`, error as Error);
            return null;
        }
    }
    
    /**
     * 数组分块
     */
    private chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }
    
    /**
     * 估算性能提升倍数
     */
    private estimateSpeedImprovement(fileCount: number, actualTime: number): number {
        // 假设串行读取每个文件需要 50ms (保守估计)
        const estimatedSerialTime = fileCount * 50;
        return Math.round((estimatedSerialTime / actualTime) * 10) / 10;
    }
    
    /**
     * 延迟工具函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * 清理缓存
     */
    public clearCache(): void {
        this.fileContentCache.clear();
        Logger.info(`[CONCURRENT_PROCESSOR] 缓存已清理`);
    }
    
    /**
     * 获取缓存统计
     */
    public getCacheStats(): { cachedFiles: number; cacheSize: string } {
        const cacheSize = Array.from(this.fileContentCache.values())
            .reduce((total, content) => total + content.length, 0);
        
        return {
            cachedFiles: this.fileContentCache.size,
            cacheSize: `${(cacheSize / 1024 / 1024).toFixed(2)} MB`
        };
    }
}
