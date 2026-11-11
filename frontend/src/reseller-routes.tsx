import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { Spin } from 'antd';

const ResellerPortalPage = lazy(() => import('@/pages/reseller-portal/ResellerPortalPage'));

// Resellers get their own router: owner pages are never mounted for them, and
// any owner URL they open falls back to the portal.
export function createResellerRouter() {
  const raw = (typeof window !== 'undefined' && window.X_UI_BASE_PATH) || '/';
  return createBrowserRouter(
    [
      {
        path: '/',
        element: (
          <Suspense fallback={<Spin size="large" style={{ display: 'block', marginTop: 80 }} />}>
            <ResellerPortalPage />
          </Suspense>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
    { basename: `${raw.replace(/\/+$/, '')}/panel` },
  );
}
