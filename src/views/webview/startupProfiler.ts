export interface StartupMetricDecisionInput {
  profileAlways: boolean;
  slowThresholdMs: number;
  bootToEndMs: number;
  beginToEndMs: number;
  backendServerInitMs?: number;
}

export function shouldEmitStartupMetric(input: StartupMetricDecisionInput): boolean {
  if (input.profileAlways) {
    return true;
  }

  const threshold = Number.isFinite(input.slowThresholdMs) && input.slowThresholdMs > 0
    ? input.slowThresholdMs
    : 1500;

  if (input.bootToEndMs >= threshold) {
    return true;
  }

  if (input.beginToEndMs >= threshold) {
    return true;
  }

  if (typeof input.backendServerInitMs === "number" && input.backendServerInitMs >= threshold) {
    return true;
  }

  return false;
}
