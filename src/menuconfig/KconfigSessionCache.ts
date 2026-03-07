import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { Logger } from "../logger/logger";
import { Menu } from "./Menu";

interface CachedFileSignature {
    path: string;
    size: number;
    mtimeMs: number;
}

interface CachedMenuPayload {
    version: number;
    cacheKey: string;
    createdAt: number;
    files: CachedFileSignature[];
    menus: Menu[];
}

interface HotCacheEntry {
    loadedAt: number;
    files: CachedFileSignature[];
    menus: Menu[];
}

export class KconfigSessionCache {
    private static readonly CACHE_VERSION = 3;
    private static readonly CACHE_KEY_VERSION = "v3";
    private static readonly MAX_STAT_CONCURRENCY = 64;
    private static readonly HOT_CACHE_TTL_MS = 10000;
    private static readonly HOT_CACHE_MAX_ENTRIES = 4;
    private static readonly HOT_CACHE_SAMPLE_SIZE = 12;
    private static hotCache = new Map<string, HotCacheEntry>();

    private readonly cacheDir: string;

    constructor(workspaceFolder: string) {
        this.cacheDir = path.join(workspaceFolder, ".kconfig-cache");
    }

    public static buildCacheKey(mainKconfigFile: string): string {
        return crypto
            .createHash("sha1")
            .update(`${path.normalize(mainKconfigFile)}|${KconfigSessionCache.CACHE_KEY_VERSION}`)
            .digest("hex");
    }

