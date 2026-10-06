import type {
  Bay,
  Container,
  Placement,
  Port,
  Slot,
  StabilityMetricKey,
  StabilityResult,
  VesselSpec,
} from '../types/shipping';
import { calculateStability, containerVcg, interpolateByDisplacement } from './stability';
import { INCOMPATIBLE } from './stowageRules';

const ROW_TRANSVERSE_POSITION: Record<number, number> = {
  1: -8.4,
  2: -6.0,
  3: -3.6,
  4: -1.2,
  5: 1.2,
  6: 3.6,
  7: 6.0,
  8: 8.4,
};

/** 调整后指标需回到限值的 92% 以内，留出安全余量 */
const TRIM_MARGIN_RATIO = 0.92;
const HEEL_MARGIN_RATIO = 0.92;
const GM_MARGIN = 0.05;

const MAX_DRIVERS = 8;
const DRIVER_SEARCH_POOL = 12;

export interface ContainerContribution {
  containerId: string;
  containerNumber: string;
  containerType: string;
  portCode: string;
  hazardClass: string;
  reefer: boolean;
  weight: number;
  bayId: number;
  bayName: string;
  row: number;
  tier: number;
  /** 纵向力矩 w * x（t·m） */
  longitudinal: number;
  /** 横向力矩 w * y（t·m） */
  transverse: number;
  /** 垂向力矩 w * vcg（t·m） */
  vertical: number;
  /** 对纵倾力矩的贡献 w * (x - lcb)（t·m） */
  trimMoment: number;
  /** 对横倾力矩的贡献 w * y（t·m） */
  heelMoment: number;
  /** 对 KG 的贡献 w * vcg / 排水量（m） */
  gmContribution: number;
}

export interface MoveCandidate {
  containerId: string;
  containerNumber: string;
  from: Slot;
  to: Slot;
  afterTrim: number;
  afterHeel: number;
  afterGm: number;
  /** 约束是否可行（港序/堆重/隔离/冷藏/支撑） */
  feasible: boolean;
  /** 调整后目标指标是否回到限值内（含余量） */
  fixesTarget: boolean;
  /** 是否把另一项指标顶出限值 */
  breaksOther: boolean;
  reasons: string[];
  /** 三相指标最小裕度，越大越稳 */
  score: number;
}

export interface MetricAttribution {
  metric: StabilityMetricKey;
  label: string;
  unit: string;
  value: number;
  limit: number;
  exceeded: boolean;
  nearLimit: boolean;
  /** 超限幅度（纵倾/横倾为超出量，GM 为缺口） */
  excess: number;
  /** 当前力矩（纵倾/横倾） */
  currentMoment: number;
  /** 限值内允许的力矩预算 */
  momentBudget: number;
  /** 影响最大的集装箱（按贡献同号绝对值排序） */
  drivers: ContainerContribution[];
  /** 可行调箱动作（能在不拆台的前提下把本项调回限值） */
  moves: MoveCandidate[];
  bestMove: MoveCandidate | null;
  /** 最佳单次部分调整（不能完全调回时展示残余量） */
  bestPartialMove: MoveCandidate | null;
  manual: boolean;
  manualReason: string | null;
}

export interface StabilityAttribution {
  stability: StabilityResult;
  metrics: Record<StabilityMetricKey, MetricAttribution>;
  unhandledDanger: StabilityMetricKey[];
  hasDanger: boolean;
}

interface RuleContext {
  containerMap: Map<string, Container>;
  bayMap: Map<number, Bay>;
  portMap: Map<string, Port>;
}

