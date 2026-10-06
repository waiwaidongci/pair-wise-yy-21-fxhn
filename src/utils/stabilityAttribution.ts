import type {
  Bay,
  Container,
  MetricContribution,
  Placement,
  Port,
  RestowAction,
  Slot,
  StabilityAttribution,
  StabilityBreach,
  StabilityResult,
  StowageConflict,
  VesselSpec,
} from '../types/shipping';
import { calculateStability, rowTransversePosition, slotVcg } from './stability';
import { validateStowage } from './stowageRules';

const MAX_ACTION_CANDIDATES = 8;
const MAX_ACTIONS_PER_BREACH = 3;
const EPS = 1e-6;

type AdjustableMetric = 'trim' | 'heel' | 'gm';

interface MoveEvaluation {
  ok: boolean;
  metricAfter: number;
  reason: string;
}

/**
 * 稳性超限归因：对每项超限指标按箱计算力矩贡献，并搜索"可落地"的调箱动作。
 * 纯派生计算——调用方需在格位或港序变化后重新执行（指纹随之改变，旧结果即失效）。
 */
export function computeStabilityAttribution(
  placements: Placement[],
  containers: Container[],
  bays: Bay[],
  vessel: VesselSpec,
  ports: Port[],
): StabilityAttribution {
  const stability = calculateStability(placements, containers, bays, vessel);
  const baselineKeys = new Set(
    validateStowage(placements, containers, bays, ports).map(conflictKey),
  );
  const breaches: StabilityBreach[] = [];

  for (const issue of stability.issues) {
    if (issue.metric === 'draft') {
      breaches.push({
        metric: 'draft',
        severity: issue.severity,
        label: '吃水',
        value: Math.max(stability.draftFore, stability.draftAft),
        limit: vessel.maxDraft,
        unit: 'm',
        topContributors: [],
        actions: [],
        queued: [],
        status: 'manual',
        manualReason: '吃水超限由总装载量决定，调箱无法改变，需减载或调整压载水。',
      });
      continue;
    }
    breaches.push(
      buildAdjustableBreach(
        issue.metric,
        issue.severity,
        placements,
        containers,
        bays,
        vessel,
        ports,
        stability,
        baselineKeys,
      ),
    );
  }

  return {
    fingerprint: attributionFingerprint(placements, containers, ports),
    computedAt: new Date().toISOString(),
    breaches,
  };
}

