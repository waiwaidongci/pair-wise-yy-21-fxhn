import { useMemo } from 'react';
import type { Bay, Container, Placement, Port, StabilityMetricKey, StowagePlan, VesselSpec } from '../types/shipping';
import { calculateStability } from '../utils/stability';
import { buildAttribution } from '../utils/stabilityAttribution';

export function useStabilityAttribution(
  plan: StowagePlan | undefined,
  containers: Container[],
  bays: Bay[],
  ports: Port[],
  vessel: VesselSpec,
) {
  return useMemo(() => {
    if (!plan) return null;
    const stability = calculateStability(plan.placements, containers, bays, vessel);
    return buildAttribution(
      plan.placements,
      containers,
      bays,
      ports,
      vessel,
      stability,
      plan.manualOverrides ?? [],
    );
  }, [plan, containers, bays, ports, vessel]);
}

export function manualOverrideOf(plan: StowagePlan | undefined): StabilityMetricKey[] {
  return plan?.manualOverrides ?? [];
}