export function buildAttribution(
  placements: Placement[],
  containers: Container[],
  bays: Bay[],
  ports: Port[],
  vessel: VesselSpec,
  stability: StabilityResult,
  manualOverrides: StabilityMetricKey[] = [],
): StabilityAttribution {
  const ctx: RuleContext = {
    containerMap: new Map(containers.map((container) => [container.id, container])),
    bayMap: new Map(bays.map((bay) => [bay.id, bay])),
    portMap: new Map(ports.map((port) => [port.code, port])),
  };
  const contributions = computeContributions(placements, ctx, stability);
  const hydro = interpolateByDisplacement(vessel.hydrostaticTable, stability.displacement);

  const trim = buildTrimMetric(placements, contributions, ctx, vessel, stability, hydro.mct);
  const heel = buildHeelMetric(placements, contributions, ctx, vessel, stability);
  const gm = buildGmMetric(placements, contributions, ctx, vessel, stability);

  const metrics: Record<StabilityMetricKey, MetricAttribution> = { trim, heel, gm };
  // 只对超限指标搜索调箱动作，正常指标不做无谓计算
  (Object.keys(metrics) as StabilityMetricKey[]).forEach((key) => {
    const m = metrics[key];
    if (!m.exceeded) {
      m.moves = [];
      m.bestMove = null;
      m.bestPartialMove = null;
    }
  });
  (Object.keys(metrics) as StabilityMetricKey[]).forEach((metric) => {
    const m = metrics[metric];
    m.manual = m.exceeded && manualOverrides.includes(metric);
    if (m.manual) m.manualReason = manualReasonOf(m);
  });

  const unhandledDanger = (Object.keys(metrics) as StabilityMetricKey[]).filter(
    (metric) => metrics[metric].exceeded && !metrics[metric].manual,
  );

  return {
    stability,
    metrics,
    unhandledDanger,
    hasDanger: unhandledDanger.length > 0,
  };
}

function computeContributions(
  placements: Placement[],
  ctx: RuleContext,
  stability: StabilityResult,
): ContainerContribution[] {
  const result: ContainerContribution[] = [];
  placements.forEach((placement) => {
    const container = ctx.containerMap.get(placement.containerId);
    const bay = ctx.bayMap.get(placement.bayId);
    if (!container || !bay) return;
    const vcg = containerVcg(container, placement.tier);
    const y = ROW_TRANSVERSE_POSITION[placement.row] ?? 0;
    result.push({
      containerId: container.id,
      containerNumber: container.number,
      containerType: container.type,
      portCode: container.portCode,
      hazardClass: container.hazardClass,
      reefer: container.reefer,
      weight: container.grossWeight,
      bayId: bay.id,
      bayName: bay.name,
      row: placement.row,
      tier: placement.tier,
      longitudinal: container.grossWeight * bay.longitudinalPosition,
      transverse: container.grossWeight * y,
      vertical: container.grossWeight * vcg,
      trimMoment: container.grossWeight * (bay.longitudinalPosition - stability.lcb),
      heelMoment: container.grossWeight * y,
      gmContribution: (container.grossWeight * vcg) / Math.max(1, stability.displacement),
    });
  });
  return result;
}

function buildTrimMetric(
  placements: Placement[],
  contributions: ContainerContribution[],
  ctx: RuleContext,
  vessel: VesselSpec,
  stability: StabilityResult,
  mct: number,
): MetricAttribution {
  const value = stability.trim;
  const limit = vessel.maxTrim;
  const exceeded = Math.abs(value) > limit;
  const nearLimit = !exceeded && Math.abs(value) > limit * 0.75;
  const sign = value >= 0 ? 1 : -1;
  const currentMoment = stability.displacement * (stability.lcg - stability.lcb);
  const momentBudget = limit * Math.max(100, mct) * 100;
  const drivers = contributions
    .filter((c) => Math.sign(c.trimMoment) === sign && c.trimMoment !== 0)
    .sort((a, b) => Math.abs(b.trimMoment) - Math.abs(a.trimMoment))
    .slice(0, MAX_DRIVERS);
  const { moves, bestMove, bestPartialMove } = findMovesForMetric(
    'trim',
    drivers,
    placements,
    ctx,
    vessel,
    stability,
  );
  return {
    metric: 'trim',
    label: '纵倾',
    unit: 'm',
    value,
    limit,
    exceeded,
    nearLimit,
    excess: Math.max(0, Math.abs(value) - limit),
    currentMoment,
    momentBudget,
    drivers,
    moves,
    bestMove,
    bestPartialMove,
    manual: false,
    manualReason: null,
  };
}

