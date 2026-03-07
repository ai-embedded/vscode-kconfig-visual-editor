import { runRtThreadPkgsDirTests } from "./rtthreadPkgsDir.test";
import { runRtThreadPkgsOverrideTests } from "./rtthreadPkgsOverride.test";
import { runSourceDuplicateSymbolTests } from "./sourceDuplicateSymbol.test";
import { runChoiceSelectionTests } from "./choiceSelection.test";
import { runHiddenSymbolWriteTests } from "./hiddenSymbolWrite.test";
import { runDefBoolSelectTests } from "./defBoolSelect.test";
import { runVisibilityIncrementalUpdateTests } from "./visibilityIncrementalUpdate.test";
import { runImplicitMenuExpressionCacheTests } from "./implicitMenuExpressionCache.test";
import { runLoadConfigNameIndexTests } from "./loadConfigNameIndex.test";
import { runMenuTransferSerializerTests } from "./menuTransferSerializer.test";
import { runConditionEvaluatorCacheTests } from "./conditionEvaluatorCache.test";
import { runKconfigSessionCacheTests } from "./kconfigSessionCache.test";
import { runStartupProfilerTests } from "./startupProfiler.test";
import { runWebviewStoreInitialChunksTests } from "./webviewStoreInitialChunks.test";
import { runCommentRenderingTests } from "./commentRendering.test";
import { runUnsavedCloseFlowTests } from "./unsavedCloseFlow.test";

async function main(): Promise<void> {
    await runRtThreadPkgsDirTests();
    await runRtThreadPkgsOverrideTests();
    await runSourceDuplicateSymbolTests();
    await runChoiceSelectionTests();
    await runHiddenSymbolWriteTests();
    await runDefBoolSelectTests();
    await runVisibilityIncrementalUpdateTests();
    await runImplicitMenuExpressionCacheTests();
    await runLoadConfigNameIndexTests();
    await runMenuTransferSerializerTests();
    await runConditionEvaluatorCacheTests();
    await runKconfigSessionCacheTests();
    await runStartupProfilerTests();
    await runWebviewStoreInitialChunksTests();
    await runCommentRenderingTests();
    await runUnsavedCloseFlowTests();
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[Test] 运行测试入口失败:", error);
    process.exit(1);
});
