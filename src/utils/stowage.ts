import type { Bay, Container, Placement } from '../types/shipping';

export function findAutoStowPlacements(
  containers: Container[],
  existingPlacements: Placement[],
  bays: Bay[],
): Placement[] {
  const placedIds = new Set(existingPlacements.map((placement) => placement.containerId));
  const occupied = new Set(
    existingPlacements.map((placement) => `${placement.bayId}:${placement.row}:${placement.tier}`),
  );
  const candidates = containers
    .filter((container) => !placedIds.has(container.id))
    .sort((a, b) => {
      if (a.reefer !== b.reefer) return a.reefer ? -1 : 1;
      if (a.hazardClass !== 'none' && b.hazardClass === 'none') return 1;
      return b.grossWeight - a.grossWeight;
    });
  const result: Placement[] = [];
  for (const container of candidates) {
    const slot = findSlot(container, bays, occupied, result);
    if (!slot) continue;
    occupied.add(`${slot.bayId}:${slot.row}:${slot.tier}`);
    result.push({
      ...slot,
      id: `AUTO-${Date.now()}-${container.id}`,
      containerId: container.id,
      placedAt: new Date().toISOString(),
    });
  }
  return result;
}

function findSlot(
  container: Container,
  bays: Bay[],
  occupied: Set<string>,
  assigned: Placement[],
): { bayId: number; row: number; tier: number } | null {
  const preferredBays = [...bays].sort((a, b) => {
    const aBias = Math.abs(a.longitudinalPosition) * 0.01 + (container.grossWeight > 22 ? Math.abs(a.longitudinalPosition) * 0.004 : 0);
    const bBias = Math.abs(b.longitudinalPosition) * 0.01 + (container.grossWeight > 22 ? Math.abs(b.longitudinalPosition) * 0.004 : 0);
    return aBias - bBias;
  });
  const tiers = container.reefer ? [1, 2, 3] : [1, 2, 3, 4, 5, 6];
  for (const bay of preferredBays) {
    for (const tier of tiers) {
      for (let row = 1; row <= bay.rows; row += 1) {
        const key = `${bay.id}:${row}:${tier}`;
        if (occupied.has(key)) continue;
        if (tier > 1 && !occupied.has(`${bay.id}:${row}:${tier - 1}`)) continue;
        if (!isRuleCompatible(container, bay.id, row, tier, assigned)) continue;
        return { bayId: bay.id, row, tier };
      }
    }
  }
  return null;
}

function isRuleCompatible(
  container: Container,
  bayId: number,
  row: number,
  tier: number,
  assigned: Placement[],
): boolean {
  if (container.hazardClass === 'none') return true;
  return !assigned.some((placement) => {
    if (Math.abs(placement.bayId - bayId) + Math.abs(placement.row - row) > 3) return false;
    return Math.abs(placement.tier - tier) <= 2;
  });
}
