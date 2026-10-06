import type {
  Bay,
  Container,
  ContainerType,
  HazardClass,
  Placement,
  Port,
  StowagePlan,
  VesselSpec,
} from '../types/shipping';

export const PORTS: Port[] = [
  { code: 'CNSHA', name: '上海', country: '中国', sequence: 1, color: '#2563eb' },
  { code: 'CNNGB', name: '宁波', country: '中国', sequence: 2, color: '#0f766e' },
  { code: 'SGSIN', name: '新加坡', country: '新加坡', sequence: 3, color: '#c2410c' },
  { code: 'INNSA', name: '那瓦舍瓦', country: '印度', sequence: 4, color: '#7c3aed' },
  { code: 'NLRTM', name: '鹿特丹', country: '荷兰', sequence: 5, color: '#be123c' },
  { code: 'DEHAM', name: '汉堡', country: '德国', sequence: 6, color: '#0369a1' },
];

export const BAYS: Bay[] = Array.from({ length: 7 }, (_, index) => ({
  id: (index + 1) * 2,
  name: `${String((index + 1) * 2).padStart(2, '0')}`,
  longitudinalPosition: -60 + index * 20,
  rows: 8,
  tiers: 6,
  maxStackWeight: index < 2 ? 105 : 88,
}));

export const VESSEL: VesselSpec = {
  name: '远海之星',
  imo: 'IMO 9632187',
  voyage: 'V2610E',
  flag: '中国',
  lengthOverall: 294.1,
  breadth: 32.3,
  lightshipWeight: 28450,
  lightshipLcg: -1.48,
  lightshipVcg: 7.8,
  maxDraft: 14.5,
  minDraft: 7,
  maxTrim: 1.2,
  maxHeel: 3,
  minGm: 0.8,
  hydrostaticTable: [
    { draft: 7, displacement: 24700, km: 12.34, lcb: -1.12, mct: 178 },
    { draft: 8, displacement: 29800, km: 12.08, lcb: -1.48, mct: 190 },
    { draft: 9, displacement: 34950, km: 11.84, lcb: -1.72, mct: 202 },
    { draft: 10, displacement: 40200, km: 11.58, lcb: -1.82, mct: 215 },
    { draft: 11, displacement: 45500, km: 11.31, lcb: -1.78, mct: 228 },
    { draft: 12, displacement: 50950, km: 11.06, lcb: -1.62, mct: 241 },
    { draft: 13, displacement: 56400, km: 10.79, lcb: -1.28, mct: 255 },
    { draft: 14, displacement: 61900, km: 10.52, lcb: -0.82, mct: 269 },
    { draft: 14.5, displacement: 64800, km: 10.35, lcb: -0.52, mct: 277 },
  ],
};

const CARGOS = [
  '机电设备',
  '家用电器',
  '汽车配件',
  '纺织品',
  '光伏组件',
  '化工品',
  '冷链食品',
  '日用百货',
];
const TYPES: ContainerType[] = ['20GP', '40GP', '40HQ', '20RF'];
const BASE_WEIGHTS: Record<ContainerType, number> = { '20GP': 2.3, '40GP': 3.8, '40HQ': 4.1, '20RF': 3.2 };
const HAZARDS: HazardClass[] = ['none', 'none', 'none', 'none', '3', '8', '5.1', '2.1', '4.1', '1.1'];

export const CONTAINERS: Container[] = Array.from({ length: 72 }, (_, index) => {
  const type = TYPES[index % TYPES.length];
  const hazardClass = HAZARDS[(index * 7) % HAZARDS.length];
  const payload = 10 + ((index * 37) % 340) / 10;
  const tare = BASE_WEIGHTS[type];
  return {
    id: `C${String(index + 1).padStart(3, '0')}`,
    number: `${['MSCU', 'COSU', 'OOLU', 'CMAU'][index % 4]}${String(5362100 + index * 173).slice(0, 7)}`,
    type,
    grossWeight: Number((payload + tare).toFixed(2)),
    tareWeight: tare,
    payload: Number(payload.toFixed(2)),
    portCode: PORTS[(index * 3 + Math.floor(index / 7)) % PORTS.length].code,
    hazardClass,
    unNumber: hazardClass === 'none' ? undefined : `UN${1200 + index}`,
    reefer: type === '20RF',
    cargo: type === '20RF' ? '冷链食品' : CARGOS[index % CARGOS.length],
  };
});

