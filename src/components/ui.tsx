import { Link } from 'react-router';

export function PageTitle({ children, back, action }: { children: React.ReactNode; back?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {back && (
        <Link to={back} className="-ml-2 px-2 text-2xl text-gray-500" aria-label="返回">
          ‹
        </Link>
      )}
      <h1 className="flex-1 text-2xl font-bold">{children}</h1>
      {action}
    </div>
  );
}

export function Section({ title, children, extra }: { title?: React.ReactNode; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="card mb-4">
      {(title || extra) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{title}</h2>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-gray-400">{children}</p>;
}

export function Loading({ label = '載入中…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
      <p className="max-w-xs text-center text-sm">{label}</p>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{msg}</div>;
}

/** 正數綠、負數紅 */
export function Signed({ value, suffix = '', className = '' }: { value: number; suffix?: string; className?: string }) {
  const color = value > 0 ? 'text-brand-600' : value < 0 ? 'text-red-600' : 'text-gray-500';
  const text = value > 0 ? `+${fmtNum(value)}` : value < 0 ? `-${fmtNum(-value)}` : '0';
  return (
    <span className={`${color} tabular-nums ${className}`}>
      {text}
      {suffix}
    </span>
  );
}

export function fmtNum(n: number) {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

/** 接受 YYYY-MM-DD 字串或 Date，以當地日期顯示 */
export function fmtDate(d: Date | string) {
  const x = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T12:00:00`) : d;
  const w = '日一二三四五六'[x.getDay()];
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}（${w}）`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
