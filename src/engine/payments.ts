// 最簡化付款建議：找出筆數最少的轉帳方式。
// 人數最多 4 人，直接窮舉付款方 / 收款方的排列順序，各跑一次貪婪配對，取筆數最少者。
// （依零和子群組排序時，貪婪法會在群組邊界剛好結清，因此窮舉排列可得最佳解）

export interface Payment<K extends string = string> {
  from: K;
  to: K;
  amount: number;
}

const EPS = 1e-6;

export function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r; // 避免 -0
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

function greedy<K extends string>(debtors: [K, number][], creditors: [K, number][]): Payment<K>[] {
  const d = debtors.map(([k, v]) => [k, v] as [K, number]);
  const c = creditors.map(([k, v]) => [k, v] as [K, number]);
  const out: Payment<K>[] = [];
  let i = 0;
  let j = 0;
  while (i < d.length && j < c.length) {
    const amt = Math.min(d[i][1], c[j][1]);
    if (amt > EPS) out.push({ from: d[i][0], to: c[j][0], amount: round2(amt) });
    d[i][1] -= amt;
    c[j][1] -= amt;
    if (d[i][1] <= EPS) i++;
    if (c[j][1] <= EPS) j++;
  }
  return out;
}

/** balances：每人淨輸贏（正 = 應收，負 = 應付），總和需為 0 */
export function suggestPayments<K extends string>(balances: Record<K, number>): Payment<K>[] {
  const entries = Object.entries(balances) as [K, number][];
  const debtors = entries.filter(([, v]) => v < -EPS).map(([k, v]) => [k, -v] as [K, number]);
  const creditors = entries.filter(([, v]) => v > EPS);

  let best: Payment<K>[] | null = null;
  for (const dp of permutations(debtors)) {
    for (const cp of permutations(creditors)) {
      const res = greedy(dp, cp);
      if (!best || res.length < best.length) best = res;
    }
  }
  return best ?? [];
}
