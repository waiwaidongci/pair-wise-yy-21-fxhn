import type { Container, Placement, Port, StowagePlan, StabilityResult } from '../types/shipping';

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
  const csv = [header, ...csvRows, ...summary]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${plan.name.replaceAll(' ', '_')}_配载清单.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
