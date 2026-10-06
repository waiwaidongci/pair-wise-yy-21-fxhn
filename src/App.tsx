import { NavLink, Outlet } from 'react-router-dom';
import { Tag } from '@blueprintjs/core';
import { useAppSelector } from './stores/hooks';

export function App() {
  const vessel = useAppSelector((state) => state.planner.vessel);
  const activePlan = useAppSelector((state) =>
    state.planner.plans.find((plan) => plan.id === state.planner.activePlanId),
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand__mark">
            <span />
            <span />
            <span />
          </span>
          <div>
            <strong>船舶配载控制台</strong>
            <small>STOWAGE & STABILITY CONTROL</small>
          </div>
        </div>
        <nav>
          <NavLink to="/planner" className={({ isActive }) => (isActive ? 'active' : '')}>
            <i className="bp5-icon bp5-icon-grid-view" />
            配载编辑
          </NavLink>
          <NavLink to="/compare" className={({ isActive }) => (isActive ? 'active' : '')}>
            <i className="bp5-icon bp5-icon-comparison" />
            方案对比
          </NavLink>
        </nav>
        <div className="header-vessel">
          <Tag minimal intent="primary">
            {vessel.voyage}
          </Tag>
          <span>
            <strong>{vessel.name}</strong>
            <small>{activePlan?.name ?? '未选择方案'}</small>
          </span>
        </div>
      </header>
      <div className="app-content">
        <Outlet />
      </div>
    </div>
  );
}
