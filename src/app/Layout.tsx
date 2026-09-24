import { NavLink, Outlet } from 'react-router';
import { useAuth } from './auth';

const ITEMS = [
  { to: '/', label: '首頁', icon: '⛳', end: true },
  { to: '/rounds/new', label: '開新局', icon: '＋', end: false },
  { to: '/history', label: '歷史', icon: '📋', end: false },
  { to: '/players', label: '球友', icon: '👥', end: false },
  { to: '/more', label: '更多', icon: '☰', end: false },
];

export function Layout() {
  const { backend } = useAuth();
  return (
    <>
      {backend?.mode === 'demo' && (
        <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-800">示範模式：資料只存在這台裝置的瀏覽器</div>
      )}
      <main className="mx-auto max-w-xl px-4 pt-4 pb-28">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-xl">
          {ITEMS.map((it) => (
            <li key={it.to} className="flex-1">
              <NavLink
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  `flex h-16 flex-col items-center justify-center text-xs ${isActive ? 'font-bold text-brand-700' : 'text-gray-500'}`
                }
              >
                <span className="text-xl leading-none">{it.icon}</span>
                <span className="mt-1">{it.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
