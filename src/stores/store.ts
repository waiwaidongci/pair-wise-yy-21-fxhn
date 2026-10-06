import { configureStore } from '@reduxjs/toolkit';
import { plannerReducer } from './plannerSlice';

export const store = configureStore({
  reducer: {
    planner: plannerReducer,
  },
});

let persistTimer: ReturnType<typeof setTimeout> | undefined;
store.subscribe(() => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const state = store.getState().planner;
    const persisted = {
      plans: state.plans,
      activePlanId: state.activePlanId,
      selectedContainerId: state.selectedContainerId,
    };
    localStorage.setItem('pair-wise-yy-21.planner', JSON.stringify(persisted));
  }, 300);
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