/** 指纹随格位、箱属性（重量/目的港/危险品/冷藏）与港序一起变化，用于判定旧归因失效。 */
export function attributionFingerprint(
  placements: Placement[],
  containers: Container[],
  ports: Port[],
): string {
  const containerMap = new Map(containers.map((container) => [container.id, container]));
  const placementPart = placements
    .map((placement) => {
      const container = containerMap.get(placement.containerId);
      return [
        `${placement.containerId}@${placement.bayId}/${placement.row}/${placement.tier}`,
        container?.grossWeight ?? 0,
        container?.portCode ?? '',
        container?.hazardClass ?? '',
        container?.reefer ? 'R' : '',
      ].join(':');
    })
    .sort()
    .join('|');
  const portPart = ports
    .map((port) => `${port.code}#${port.sequence}`)
    .sort()
    .join('|');
  const text = `${placementPart}~${portPart}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function buildAdjustableBreach(
  metric: AdjustableMetric,
  severity: 'warning' | 'danger',
  placements: Placement[],
  containers: Container[],
  bays: Bay[],
  vessel: VesselSpec,
  ports: Port[],
  stability: StabilityResult,
  baselineKeys: Set<string>,
): StabilityBreach {
  const contributions = rankContributions(metric, placements, containers, bays, stability);
  const { actions, queued, reasons } = searchRestowActions(
    metric,
    contributions,
    placements,
    containers,
    bays,
    vessel,
    ports,
    stability,
    baselineKeys,
  );
  const spec = metricSpec(metric, stability, vessel);
  return {
    metric,
    severity,
    label: spec.label,
    value: spec.value,
    limit: spec.limit,
    unit: spec.unit,
    topContributors: contributions.slice(0, 5),
    actions,
    queued,
    status: actions.length > 0 ? 'actionable' : 'manual',
    manualReason:
      actions.length > 0
        ? undefined
        : reasons.length > 0
          ? reasons.join('；')
          : '没有对该项超限产生同向力矩的集装箱，需人工复核装载结构。',
  };
}

/** 按箱计算对该项超限的"有害"力矩贡献，并按贡献降序排列。 */
function rankContributions(
  metric: AdjustableMetric,
  placements: Placement[],
  containers: Container[],
  bays: Bay[],
  stability: StabilityResult,
): MetricContribution[] {
  const containerMap = new Map(containers.map((container) => [container.id, container]));
  const bayMap = new Map(bays.map((bay) => [bay.id, bay]));
  const direction =
    metric === 'trim'
      ? Math.sign(stability.trim) || 1
      : metric === 'heel'
        ? Math.sign(stability.heel) || 1
        : 1;
  const ranked: Array<MetricContribution & { harmful: number }> = [];

  for (const placement of placements) {
    const container = containerMap.get(placement.containerId);
    const bay = bayMap.get(placement.bayId);
    if (!container || !bay) continue;
    let moment: number;
    if (metric === 'trim') {
      moment = container.grossWeight * (bay.longitudinalPosition - stability.lcb);
    } else if (metric === 'heel') {
      moment = container.grossWeight * rowTransversePosition(placement.row);
    } else {
      moment = container.grossWeight * slotVcg(placement.tier, container.type);
    }
    const harmful = metric === 'gm' ? moment : moment * direction;
    if (harmful <= EPS) continue;
    ranked.push({
      containerId: container.id,
      slot: { bayId: placement.bayId, row: placement.row, tier: placement.tier },
      moment,
      share: 0,
      harmful,
    });
  }

  ranked.sort((a, b) => b.harmful - a.harmful);
  const totalHarmful = ranked.reduce((sum, entry) => sum + entry.harmful, 0);
  return ranked.map(({ harmful, ...entry }) => ({
    ...entry,
    share: totalHarmful > EPS ? harmful / totalHarmful : 0,
  }));
}

/**
 * 按贡献大小依次为主要贡献箱寻找落点；落点被前者占用后不再可用，
 * 可用格位不足时后续贡献箱自动进入排队（待人工）。
 */
function searchRestowActions(
  metric: AdjustableMetric,
  contributions: MetricContribution[],
  placements: Placement[],
  containers: Container[],
  bays: Bay[],
  vessel: VesselSpec,
  ports: Port[],
  stability: StabilityResult,
  baselineKeys: Set<string>,
): { actions: RestowAction[]; queued: MetricContribution[]; reasons: string[] } {
  const containerMap = new Map(containers.map((container) => [container.id, container]));
  const reservedSlots = new Set<string>();
  const actions: RestowAction[] = [];
  const queued: MetricContribution[] = [];
  const reasonCounts = new Map<string, number>();

  for (const contributor of contributions.slice(0, MAX_ACTION_CANDIDATES)) {
    if (actions.length >= MAX_ACTIONS_PER_BREACH) break;
    const placement = placements.find((entry) => entry.containerId === contributor.containerId);
    const container = containerMap.get(contributor.containerId);
    if (!placement || !container) continue;
    const buried = placements.some(
      (entry) =>
        entry.id !== placement.id &&
        entry.bayId === placement.bayId &&
        entry.row === placement.row &&
        entry.tier > placement.tier,
    );
    if (buried) {
      queued.push(contributor);
      reasonCounts.set('被上层箱压住，需先移走上层箱', (reasonCounts.get('被上层箱压住，需先移走上层箱') ?? 0) + 1);
      continue;
    }
    const candidates = candidateSlots(metric, placement, container, placements, bays, containers, reservedSlots, stability);
    let accepted: { to: Slot; metricAfter: number } | null = null;
    for (const to of candidates) {
      const evaluation = evaluateMove(
        metric,
        placement,
        to,
        placements,
        containers,
        bays,
        vessel,
        ports,
        stability,
        baselineKeys,
      );
      if (evaluation.ok) {
        accepted = { to, metricAfter: evaluation.metricAfter };
        break;
      }
      reasonCounts.set(evaluation.reason, (reasonCounts.get(evaluation.reason) ?? 0) + 1);
    }
    if (accepted) {
      reservedSlots.add(slotKey(accepted.to));
      actions.push({
        id: `${container.id}->${accepted.to.bayId}/${accepted.to.row}/${accepted.to.tier}`,
        containerId: container.id,
        from: { bayId: placement.bayId, row: placement.row, tier: placement.tier },
        to: accepted.to,
        metricAfter: accepted.metricAfter,
        impact: contributor.share,
      });
    } else {
      queued.push(contributor);
      if (candidates.length === 0) {
        reasonCounts.set('可用空格位不足', (reasonCounts.get('可用空格位不足') ?? 0) + 1);
      }
    }
  }

  const reasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason]) => reason);
  return { actions, queued, reasons };
}

/** 枚举空格位：要求有支撑、冷藏不越层、堆重不超限，且移动方向能减小该项超限。 */
function candidateSlots(
  metric: AdjustableMetric,
  placement: Placement,
  container: Container,
  placements: Placement[],
  bays: Bay[],
  containers: Container[],
  reservedSlots: Set<string>,
  stability: StabilityResult,
): Slot[] {
  const containerMap = new Map(containers.map((entry) => [entry.id, entry]));
  const bayMap = new Map(bays.map((bay) => [bay.id, bay]));
  const fromBay = bayMap.get(placement.bayId);
  if (!fromBay) return [];
  const occupied = new Set(
    placements.filter((entry) => entry.id !== placement.id).map((entry) => slotKey(entry)),
  );
  const stackWeight = new Map<string, number>();
  for (const entry of placements) {
    if (entry.id === placement.id) continue;
    const stacked = containerMap.get(entry.containerId);
    if (!stacked) continue;
    const key = `${entry.bayId}:${entry.row}`;
    stackWeight.set(key, (stackWeight.get(key) ?? 0) + stacked.grossWeight);
  }

  const trimDirection = Math.sign(stability.trim) || 1;
  const heelDirection = Math.sign(stability.heel) || 1;
  const fromTransverse = rowTransversePosition(placement.row);
  const fromVcg = slotVcg(placement.tier, container.type);
  const candidates: Array<{ slot: Slot; estimate: number }> = [];

  for (const bay of bays) {
    for (let row = 1; row <= bay.rows; row += 1) {
      for (let tier = 1; tier <= bay.tiers; tier += 1) {
        const key = `${bay.id}:${row}:${tier}`;
        if (occupied.has(key) || reservedSlots.has(key)) continue;
        if (tier > 1 && !occupied.has(`${bay.id}:${row}:${tier - 1}`)) continue;
        if (container.reefer && tier > 3) continue;
        if ((stackWeight.get(`${bay.id}:${row}`) ?? 0) + container.grossWeight > bay.maxStackWeight + EPS) {
          continue;
        }
        let estimate = 0;
        if (metric === 'trim') {
          const delta = bay.longitudinalPosition - fromBay.longitudinalPosition;
          if (delta * trimDirection >= 0) continue;
          estimate = Math.abs(container.grossWeight * delta);
        } else if (metric === 'heel') {
          const delta = rowTransversePosition(row) - fromTransverse;
          if (delta * heelDirection >= 0) continue;
          estimate = Math.abs(container.grossWeight * delta);
        } else {
          const delta = slotVcg(tier, container.type) - fromVcg;
          if (delta >= 0) continue;
          estimate = Math.abs(container.grossWeight * delta);
        }
        candidates.push({ slot: { bayId: bay.id, row, tier }, estimate });
      }
    }
  }

  return candidates.sort((a, b) => b.estimate - a.estimate).map((candidate) => candidate.slot);
}

/**
 * 模拟单次调箱：该项指标必须回到限值内，其余指标不得恶化，
 * 且不得新增危险级冲突、错港顺序或冷藏层位问题（港序/堆重/隔离/冷藏为硬约束）。
 */
function evaluateMove(
  metric: AdjustableMetric,
  placement: Placement,
  to: Slot,
  placements: Placement[],
  containers: Container[],
  bays: Bay[],
  vessel: VesselSpec,
  ports: Port[],
  stability: StabilityResult,
  baselineKeys: Set<string>,
): MoveEvaluation {
  const simulated = placements.map((entry) =>
    entry.id === placement.id ? { ...entry, bayId: to.bayId, row: to.row, tier: to.tier } : entry,
  );
  const after = calculateStability(simulated, containers, bays, vessel);
  const metricAfter = metricValue(metric, after);

  if (!withinLimit(metric, after, vessel)) {
    return { ok: false, metricAfter, reason: '单箱调位不足以回到限值内' };
  }
  if (
    metric !== 'trim' &&
    Math.abs(after.trim) > Math.max(Math.abs(stability.trim), vessel.maxTrim) + EPS
  ) {
    return { ok: false, metricAfter, reason: '会加剧纵倾超限' };
  }
  if (
    metric !== 'heel' &&
    Math.abs(after.heel) > Math.max(Math.abs(stability.heel), vessel.maxHeel) + EPS
  ) {
    return { ok: false, metricAfter, reason: '会加剧横倾超限' };
  }
  if (metric !== 'gm' && after.gm < Math.min(stability.gm, vessel.minGm) - EPS) {
    return { ok: false, metricAfter, reason: '会压低初稳性 GM' };
  }
  if (
    Math.max(after.draftFore, after.draftAft) >
    Math.max(stability.draftFore, stability.draftAft) + EPS
  ) {
    return { ok: false, metricAfter, reason: '会加剧吃水超限' };
  }

  const afterConflicts = validateStowage(simulated, containers, bays, ports);
  const blocking = afterConflicts.find(
    (conflict) =>
      !baselineKeys.has(conflictKey(conflict)) &&
      (conflict.severity === 'danger' || conflict.type === 'wrong-port' || conflict.id.startsWith('reefer:')),
  );
  if (blocking) {
    return { ok: false, metricAfter, reason: `候选落点违反${blockingConstraintLabel(blocking)}` };
  }
  return { ok: true, metricAfter, reason: '' };
}

function metricSpec(
  metric: AdjustableMetric,
  stability: StabilityResult,
  vessel: VesselSpec,
): { label: string; value: number; limit: number; unit: string } {
  if (metric === 'trim') {
    return { label: '纵倾', value: stability.trim, limit: vessel.maxTrim, unit: 'm' };
  }
  if (metric === 'heel') {
    return { label: '横倾', value: stability.heel, limit: vessel.maxHeel, unit: '°' };
  }
  return { label: '初稳性 GM', value: stability.gm, limit: vessel.minGm, unit: 'm' };
}

function metricValue(metric: AdjustableMetric, stability: StabilityResult): number {
  if (metric === 'trim') return stability.trim;
  if (metric === 'heel') return stability.heel;
  return stability.gm;
}

function withinLimit(metric: AdjustableMetric, stability: StabilityResult, vessel: VesselSpec): boolean {
  if (metric === 'trim') return Math.abs(stability.trim) <= vessel.maxTrim + EPS;
  if (metric === 'heel') return Math.abs(stability.heel) <= vessel.maxHeel + EPS;
  return stability.gm >= vessel.minGm - EPS;
}

function conflictKey(conflict: StowageConflict): string {
  return `${conflict.type}:${[...conflict.containerIds].sort().join('+')}`;
}

function blockingConstraintLabel(conflict: StowageConflict): string {
  if (conflict.id.startsWith('reefer:')) return '冷藏层位限制';
  const labels: Partial<Record<StowageConflict['type'], string>> = {
    'wrong-port': '目的港顺序',
    'stack-limit': '堆重上限',
    segregation: '危险品隔离',
    overweight: '单箱限重',
  };
  return labels[conflict.type] ?? '配载规则';
}

function slotKey(slot: Slot): string {
  return `${slot.bayId}:${slot.row}:${slot.tier}`;
}
