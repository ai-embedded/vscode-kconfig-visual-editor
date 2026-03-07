import assert from "assert";

import { ConditionEvaluator } from "../menuconfig/ConditionEvaluator";

export async function runConditionEvaluatorCacheTests(): Promise<void> {
    const evaluator = new ConditionEvaluator({ FEATURE_A: true, FEATURE_B: false });

    const originalEvaluateNode = (evaluator as any).evaluateNode.bind(evaluator);
    let evaluateNodeCalls = 0;

    (evaluator as any).evaluateNode = (node: any) => {
        evaluateNodeCalls += 1;
        return originalEvaluateNode(node);
    };

    const expr = "FEATURE_A && !FEATURE_B";

    const first = evaluator.evaluate(expr);
    assert.strictEqual(first, true, "first evaluation should be true");
    const callsAfterFirst = evaluateNodeCalls;
    assert.ok(callsAfterFirst > 0, "first evaluation should execute evaluateNode");

    const second = evaluator.evaluate(expr);
    assert.strictEqual(second, true, "second evaluation should keep same result");
    assert.strictEqual(
        evaluateNodeCalls,
        callsAfterFirst,
        "second evaluation should hit cache without re-running evaluateNode"
    );

    evaluator.setValue("FEATURE_A", false);
    const third = evaluator.evaluate(expr);
    assert.strictEqual(third, false, "value change should invalidate cached evaluation");
    assert.ok(
        evaluateNodeCalls > callsAfterFirst,
        "evaluation should recompute after dependent symbol changed"
    );
}