function buildHeelMetric(
  placements: Placement[],
  contributions: ContainerContribution[],
  ctx: RuleContext,
  vessel: VesselSpec,
  stability: StabilityResult,
): MetricAttribution {
  const value = stability.heel;
  const limit = vessel.maxHeel;
  const exceeded = Math.abs(value) > limit;
  const nearLimit = !exceeded && Math.abs(value) > limit * 0.7;
  const sign = value >= 0 ? 1 : -1;
  const currentMoment = stability.loadWeight * stability.tcg;
  const gm = Math.max(0.1, stability.gm);
  const momentBudget = stability.loadWeight * gm * Math.tan((limit * Math.PI) / 180);
  const drivers = contributions
    .filter((c) => Math.sign(c.heelMoment) === sign && c.heelMoment !== 0)
    .sort((a, b) => Math.abs(b.heelMoment) - Math.abs(a.heelMoment))
    .slice(0, MAX_DRIVERS);
  const { moves, bestMove, bestPartialMove } = findMovesForMetric(
    'heel',
    drivers,
    placements,
    ctx,
    vessel,
    stability,
  );
  return {
    metric: 'heel',
    label: '横倾',
    unit: '°',
    value,
    limit,
    exceeded,
    nearLimit,
    excess: Math.max(0, Math.abs(value) - limit),
    currentMoment,
    momentBudget,
    drivers,
    moves,
    bestMove,
    bestPartialMove,
    manual: false,
    manualReason: null,
  };
}

function buildGmMetric(
  placements: Placement[],
  contributions: ContainerContribution[],
  ctx: RuleContext,
  vessel: VesselSpec,
  stability: StabilityResult,
): MetricAttribution {
  const value = stability.gm;
  const limit = vessel.minGm;
  const exceeded = value < limit;
  const nearLimit = !exceeded && value < limit + 0.35;
  const currentMoment = contributions.reduce((sum, c) => sum + c.vertical, 0);
  const momentBudget = 0;
  const drivers = [...contributions]
    .sort((a, b) => b.vertical - a.vertical)
    .slice(0, MAX_DRIVERS);
  const { moves, bestMove, bestPartialMove } = findMovesForMetric(
    'gm',
    drivers,
    placements,
    ctx,
    vessel,
    stability,
  );
  return {
    metric: 'gm',
    label: '初稳性 GM',
    unit: 'm',
    value,
    limit,
    exceeded,
    nearLimit,
    excess: Math.max(0, limit - value),
    currentMoment,
    momentBudget,
    drivers,
    moves,
    bestMove,
    bestPartialMove,
    manual: false,
    manualReason: null,
  };
}

function findMovesForMetric(
  metric: StabilityMetricKey,
  drivers: ContainerContribution[],
  placements: Placement[],
  ctx: RuleContext,
  vessel: VesselSpec,
  stability: StabilityResult,
): { moves: MoveCandidate[]; bestMove: MoveCandidate | null; bestPartialMove: MoveCandidate | null } {
  const results: MoveCandidate[] = [];
  const driverPool = drivers.slice(0, DRIVER_SEARCH_POOL);
  const driverIds = new Set(driverPool.map((d) => d.containerId));
  const driverPlacements = placements.filter((p) => driverIds.has(p.containerId));
  const occupied = new Set(placements.map((p) => slotKey(p)));
  const emptySlots = listSupportedEmptySlots(placements, ctx.bayMap);

  driverPlacements.forEach((placement) => {
    const container = ctx.containerMap.get(placement.containerId);
    if (!container) return;
    emptySlots.forEach((to) => {
      if (to.bayId === placement.bayId && to.row === placement.row && to.tier === placement.tier) return;
      const reasons = checkMoveConstraints(container, placement, to, placements, ctx);
      if (reasons.length > 0) return;
      const movedPlacements = placements.map((p) =>
        p === placement ? { ...placement, bayId: to.bayId, row: to.row, tier: to.tier } : p,
      );
      const after = calculateStability(movedPlacements, Array.from(ctx.containerMap.values()), Array.from(ctx.bayMap.values()), vessel);
      const fixes =
        metric === 'trim'
          ? Math.abs(after.trim) <= vessel.maxTrim * TRIM_MARGIN_RATIO
          : metric === 'heel'
            ? Math.abs(after.heel) <= vessel.maxHeel * HEEL_MARGIN_RATIO
            : after.gm >= vessel.minGm + GM_MARGIN;
      const breaksOther =
        (Math.abs(after.trim) > vessel.maxTrim && Math.abs(stability.trim) <= vessel.maxTrim) ||
        (Math.abs(after.heel) > vessel.maxHeel && Math.abs(stability.heel) <= vessel.maxHeel) ||
        (after.gm < vessel.minGm && stability.gm >= vessel.minGm);
      const score = fixes && !breaksOther ? marginScore(after, vessel) : -1;
      results.push({
        containerId: container.id,
        containerNumber: container.number,
        from: { bayId: placement.bayId, row: placement.row, tier: placement.tier },
        to,
        afterTrim: after.trim,
        afterHeel: after.heel,
        afterGm: after.gm,
        feasible: true,
        fixesTarget: fixes,
        breaksOther,
        reasons: [],
        score,
      });
    });
  });

  results.sort((a, b) => b.score - a.score || a.containerId.localeCompare(b.containerId));
  const bestMove = results.find((r) => r.fixesTarget && !r.breaksOther) ?? null;
  const bestPartialMove = results.find((r) => !r.breaksOther) ?? null;
  return { moves: results, bestMove, bestPartialMove };
}

