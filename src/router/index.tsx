import { createBrowserRouter, Navigate } from 'react-router-dom';
import { App } from '../App';
import { ComparePage } from '../pages/ComparePage';
import { PlannerPage } from '../pages/PlannerPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/planner" replace /> },
      { path: 'planner', element: <PlannerPage /> },
      { path: 'compare', element: <ComparePage /> },
      { path: '*', element: <Navigate to="/planner" replace /> },
    ],
  },
]);
