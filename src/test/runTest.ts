import { runRtThreadPkgsDirTests } from "./rtthreadPkgsDir.test";
import { runRtThreadPkgsOverrideTests } from "./rtthreadPkgsOverride.test";
import { runSourceDuplicateSymbolTests } from "./sourceDuplicateSymbol.test";

async function main(): Promise<void> {
    await runRtThreadPkgsDirTests();
    await runRtThreadPkgsOverrideTests();
    await runSourceDuplicateSymbolTests();
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[Test] 运行测试入口失败:", error);
    process.exit(1);
});
