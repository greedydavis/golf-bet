import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, Outlet, RouterProvider, createHashRouter } from 'react-router';
import { AuthProvider, useAuth } from './app/auth';
import { Layout } from './app/Layout';
import { ErrorBox, Loading } from './components/ui';
import './index.css';
import { CourseEditPage, CoursesPage } from './pages/CoursePages';
import { HistoryPage, HomePage } from './pages/HomePages';
import { LoginPage, PendingPage } from './pages/LoginPage';
import { MembersPage, MorePage } from './pages/MorePage';
import { PlayerPage, PlayersPage } from './pages/PlayerPages';
import { RoundPage } from './pages/RoundPage';
import { RoundSetupPage } from './pages/RoundSetupPage';
import { ScoresPage } from './pages/ScoresPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

function Gate() {
  const { loading, error, session, me } = useAuth();
  if (loading) {
    return (
      <Loading
        label={import.meta.env.VITE_SUPABASE_URL ? '連線資料庫中…' : '載入示範資料庫中…第一次開啟約需 10–20 秒，請不要重新整理或關閉分頁'}
      />
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-md p-4">
        <ErrorBox error={error} />
      </div>
    );
  }
  if (!session) return <LoginPage />;
  if (!me || me.role === 'pending') return <PendingPage />;
  return <Outlet />;
}

const router = createHashRouter([
  {
    element: <Gate />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'history', element: <HistoryPage /> },
          { path: 'players', element: <PlayersPage /> },
          { path: 'players/:id', element: <PlayerPage /> },
          { path: 'courses', element: <CoursesPage /> },
          { path: 'courses/new', element: <CourseEditPage /> },
          { path: 'courses/:id', element: <CourseEditPage /> },
          { path: 'rounds/new', element: <RoundSetupPage /> },
          { path: 'rounds/:id', element: <RoundPage /> },
          { path: 'rounds/:id/edit', element: <RoundSetupPage /> },
          { path: 'rounds/:id/scores', element: <ScoresPage /> },
          { path: 'more', element: <MorePage /> },
          { path: 'members', element: <MembersPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
