import { createSlice, nanoid } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { PlannerState, Placement, Slot, StowagePlan } from '../types/shipping';
import { BAYS, CONTAINERS, createInitialPlans, PORTS, VESSEL } from '../utils/mockData';
import { calculateStability } from '../utils/stability';

const initialPlans = createInitialPlans();

const initialState: PlannerState = {
  vessel: VESSEL,
  ports: PORTS,
  bays: BAYS,
  containers: CONTAINERS,
  plans: initialPlans,
  activePlanId: initialPlans[0].id,
  selectedContainerId: null,
  selectedSlot: null,
  highlightedConflictId: null,
  past: [],
  future: [],
  notice: null,
};

export const plannerSlice = createSlice({
  name: 'planner',
  initialState,
  reducers: {
    setActivePlan(state, action: PayloadAction<string>) {
      state.activePlanId = action.payload;
      state.selectedSlot = null;
      state.highlightedConflictId = null;
    },
    selectContainer(state, action: PayloadAction<string | null>) {
      state.selectedContainerId = action.payload;
    },
    selectSlot(state, action: PayloadAction<Slot | null>) {
      state.selectedSlot = action.payload;
    },
    assignContainer(state, action: PayloadAction<{ containerId: string; slot: Slot }>) {
      const plan = activePlan(state);
      if (!plan) return;
      pushHistory(state);
      plan.placements = plan.placements.filter(
        (placement) =>
          placement.containerId !== action.payload.containerId &&
          !isSameSlot(placement, action.payload.slot),
      );
      plan.placements.push({
        ...action.payload.slot,
        id: nanoid(10),
        containerId: action.payload.containerId,
        placedAt: new Date().toISOString(),
      });
      plan.updatedAt = new Date().toISOString();
      state.selectedSlot = action.payload.slot;
      state.notice = '格位已更新，稳性与隔离规则已重新计算';
    },
    removePlacement(state, action: PayloadAction<string>) {
      const plan = activePlan(state);
      if (!plan) return;
      pushHistory(state);
      plan.placements = plan.placements.filter((placement) => placement.id !== action.payload);
      plan.updatedAt = new Date().toISOString();
      state.notice = '已从配载图中移除集装箱';
    },
    autoStow(state, action: PayloadAction<Placement[]>) {
      const plan = activePlan(state);
      if (!plan || action.payload.length === 0) return;
      pushHistory(state);
      const incomingIds = new Set(action.payload.map((placement) => placement.containerId));
      plan.placements = [
        ...plan.placements.filter((placement) => !incomingIds.has(placement.containerId)),
        ...action.payload,
      ];
      plan.updatedAt = new Date().toISOString();
      state.notice = `自动配载已放入 ${action.payload.length} 个集装箱`;
    },
    clearPlan(state) {
      const plan = activePlan(state);
      if (!plan) return;
      pushHistory(state);
      plan.placements = [];
      plan.updatedAt = new Date().toISOString();
      state.selectedSlot = null;
      state.notice = '当前方案已清空，可通过撤销恢复';
    },
    duplicatePlan(state, action: PayloadAction<string>) {
      const source = state.plans.find((plan) => plan.id === action.payload);
      if (!source) return;
      pushHistory(state);
      const id = `PLAN-${nanoid(5).toUpperCase()}`;
      const now = new Date().toISOString();
      state.plans.push({
        ...source,
        id,
        name: `${source.name} · 副本`,
        status: 'trial',
        note: '由现有方案复制，准备进行并排试算。',
        createdAt: now,
        updatedAt: now,
        placements: source.placements.map((placement) => ({ ...placement, id: nanoid(10) })),
      });
      state.activePlanId = id;
      state.notice = '已创建试算副本';
    },
    renamePlan(state, action: PayloadAction<{ planId: string; name: string }>) {
      const plan = state.plans.find((candidate) => candidate.id === action.payload.planId);
      if (!plan) return;
      plan.name = action.payload.name.trim() || plan.name;
      plan.updatedAt = new Date().toISOString();
    },
    confirmPlan(state, action: PayloadAction<{ planId: string; manualOverride?: boolean }>) {
      const plan = state.plans.find((candidate) => candidate.id === action.payload.planId);
      if (!plan) return;
      const stability = calculateStability(plan.placements, state.containers, state.bays, state.vessel);
      const blocking = stability.issues.filter((issue) => issue.severity === 'danger');
      if (blocking.length > 0 && !action.payload.manualOverride) {
        state.notice = `确认被拦截：${blocking.map((issue) => issue.message).join('；')}。请先按归因面板调箱，或逐项转人工后放行。`;
        return;
      }
      pushHistory(state);
      state.plans = state.plans.map((candidate) => ({
        ...candidate,
        status: candidate.id === action.payload.planId ? 'final' : candidate.status === 'final' ? 'trial' : candidate.status,
      }));
      state.notice =
        blocking.length > 0
          ? `${plan.name} 已确认为最终方案（含 ${blocking.length} 项转人工处理的稳性超限，已写入清单）`
          : `${plan.name} 已确认为最终配载方案`;
    },
    setHighlightedConflict(state, action: PayloadAction<string | null>) {
      state.highlightedConflictId = action.payload;
    },
    setNotice(state, action: PayloadAction<string | null>) {
      state.notice = action.payload;
    },
    undo(state) {
      const previous = state.past.pop();
      if (!previous) return;
      state.future.unshift(clonePlans(state.plans));
      state.plans = previous;
      ensureActivePlan(state);
      state.notice = '已撤销上一步配载调整';
    },
    redo(state) {
      const next = state.future.shift();
      if (!next) return;
      state.past.push(clonePlans(state.plans));
      state.plans = next;
      ensureActivePlan(state);
      state.notice = '已重做配载调整';
    },
    hydrate(state, action: PayloadAction<Partial<PlannerState>>) {
      return { ...state, ...action.payload, past: [], future: [] };
    },
  },
});

function activePlan(state: PlannerState): StowagePlan | undefined {
  return state.plans.find((plan) => plan.id === state.activePlanId);
}

function pushHistory(state: PlannerState): void {
  state.past.push(clonePlans(state.plans));
  if (state.past.length > 80) state.past.shift();
  state.future = [];
}

function clonePlans(plans: StowagePlan[]): StowagePlan[] {
  return plans.map((plan) => ({
    ...plan,
    placements: plan.placements.map((placement) => ({ ...placement })),
  }));
}

function ensureActivePlan(state: PlannerState): void {
  if (!state.plans.some((plan) => plan.id === state.activePlanId)) {
    state.activePlanId = state.plans[0]?.id ?? '';
  }
}

function isSameSlot(placement: Placement, slot: Slot): boolean {
  return (
    placement.bayId === slot.bayId &&
    placement.row === slot.row &&
    placement.tier === slot.tier
  );
}

export const plannerActions = plannerSlice.actions;
export const plannerReducer = plannerSlice.reducer;
