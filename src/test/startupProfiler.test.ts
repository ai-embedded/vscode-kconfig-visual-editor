import assert from "assert";

import { shouldEmitStartupMetric } from "../views/webview/startupProfiler";

export async function runStartupProfilerTests(): Promise<void> {
    assert.strictEqual(
        shouldEmitStartupMetric({
            profileAlways: false,
            slowThresholdMs: 1500,
            bootToEndMs: 800,
            beginToEndMs: 700,
            backendServerInitMs: 600
        }),
        false,
        "all stages below threshold should not emit metric"
    );

    assert.strictEqual(
        shouldEmitStartupMetric({
            profileAlways: false,
            slowThresholdMs: 1500,
            bootToEndMs: 1800,
            beginToEndMs: 900,
            backendServerInitMs: 700
        }),
        true,
        "slow total startup should emit metric"
    );

    assert.strictEqual(
        shouldEmitStartupMetric({
            profileAlways: false,
            slowThresholdMs: 1500,
            bootToEndMs: 900,
            beginToEndMs: 800,
            backendServerInitMs: 1700
        }),
        true,
        "slow backend stage should emit metric"
    );

    assert.strictEqual(
        shouldEmitStartupMetric({
            profileAlways: true,
            slowThresholdMs: 999999,
            bootToEndMs: 10,
            beginToEndMs: 10,
            backendServerInitMs: 10
        }),
        true,
        "profileAlways should force metric output"
    );
}