    public async load(cacheKey: string): Promise<Menu[] | null> {
        const hotCached = await this.tryLoadFromHotCache(cacheKey);
        if (hotCached) {
            return hotCached;
        }

        const cacheFilePath = this.getCacheFilePath(cacheKey);
        try {
            const content = await fs.promises.readFile(cacheFilePath, "utf8");
            const payload = JSON.parse(content) as CachedMenuPayload;

            if (
                !payload ||
                payload.version !== KconfigSessionCache.CACHE_VERSION ||
                payload.cacheKey !== cacheKey ||
                !Array.isArray(payload.files) ||
                !Array.isArray(payload.menus)
            ) {
                return null;
            }

            const valid = await this.validateFileSignatures(payload.files);
            if (!valid) {
                KconfigSessionCache.hotCache.delete(cacheKey);
                return null;
            }

            this.updateHotCache(cacheKey, payload.files, payload.menus);
            return this.cloneMenus(payload.menus);
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err && err.code === "ENOENT") {
                KconfigSessionCache.hotCache.delete(cacheKey);
                return null;
            }
            Logger.debug(() => `[SESSION_CACHE] Load failed: ${err?.message || String(error)}`);
            return null;
        }
    }

    public async save(cacheKey: string, menus: Menu[], parsedFiles: string[]): Promise<void> {
        if (!Array.isArray(menus) || menus.length === 0 || !Array.isArray(parsedFiles) || parsedFiles.length === 0) {
            return;
        }

        const normalizedFiles = Array.from(
            new Set(parsedFiles.map((filePath) => path.normalize(filePath)))
        ).sort((a, b) => a.localeCompare(b));

        const signatures = await this.collectFileSignatures(normalizedFiles);
        if (signatures.length === 0) {
            return;
        }

        const payload: CachedMenuPayload = {
            version: KconfigSessionCache.CACHE_VERSION,
            cacheKey,
            createdAt: Date.now(),
            files: signatures,
            menus,
        };

        const cacheFilePath = this.getCacheFilePath(cacheKey);
        const tempFilePath = `${cacheFilePath}.tmp`;

        try {
            await fs.promises.mkdir(this.cacheDir, { recursive: true });
            await fs.promises.writeFile(tempFilePath, JSON.stringify(payload), "utf8");
            await fs.promises.rename(tempFilePath, cacheFilePath);
            this.updateHotCache(cacheKey, signatures, menus);
        } catch (error) {
            Logger.debug(() => `[SESSION_CACHE] Save failed: ${error instanceof Error ? error.message : String(error)}`);
            try {
                await fs.promises.unlink(tempFilePath);
            } catch {
                // noop
            }
        }
    }

    private getCacheFilePath(cacheKey: string): string {
        return path.join(this.cacheDir, `${cacheKey}.json`);
    }

    private async tryLoadFromHotCache(cacheKey: string): Promise<Menu[] | null> {
        const entry = KconfigSessionCache.hotCache.get(cacheKey);
        if (!entry) {
            return null;
        }

        if (Date.now() - entry.loadedAt > KconfigSessionCache.HOT_CACHE_TTL_MS) {
            KconfigSessionCache.hotCache.delete(cacheKey);
            return null;
        }

        const sampleValid = await this.validateSampledSignatures(
            entry.files,
            KconfigSessionCache.HOT_CACHE_SAMPLE_SIZE
        );
        if (!sampleValid) {
            KconfigSessionCache.hotCache.delete(cacheKey);
            return null;
        }

        return this.cloneMenus(entry.menus);
    }

    private updateHotCache(cacheKey: string, files: CachedFileSignature[], menus: Menu[]): void {
        KconfigSessionCache.hotCache.set(cacheKey, {
            loadedAt: Date.now(),
            files,
            menus: this.cloneMenus(menus),
        });

        if (KconfigSessionCache.hotCache.size <= KconfigSessionCache.HOT_CACHE_MAX_ENTRIES) {
            return;
        }

        let oldestKey: string | null = null;
        let oldestTs = Number.MAX_SAFE_INTEGER;
        for (const [key, value] of KconfigSessionCache.hotCache.entries()) {
            if (value.loadedAt < oldestTs) {
                oldestTs = value.loadedAt;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            KconfigSessionCache.hotCache.delete(oldestKey);
        }
    }

    private async validateSampledSignatures(signatures: CachedFileSignature[], sampleSize: number): Promise<boolean> {
        if (!Array.isArray(signatures) || signatures.length === 0) {
            return false;
        }

        if (signatures.length <= sampleSize) {
            return this.validateFileSignatures(signatures);
        }

        const sampled: CachedFileSignature[] = [];
        const seen = new Set<number>();
        const normalizedSampleSize = Math.max(2, sampleSize);
        const step = Math.max(1, Math.floor((signatures.length - 1) / (normalizedSampleSize - 1)));

        for (let i = 0; i < normalizedSampleSize; i++) {
            const index = i === normalizedSampleSize - 1
                ? signatures.length - 1
                : Math.min(i * step, signatures.length - 1);
            if (!seen.has(index)) {
                seen.add(index);
                sampled.push(signatures[index]);
            }
        }

        return this.validateFileSignatures(sampled);
    }

    private cloneMenus(menus: Menu[]): Menu[] {
        return JSON.parse(JSON.stringify(menus)) as Menu[];
    }

    private async validateFileSignatures(signatures: CachedFileSignature[]): Promise<boolean> {
        if (!Array.isArray(signatures) || signatures.length === 0) {
            return false;
        }

        const [rootFile, ...rest] = signatures;
        if (!(await this.isSignatureMatched(rootFile))) {
            return false;
        }

        const results = await this.mapWithConcurrency(rest, KconfigSessionCache.MAX_STAT_CONCURRENCY, async (entry) => {
            return this.isSignatureMatched(entry);
        });

        return results.every((matched) => matched === true);
    }

    private async collectFileSignatures(files: string[]): Promise<CachedFileSignature[]> {
        const collected = await this.mapWithConcurrency(files, KconfigSessionCache.MAX_STAT_CONCURRENCY, async (filePath) => {
            try {
                const stat = await fs.promises.stat(filePath);
                if (!stat.isFile()) {
                    return null;
                }
                return {
                    path: filePath,
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                } as CachedFileSignature;
            } catch {
                return null;
            }
        });

        return collected.filter((entry): entry is CachedFileSignature => !!entry);
    }

    private async isSignatureMatched(entry: CachedFileSignature): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(entry.path);
            return stat.isFile() && stat.size === entry.size && stat.mtimeMs === entry.mtimeMs;
        } catch {
            return false;
        }
    }

    private async mapWithConcurrency<T, R>(
        items: T[],
        concurrency: number,
        worker: (_item: T) => Promise<R>
    ): Promise<R[]> {
        if (items.length === 0) {
            return [];
        }

        const limit = Math.max(1, Math.min(concurrency, items.length));
        const results = new Array<R>(items.length);
        let cursor = 0;

        const run = async () => {
            let current = cursor;
            cursor += 1;
            while (current < items.length) {
                results[current] = await worker(items[current]);
                current = cursor;
                cursor += 1;
            }
        };

        await Promise.all(Array.from({ length: limit }, () => run()));
        return results;
    }
}