function marginScore(after: StabilityResult, vessel: VesselSpec): number {
  const trimMargin = 1 - Math.abs(after.trim) / vessel.maxTrim;
  const heelMargin = 1 - Math.abs(after.heel) / vessel.maxHeel;
  const gmMargin = after.gm / vessel.minGm - 1;
  return Math.min(trimMargin, heelMargin, gmMargin);
}

function listSupportedEmptySlots(placements: Placement[], bayMap: Map<number, Bay>): Slot[] {
  const occupied = new Set(placements.map((p) => slotKey(p)));
  const slots: Slot[] = [];
  bayMap.forEach((bay) => {
    for (let row = 1; row <= bay.rows; row += 1) {
      for (let tier = 1; tier <= bay.tiers; tier += 1) {
        const key = `${bay.id}:${row}:${tier}`;
        if (occupied.has(key)) continue;
        if (tier > 1 && !occupied.has(`${bay.id}:${row}:${tier - 1}`)) continue;
        slots.push({ bayId: bay.id, row, tier });
      }
    }
  });
  return slots;
}

function checkMoveConstraints(
  container: Container,
  from: Slot,
  to: Slot,
  placements: Placement[],
  ctx: RuleContext,
): string[] {
  const reasons: string[] = [];
  const movedPlacement = placements.find(
    (p) => p.containerId === container.id && p.bayId === from.bayId && p.row === from.row && p.tier === from.tier,
  );
  const remaining = placements.filter((p) => p !== movedPlacement);
  const bay = ctx.bayMap.get(to.bayId);
  if (!bay) return ['未知贝位'];

  if (to.tier > 1 && !remaining.some((p) => p.bayId === to.bayId && p.row === to.row && p.tier === to.tier - 1)) {
    reasons.push('目标格位悬空，无下层支撑');
  }
  if (container.reefer && to.tier > 3) {
    reasons.push('冷藏箱须布置在 1—3 层');
  }
  const stackWeight = remaining
    .filter((p) => p.bayId === to.bayId && p.row === to.row)
    .reduce((sum, p) => sum + (ctx.containerMap.get(p.containerId)?.grossWeight ?? 0), 0);
  if (stackWeight + container.grossWeight > bay.maxStackWeight) {
    reasons.push(`目标堆重将达 ${(stackWeight + container.grossWeight).toFixed(1)} t，超过 ${bay.maxStackWeight} t`);
  }
  const targetStack = remaining.filter((p) => p.bayId === to.bayId && p.row === to.row);
  const containerPort = ctx.portMap.get(container.portCode);
  targetStack.forEach((p) => {
    const peer = ctx.containerMap.get(p.containerId);
    if (!peer || !containerPort) return;
    const peerPort = ctx.portMap.get(peer.portCode);
    if (!peerPort) return;
    if (p.tier < to.tier && peerPort.sequence < containerPort.sequence) {
      reasons.push('移至此处会遮挡先卸港货物（港序冲突）');
    }
    if (p.tier > to.tier && containerPort.sequence < peerPort.sequence) {
      reasons.push('移至此处会被上层后卸港箱遮挡（港序冲突）');
    }
  });
  if (container.hazardClass !== 'none') {
    for (const p of remaining) {
      const peer = ctx.containerMap.get(p.containerId);
      if (!peer || peer.hazardClass === 'none') continue;
      const incompatible =
        INCOMPATIBLE[container.hazardClass]?.includes(peer.hazardClass) ||
        INCOMPATIBLE[peer.hazardClass]?.includes(container.hazardClass);
      if (
        incompatible &&
        Math.abs(p.bayId - to.bayId) + Math.abs(p.row - to.row) <= 2 &&
        Math.abs(p.tier - to.tier) <= 2
      ) {
        reasons.push(`与 ${peer.number} 的 ${peer.hazardClass} 危险品隔离不足`);
        break;
      }
    }
  }
  return reasons;
}

