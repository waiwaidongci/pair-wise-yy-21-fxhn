import type {
  Bay,
  Container,
  HydrostaticRow,
  Placement,
  StabilityIssue,
  StabilityResult,
  VesselSpec,
} from '../types/shipping';

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

export function calculateStability(
  placements: Placement[],
  containers: Container[],
  bays: Bay[],
  vessel: VesselSpec,
): StabilityResult {
  const containerMap = new Map(containers.map((container) => [container.id, container]));
  const bayMap = new Map(bays.map((bay) => [bay.id, bay]));
  let loadWeight = 0;
  let longitudinalMoment = 0;
  let transverseMoment = 0;
  let verticalMoment = 0;
  let reeferCount = 0;

  placements.forEach((placement) => {
    const container = containerMap.get(placement.containerId);
    const bay = bayMap.get(placement.bayId);
    if (!container || !bay) return;
    const vcg = 4.15 + (placement.tier - 1) * 2.59 + (container.type.startsWith('40') ? 1.3 : 0.62);
    loadWeight += container.grossWeight;
    longitudinalMoment += container.grossWeight * bay.longitudinalPosition;
    transverseMoment += container.grossWeight * (ROW_TRANSVERSE_POSITION[placement.row] ?? 0);
    verticalMoment += container.grossWeight * vcg;
    if (container.reefer) reeferCount += 1;
  });

  const displacement = vessel.lightshipWeight + loadWeight;
  const hydro = interpolateByDisplacement(vessel.hydrostaticTable, displacement);
  const tcg = loadWeight > 0 ? transverseMoment / loadWeight : 0;
  const cargoLcg = loadWeight > 0 ? longitudinalMoment / loadWeight : 0;
  const cargoVcg = loadWeight > 0 ? verticalMoment / loadWeight : 0;
  const lcg =
    (vessel.lightshipWeight * vessel.lightshipLcg + loadWeight * cargoLcg) / displacement;
  const kg =
    (vessel.lightshipWeight * vessel.lightshipVcg + loadWeight * cargoVcg) / displacement +
    reeferCount * 0.008;
  const freeSurfaceCorrection = Math.min(0.16, placements.length * 0.0025);
  const gm = Math.max(0.05, hydro.km - kg - freeSurfaceCorrection);
  const trim = ((lcg - hydro.lcb) * displacement) / Math.max(100, hydro.mct) / 100;
  const draftFore = hydro.draft + trim / 2;
  const draftAft = hydro.draft - trim / 2;
  const heel = (Math.atan(tcg / Math.max(0.1, gm)) * 180) / Math.PI;
  const issues: StabilityIssue[] = [];

  if (draftFore > vessel.maxDraft || draftAft > vessel.maxDraft) {
    issues.push({ metric: 'draft', severity: 'danger', message: '首尾吃水超过夏季载重线限制' });
  } else if (Math.max(draftFore, draftAft) > vessel.maxDraft - 0.35) {
    issues.push({ metric: 'draft', severity: 'warning', message: '吃水接近最大允许值，剩余装载余量不足 350 mm' });
  }
  if (Math.abs(trim) > vessel.maxTrim) {
    issues.push({ metric: 'trim', severity: 'danger', message: '纵倾超过 1.20 m 作业限值' });
  } else if (Math.abs(trim) > vessel.maxTrim * 0.75) {
    issues.push({ metric: 'trim', severity: 'warning', message: '纵倾接近限值，建议调整首尾箱量' });
  }
  if (Math.abs(heel) > vessel.maxHeel) {
    issues.push({ metric: 'heel', severity: 'danger', message: '横倾超过 3° 作业限值' });
  } else if (Math.abs(heel) > vessel.maxHeel * 0.7) {
    issues.push({ metric: 'heel', severity: 'warning', message: '横倾接近限值，建议左右舷调箱' });
  }
  if (gm < vessel.minGm) {
    issues.push({ metric: 'gm', severity: 'danger', message: '初稳性高度 GM 小于公司最低标准 0.80 m' });
  } else if (gm < vessel.minGm + 0.35) {
    issues.push({ metric: 'gm', severity: 'warning', message: 'GM 余量偏小，需关注甲板货与自由液面影响' });
  }

  const status = issues.some((issue) => issue.severity === 'danger')
    ? 'danger'
    : issues.length > 0 || Math.abs(heel) > 2.1
      ? 'warning'
      : 'stable';

  return {
    displacement,
    loadWeight,
    meanDraft: hydro.draft,
    draftFore,
    draftAft,
    trim,
    heel,
    gm,
    kg,
    lcg,
    tcg,
    vcg: cargoVcg,
    lcb: hydro.lcb,
    status,
    issues,
  };
}

export function interpolateByDisplacement(table: HydrostaticRow[], displacement: number): HydrostaticRow {
  if (displacement <= table[0].displacement) return table[0];
  const last = table[table.length - 1];
  if (displacement >= last.displacement) return last;
  const upperIndex = table.findIndex((row) => row.displacement >= displacement);
  const lower = table[upperIndex - 1];
  const upper = table[upperIndex];
  const ratio = (displacement - lower.displacement) / (upper.displacement - lower.displacement);
  return {
    draft: lerp(lower.draft, upper.draft, ratio),
    displacement,
    km: lerp(lower.km, upper.km, ratio),
    lcb: lerp(lower.lcb, upper.lcb, ratio),
    mct: lerp(lower.mct, upper.mct, ratio),
  };
}

function lerp(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio;
}
