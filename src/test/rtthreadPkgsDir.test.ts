import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { formatPkgsDirForConfig, isDefaultPkgsDirValue } from "../rtthread/pkgsDir";

export async function runRtThreadPkgsDirTests(): Promise<void> {
    const homeDir = path.join(path.sep, "home", "tester");
    const resolved = path.join(homeDir, ".env", "packages");

    const formattedDefault = formatPkgsDirForConfig(resolved, "default", homeDir);
    assert.strictEqual(
        formattedDefault,
        path.join("~", ".env", "packages"),
        "default pkgs dir should use tilde"
    );

    const formattedEnv = formatPkgsDirForConfig(resolved, "environment", homeDir);
    assert.strictEqual(
        formattedEnv,
        path.join("~", ".env", "packages"),
        "default pkgs dir should use tilde even for environment source"
    );

    const customResolved = path.join(homeDir, "custom", "packages");
    const formattedCustomEnv = formatPkgsDirForConfig(customResolved, "environment", homeDir);
    assert.strictEqual(
        formattedCustomEnv,
        customResolved,
        "non-default env pkgs dir should keep resolved path"
    );

    assert.strictEqual(
        isDefaultPkgsDirValue(path.join("~", ".env", "packages"), homeDir),
        true,
        "tilde default should be recognized"
    );
    assert.strictEqual(
        isDefaultPkgsDirValue(resolved, homeDir),
        true,
        "absolute default should be recognized"
    );
    assert.strictEqual(
        isDefaultPkgsDirValue(customResolved, homeDir),
        false,
        "custom path should not be recognized as default"
    );

    const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const pkgsDirConfig = packageJson?.contributes?.configuration?.properties?.["kconfig.rtThread.pkgsDir"];
    assert.strictEqual(
        pkgsDirConfig?.default,
        path.join("~", ".env", "packages"),
        "pkgs dir default should be ~/.env/packages"
    );
    assert.strictEqual(
        pkgsDirConfig?.scope,
        "window",
        "pkgs dir setting should be configurable in user/remote/workspace scopes"
    );

    const resolverModule = require("../rtthread/pkgsDirResolver") as {
        pickAutoPkgsDir?: (workspacePath: string, rtThreadRoot?: string) => { path: string; source: string } | undefined;
    };
    const pickAutoPkgsDir = resolverModule.pickAutoPkgsDir;
    assert.strictEqual(
        typeof pickAutoPkgsDir,
        "function",
        "pickAutoPkgsDir should be exported for tests"
    );

    const originalEnv = {
        HOME: process.env.HOME,
        PKGS_DIR: process.env.PKGS_DIR,
        PKGS_ROOT: process.env.PKGS_ROOT,
        ENV_ROOT: process.env.ENV_ROOT,
    };

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "kconfig-home-"));
    const expectedDefault = path.join(tempHome, ".env", "packages");
    fs.mkdirSync(expectedDefault, { recursive: true });

    try {
        process.env.HOME = tempHome;
        delete process.env.PKGS_DIR;
        delete process.env.PKGS_ROOT;
        delete process.env.ENV_ROOT;

        const result = pickAutoPkgsDir?.(path.join(tempHome, "workspace"));
        assert.ok(
            result,
            "should resolve default pkgs dir when env vars and RT-Thread root are absent"
        );
        assert.strictEqual(result?.path, expectedDefault);
        assert.strictEqual(result?.source, "default");
    } finally {
        process.env.HOME = originalEnv.HOME;
        process.env.PKGS_DIR = originalEnv.PKGS_DIR;
        process.env.PKGS_ROOT = originalEnv.PKGS_ROOT;
        process.env.ENV_ROOT = originalEnv.ENV_ROOT;
        fs.rmSync(tempHome, { recursive: true, force: true });
    }
}
