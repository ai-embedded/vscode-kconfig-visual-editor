import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { type RtThreadPkgsDirSource } from "./pkgsDir";

export function pickAutoPkgsDir(
    workspacePath: string,
    rtThreadRoot?: string
): { path: string; source: RtThreadPkgsDirSource } | undefined {
    const candidates: Array<{ path: string; source: RtThreadPkgsDirSource }> = [];

    const envPkgsDir = (process.env.PKGS_DIR || "").trim();
    if (envPkgsDir) {
        const resolved = resolvePath(envPkgsDir, workspacePath);
        if (resolved) {
            return { path: resolved, source: "environment" };
        }
    }

    const envPkgsRoot = (process.env.PKGS_ROOT || "").trim();
    if (envPkgsRoot) {
        candidates.push({ path: envPkgsRoot, source: "environment" });
    }

    const envRoot = (process.env.ENV_ROOT || "").trim();
    if (envRoot) {
        candidates.push({ path: path.join(envRoot, "packages"), source: "environment" });
    }

    if (rtThreadRoot) {
        candidates.push({ path: path.join(rtThreadRoot, "packages"), source: "rt-thread" });
    }
    const defaultPkgs = path.join(os.homedir(), ".env", "packages");
    candidates.push({ path: defaultPkgs, source: "default" });

    if (candidates.length === 0) {
        return undefined;
    }

    for (const candidate of candidates) {
        const resolved = resolvePath(candidate.path, workspacePath);
        if (resolved && directoryExists(resolved)) {
            return { path: resolved, source: candidate.source };
        }
    }

    if (candidates.length > 0) {
        const preferredFallback = candidates.find(candidate => candidate.source === "default") ?? candidates[0];
        const fallback = resolvePath(preferredFallback.path, workspacePath);
        if (fallback) {
            const fallbackSource: RtThreadPkgsDirSource = preferredFallback.source === "default" ? "default" : "fallback";
            return { path: fallback, source: fallbackSource };
        }
    }

    return undefined;
}

export function resolvePath(targetPath: string, basePath: string): string | undefined {
    if (!targetPath) {
        return undefined;
    }

    let expanded = targetPath.replace(/^~(?=$|[\\/])/, os.homedir());
    if (!path.isAbsolute(expanded)) {
        expanded = path.resolve(basePath, expanded);
    }
    return path.normalize(expanded);
}

export function findRtThreadRoot(start: string): string | undefined {
    let current = path.resolve(start);
    const visited = new Set<string>();

    while (!visited.has(current)) {
        if (rtThreadMarkersExist(current)) {
            return current;
        }

        visited.add(current);
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return undefined;
}

function directoryExists(target: string): boolean {
    try {
        return fs.statSync(target).isDirectory();
    } catch (error) {
        return false;
    }
}

function rtThreadMarkersExist(target: string): boolean {
    const toolsDir = path.join(target, "tools", "env_utility.py");
    const kconfigFile = path.join(target, "Kconfig");
    return fs.existsSync(toolsDir) && fs.existsSync(kconfigFile);
}
