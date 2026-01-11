import * as os from "os";
import * as path from "path";

export type RtThreadPkgsDirSource =
    | "configuration"
    | "environment"
    | "rt-thread"
    | "default"
    | "fallback"
    | "none";

export function formatPkgsDirForConfig(
    resolvedPath: string,
    source: RtThreadPkgsDirSource,
    homeDir: string = os.homedir()
): string {
    if (!resolvedPath) {
        return resolvedPath;
    }

    if (!isDefaultPkgsDirValue(resolvedPath, homeDir)) {
        return resolvedPath;
    }

    return path.join("~", ".env", "packages");
}

export function isDefaultPkgsDirValue(value: string, homeDir: string = os.homedir()): boolean {
    if (!value) {
        return false;
    }

    const expanded = value.replace(/^~(?=$|[\\/])/, homeDir);
    const normalizedValue = path.normalize(expanded);
    const normalizedDefault = path.normalize(path.join(homeDir, ".env", "packages"));

    return normalizedValue === normalizedDefault;
}