function manualReasonOf(metric: MetricAttribution): string {
  if (metric.moves.length === 0) {
    return '在满足目的港顺序、堆重上限、危险品隔离和冷藏层位的前提下，找不到可将本项调回限值内的空位，需人工统筹配载。';
  }
  return '可行调箱动作会导致另一项稳性指标超限，三项指标无法同时满足，需人工统筹。';
}

function slotKey(slot: Slot): string {
  return `${slot.bayId}:${slot.row}:${slot.tier}`;
}

export function attributionConflicts(attribution: StabilityAttribution): StowageConflictLike[] {
  const conflicts: StowageConflictLike[] = [];
  (Object.keys(attribution.metrics) as StabilityMetricKey[]).forEach((metricKey) => {
    const metric = attribution.metrics[metricKey];
    if (!metric.exceeded) return;
    const driver = metric.drivers[0];
    const topDrivers = metric.drivers.slice(0, 3);
    const driverText = topDrivers.length
      ? topDrivers.map((d) => `${d.containerNumber}（${momentText(metric, d)}）`).join('、')
      : '';
    conflicts.push({
      id: `stability:${metricKey}`,
      type: 'stability',
      severity: 'danger',
      slot: driver
        ? { bayId: driver.bayId, row: driver.row, tier: driver.tier }
        : { bayId: 2, row: 1, tier: 1 },
      containerIds: topDrivers.map((d) => d.containerId),
      title: `${metric.label}超限：${metric.value.toFixed(metric.unit === '°' ? 2 : 3)}${metric.unit}（限值 ${metric.limit.toFixed(metric.unit === '°' ? 2 : 3)}${metric.unit}）`,
      detail: metric.manual
        ? `已标记待人工处理。主因箱：${driverText}。`
        : `主因箱：${driverText}。`,
      suggestion: metric.manual
        ? '该指标已标记待人工处理，需配载主管复核后确认。'
        : metric.bestMove
          ? `建议将 ${metric.bestMove.containerNumber} 移至 贝${metric.bestMove.to.bayId}/${String(metric.bestMove.to.row).padStart(2, '0')}排/${metric.bestMove.to.tier}层，${metric.label}可降至 ${metric.bestMove[afterKey(metricKey)].toFixed(metric.unit === '°' ? 2 : 3)}${metric.unit}。`
          : '当前约束下无可行自动调箱动作，需人工处理。',
    });
  });
  return conflicts;
}

function afterKey(metric: StabilityMetricKey): 'afterTrim' | 'afterHeel' | 'afterGm' {
  return metric === 'trim' ? 'afterTrim' : metric === 'heel' ? 'afterHeel' : 'afterGm';
}

function momentText(metric: MetricAttribution, driver: ContainerContribution): string {
  if (metric.metric === 'trim') return `${driver.trimMoment > 0 ? '+' : ''}${driver.trimMoment.toFixed(0)} t·m`;
  if (metric.metric === 'heel') return `${driver.heelMoment > 0 ? '+' : ''}${driver.heelMoment.toFixed(0)} t·m`;
  return `${driver.vertical.toFixed(0)} t·m`;
}

export interface StowageConflictLike {
  id: string;
  type: 'stability';
  severity: 'danger';
  slot: Slot;
  containerIds: string[];
  title: string;
  detail: string;
  suggestion: string;
}
