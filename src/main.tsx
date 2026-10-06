import '@blueprintjs/core/lib/css/blueprint.css';
import '@blueprintjs/icons/lib/css/blueprint-icons.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { plannerActions } from './stores/plannerSlice';
import { store } from './stores/store';
import './styles.css';

try {
  const persisted = localStorage.getItem('pair-wise-yy-21.planner');
  if (persisted) {
    const parsed = JSON.parse(persisted) as {
      plans?: unknown;
      activePlanId?: unknown;
      selectedContainerId?: unknown;
    };
    if (Array.isArray(parsed.plans) && parsed.plans.length > 0) {
      store.dispatch(
        plannerActions.hydrate({
          plans: parsed.plans as never,
          activePlanId:
            typeof parsed.activePlanId === 'string'
              ? parsed.activePlanId
              : (parsed.plans[0] as { id: string }).id,
          selectedContainerId:
            typeof parsed.selectedContainerId === 'string' ? parsed.selectedContainerId : null,
        }),
      );
    }
  }
} catch {
  localStorage.removeItem('pair-wise-yy-21.planner');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </React.StrictMode>,
);
