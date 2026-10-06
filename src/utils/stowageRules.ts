import type {
  Bay,
  Container,
  Placement,
  Port,
  Slot,
  StowageConflict,
} from '../types/shipping';

export const INCOMPATIBLE: Record<string, string[]> = {
  '1.1': ['1.1', '2.1', '3', '4.1', '5.1', '6.1', '8'],
  '2.1': ['1.1', '5.1'],
  '3': ['1.1', '5.1', '8'],
  '4.1': ['1.1', '8'],
  '5.1': ['1.1', '2.1', '3', '6.1'],
  '6.1': ['1.1', '5.1'],
  '8': ['1.1', '3', '4.1'],
};

export function validateStowage(
  placements: Placement[],
  containers: Container[],
  bays: Bay[],
  ports: Port[],
): StowageConflict[] {
  const conflicts: StowageConflict[] = [];
  const containerMap = new Map(containers.map((container) => [container.id, container]));
  const bayMap = new Map(bays.map((bay) => [bay.id, bay]));
  const portMap = new Map(ports.map((port) => [port.code, port]));
  const byStack = new Map<string, Placement[]>();

  placements.forEach((placement) => {
    const container = containerMap.get(placement.containerId);
    if (!container) return;
    const maxGross = container.type.startsWith('40') ? 36 : 30.48;
    if (container.grossWeight > maxGross) {
      conflicts.push({
        id: `overweight:${placement.id}`,
        type: 'overweight',
        severity: 'danger',
        slot: slotOf(placement),
        containerIds: [container.id],
        title: `${container.number} 超过 ${maxGross} t 限重`,
        detail: `贝位 ${placement.bayId} / 排 ${placement.row} / 层 ${placement.tier} 的箱重为 ${container.grossWeight.toFixed(2)} t。`,
        suggestion: '将重箱调至下层或更换轻箱，并复核局部甲板强度。',
      });
    }
    if (container.reefer && placement.tier > 3) {
      conflicts.push({
        id: `reefer:${placement.id}`,
        type: 'top-heavy',
        severity: 'warning',
        slot: slotOf(placement),
        containerIds: [container.id],
        title: `${container.number} 冷藏箱层位过高`,
        detail: '冷藏箱应布置在具备供电和检修通道的低层格位。',
        suggestion: '将冷藏箱调整至 1—3 层，并确认插座与检修面可用。',
      });
    }
    const stackKey = `${placement.bayId}:${placement.row}`;
    byStack.set(stackKey, [...(byStack.get(stackKey) ?? []), placement]);
  });

  byStack.forEach((stack) => {
    const ordered = [...stack].sort((a, b) => a.tier - b.tier);
    const bay = bayMap.get(ordered[0].bayId);
    if (!bay) return;
    let stackWeight = 0;
    ordered.forEach((placement) => {
      const container = containerMap.get(placement.containerId);
      if (container) stackWeight += container.grossWeight;
    });
    if (stackWeight > bay.maxStackWeight) {
      const top = ordered[ordered.length - 1];
      conflicts.push({
        id: `stack:${top.id}`,
        type: 'stack-limit',
        severity: 'danger',
        slot: slotOf(top),
        containerIds: ordered.map((placement) => placement.containerId),
        title: `贝位 ${bay.name} 排 ${top.row} 堆重超限`,
        detail: `该栈实际堆重 ${stackWeight.toFixed(1)} t，超过允许值 ${bay.maxStackWeight} t。`,
        suggestion: `至少卸载 ${(stackWeight - bay.maxStackWeight).toFixed(1)} t 或移至相邻低负荷排。`,
      });
    }
    for (let lowerIndex = 0; lowerIndex < ordered.length - 1; lowerIndex += 1) {
      const lower = ordered[lowerIndex];
      const lowerContainer = containerMap.get(lower.containerId);
      if (!lowerContainer) continue;
      for (let upperIndex = lowerIndex + 1; upperIndex < ordered.length; upperIndex += 1) {
        const upper = ordered[upperIndex];
        const upperContainer = containerMap.get(upper.containerId);
        if (!upperContainer) continue;
        if (lowerContainer.grossWeight < upperContainer.grossWeight) {
          conflicts.push({
            id: `top-heavy:${lower.id}:${upper.id}`,
            type: 'top-heavy',
            severity: 'warning',
            slot: slotOf(upper),
            containerIds: [lowerContainer.id, upperContainer.id],
            title: `贝位 ${bay.name} 第 ${upper.row} 排上重下轻`,
            detail: `${lowerContainer.number}（${lowerContainer.grossWeight.toFixed(1)} t）位于 ${upperContainer.number}（${upperContainer.grossWeight.toFixed(1)} t）下方。`,
            suggestion: '重箱下移、轻箱上移，使重量沿层高递减。',
          });
        }
        const lowerPort = portMap.get(lowerContainer.portCode);
        const upperPort = portMap.get(upperContainer.portCode);
        if (lowerPort && upperPort && lowerPort.sequence < upperPort.sequence) {
          conflicts.push({
            id: `port:${lower.id}:${upper.id}`,
            type: 'wrong-port',
            severity: 'warning',
            slot: slotOf(upper),
            containerIds: [lowerContainer.id, upperContainer.id],
            title: `${upperContainer.number} 遮挡先卸港货物`,
            detail: `上层箱卸港为${upperPort.name}，但下层 ${lowerContainer.number} 属于更早的${lowerPort.name}港。`,
            suggestion: '将先卸港重箱置于上层，或调整该栈港序。',
          });
        }
      }
    }
  });

  for (let index = 0; index < placements.length; index += 1) {
    const first = placements[index];
    const firstContainer = containerMap.get(first.containerId);
    if (!firstContainer || firstContainer.hazardClass === 'none') continue;
    for (let peerIndex = index + 1; peerIndex < placements.length; peerIndex += 1) {
      const second = placements[peerIndex];
      const secondContainer = containerMap.get(second.containerId);
      if (!secondContainer || secondContainer.hazardClass === 'none') continue;
      const horizontalDistance = Math.abs(first.bayId - second.bayId) + Math.abs(first.row - second.row);
      const verticalDistance = Math.abs(first.tier - second.tier);
      const incompatible =
        INCOMPATIBLE[firstContainer.hazardClass]?.includes(secondContainer.hazardClass) ||
        INCOMPATIBLE[secondContainer.hazardClass]?.includes(firstContainer.hazardClass);
      if (incompatible && horizontalDistance <= 2 && verticalDistance <= 2) {
        conflicts.push({
          id: `segregation:${first.id}:${second.id}`,
          type: 'segregation',
          severity: firstContainer.hazardClass === '1.1' || secondContainer.hazardClass === '1.1' ? 'danger' : 'warning',
          slot: slotOf(second),
          containerIds: [firstContainer.id, secondContainer.id],
          title: `危险品 ${firstContainer.hazardClass} / ${secondContainer.hazardClass} 隔离不足`,
          detail: `${firstContainer.number} 与 ${secondContainer.number} 位于相邻贝排层，不满足简化隔离矩阵要求。`,
          suggestion: '至少错开一个贝位、两排或两层，并复核 IMDG 隔离表。',
        });
      }
    }
  }

  return dedupeConflicts(conflicts);
}

function slotOf(placement: Placement): Slot {
  return { bayId: placement.bayId, row: placement.row, tier: placement.tier };
}

function dedupeConflicts(conflicts: StowageConflict[]): StowageConflict[] {
  const map = new Map<string, StowageConflict>();
  conflicts.forEach((conflict) => {
    const canonical = conflict.id.split(':').sort().join(':');
    if (!map.has(canonical)) map.set(canonical, conflict);
  });
  return [...map.values()];
}

export function classLabel(hazardClass: Container['hazardClass']): string {
  return hazardClass === 'none' ? '普货' : `IMDG ${hazardClass}`;
}
