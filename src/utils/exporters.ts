import type {
  Container,
  Placement,
  Port,
  StowagePlan,
  StabilityAttribution,
  StabilityResult,
} from '../types/shipping';

export function downloadPlanPng(canvas: HTMLCanvasElement, plan: StowagePlan): void {
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `${plan.name.replaceAll(' ', '_')}_配载图.png`;
  link.click();
}

export function downloadManifest(
  plan: StowagePlan,
  containers: Container[],
  ports: Port[],
  stability: StabilityResult,
  attribution?: StabilityAttribution,
): void {
  const containerMap = new Map(containers.map((container) => [container.id, container]));
  const portMap = new Map(ports.map((port) => [port.code, port]));
  const rows = plan.placements
    .map((placement) => {
      const container = containerMap.get(placement.containerId);
      const port = container ? portMap.get(container.portCode) : undefined;
      return {
        placement,
        container,
        port,
      };
    })
    .filter((row) => row.container)
    .sort((a, b) => a.placement.bayId - b.placement.bayId || a.placement.row - b.placement.row || a.placement.tier - b.placement.tier);
  const header = [
    '贝位',
    '排号',
    '层号',
    '箱号',
    '箱型',
    '总重(t)',
    '目的港',
    '危险品等级',
    'UN编号',
    '货物',
  ];
  const csvRows = rows.map(({ placement, container, port }) => [
    placement.bayId,
    placement.row,
    placement.tier,
    container!.number,
    container!.type,
    container!.grossWeight.toFixed(2),
    `${port?.name ?? ''}(${container!.portCode})`,
    container!.hazardClass === 'none' ? '普货' : container!.hazardClass,
    container!.unNumber ?? '',
    container!.cargo,
  ]);
  const summary = [
    [],
    ['方案', plan.name],
    ['状态', plan.status === 'final' ? '已确认' : '试算'],
    ['总箱量', plan.placements.length],
    ['货物重量(t)', stability.loadWeight.toFixed(2)],
    ['平均吃水(m)', stability.meanDraft.toFixed(3)],
    ['首吃水(m)', stability.draftFore.toFixed(3)],
    ['尾吃水(m)', stability.draftAft.toFixed(3)],
    ['纵倾(m)', stability.trim.toFixed(3)],
    ['横倾(°)', stability.heel.toFixed(3)],
    ['GM(m)', stability.gm.toFixed(3)],
  ];
  const csv = [header, ...csvRows, ...summary, ...attributionRows(attribution, containers)]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${plan.name.replaceAll(' ', '_')}_配载清单.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function attributionRows(
  attribution: StabilityAttribution | undefined,
  containers: Container[],
): Array<Array<string | number>> {
  if (!attribution) return [];
  const containerMap = new Map(containers.map((container) => [container.id, container]));
  const rows: Array<Array<string | number>> = [
    [],
    [`稳性超限归因（指纹 ${attribution.fingerprint} · ${new Date(attribution.computedAt).toLocaleString('zh-CN')} 计算）`],
    ['指标', '当前值', '限值', '处理状态', '主要贡献箱（箱号@格位=力矩/占比）', '建议调箱动作', '待人工原因'],
  ];
  if (attribution.breaches.length === 0) {
    rows.push(['无超限项', '', '', '已满足全部稳性限值', '', '', '']);
    return rows;
  }
  attribution.breaches.forEach((breach) => {
    const contributors = breach.topContributors
      .slice(0, 3)
      .map((entry) => {
        const container = containerMap.get(entry.containerId);
        return `${container?.number ?? entry.containerId}@B${entry.slot.bayId}/${String(entry.slot.row).padStart(2, '0')}/${entry.slot.tier}=${entry.moment >= 0 ? '+' : ''}${entry.moment.toFixed(1)}t·m(${(entry.share * 100).toFixed(0)}%)`;
      })
      .join('；');
    const actions = breach.actions
      .map((action) => {
        const container = containerMap.get(action.containerId);
        return `${container?.number ?? action.containerId} B${action.from.bayId}/${String(action.from.row).padStart(2, '0')}/${action.from.tier}→B${action.to.bayId}/${String(action.to.row).padStart(2, '0')}/${action.to.tier}（调后${action.metricAfter.toFixed(2)}${breach.unit}）`;
      })
      .join('；');
    rows.push([
      breach.label,
      `${breach.value.toFixed(2)} ${breach.unit}`,
      `${breach.limit.toFixed(2)} ${breach.unit}`,
      breach.status === 'actionable' ? `可落地调箱 ${breach.actions.length} 条` : '待人工处理',
      contributors,
      actions,
      breach.status === 'manual' ? (breach.manualReason ?? '') : '',
    ]);
  });
  return rows;
}