const INITIAL_SLOTS: Array<[number, number, number, number]> = [
  [2, 7, 1, 1], [2, 8, 1, 10], [2, 6, 2, 47], [2, 5, 2, 19], [2, 1, 3, 37], [2, 2, 3, 46], [2, 3, 4, 28], [2, 4, 4, 0],
  [4, 8, 1, 12], [4, 6, 1, 2], [4, 7, 2, 39], [4, 5, 2, 11], [4, 3, 3, 48], [4, 1, 3, 29], [4, 2, 4, 38], [4, 4, 4, 20],
  [6, 8, 1, 22], [6, 7, 1, 4], [6, 6, 2, 31], [6, 5, 2, 49], [6, 1, 3, 3], [6, 2, 3, 40], [6, 3, 4, 21], [6, 4, 4, 30],
  [8, 8, 1, 5], [8, 6, 1, 14], [8, 7, 2, 51], [8, 5, 2, 23], [8, 1, 3, 41], [8, 2, 3, 50], [8, 3, 4, 32], [8, 4, 4, 13],
  [10, 8, 1, 16], [10, 6, 1, 6], [10, 7, 2, 43], [10, 5, 2, 15], [10, 3, 3, 52], [10, 1, 3, 33], [10, 2, 4, 42], [10, 4, 4, 24],
  [12, 8, 1, 26], [12, 7, 1, 8], [12, 6, 2, 35], [12, 5, 2, 53], [12, 1, 3, 7], [12, 2, 3, 44], [12, 3, 4, 25], [12, 4, 4, 34],
  [14, 8, 1, 9], [14, 7, 1, 18], [14, 6, 2, 55], [14, 5, 2, 27], [14, 1, 3, 45], [14, 2, 3, 54], [14, 3, 4, 36], [14, 4, 4, 17],
];

function createPlacements(
  slots: Array<[number, number, number, number]>,
  offset = 0,
): Placement[] {
  return slots
    .filter(([, , , containerIndex]) => containerIndex + offset < CONTAINERS.length)
    .map(([bayId, row, tier, containerIndex], index) => ({
      id: `P-${bayId}-${row}-${tier}-${containerIndex + offset}`,
      bayId,
      row,
      tier,
      containerId: CONTAINERS[containerIndex + offset].id,
      placedAt: new Date(Date.UTC(2026, 9, 6, 3, index)).toISOString(),
    }));
}

export function createInitialPlans(): StowagePlan[] {
  const primary = createPlacements(INITIAL_SLOTS);
  const portOptimized = createPlacements(INITIAL_SLOTS, 6).map((placement, index) => ({
    ...placement,
    id: `B-${placement.id}`,
    tier: index % 2 === 0 ? placement.tier : Math.min(4, placement.tier + 1),
  }));
  return [
    {
      id: 'PLAN-A',
      name: '基础配载方案 A',
      status: 'trial',
      note: '按原预配计划装载，保留危险品与重箱人工调整空间。',
      createdAt: '2026-10-06T02:20:00.000Z',
      updatedAt: '2026-10-06T03:45:00.000Z',
      placements: primary,
    },
    {
      id: 'PLAN-B',
      name: '港序优化方案 B',
      status: 'trial',
      note: '进一步均衡纵向力矩，优先保证先卸港集装箱在上层。',
      createdAt: '2026-10-06T03:48:00.000Z',
      updatedAt: '2026-10-06T04:10:00.000Z',
      placements: portOptimized,
    },
  ];
}
