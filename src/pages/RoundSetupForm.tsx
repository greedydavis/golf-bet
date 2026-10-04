import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useTransition } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '@/app/auth';
import { BetEditor, betProblems } from '@/components/BetEditor';
import { HandicapEditor, useHandicapParse, type Preset } from '@/components/HandicapEditor';
import { APP_CONFIG, STROKE_MODE_LABEL, TIE_RULE_LABEL } from '@/engine/config';
import { describeGrant, isActive, normalizeForSeats } from '@/engine/handicap/parser';
import { allPairs, flightOf, seatAt } from '@/engine/pairs';
import type { BetConfig } from '@/engine/games/registry';
import { FLIGHT_SIZE, SEGMENT_LABEL, type Grant, type Seat, type Segment } from '@/engine/types';

export interface SetupInitial {
  date: string;
  /** 每組的球員 id（依成績卡順序）；第 1 組座位 A~D、第 2 組 E~H */
  groups: number[][];
  courseId: number | null;
  courseName: string;
  handicapText: string;
  bet: BetConfig;
  /** 球局目前的球場快照（修改設定時；可能是輸入成績時從成績卡讀到的） */
  courseSnapshot?: { pars: number[]; hcpIndex: number[] } | null;
}

interface Props {
  roundId?: number;
  initial: SetupInitial;
  players: { id: number; name: string; active: boolean }[];
  courses: { id: number; name: string; hcpIndex: number[] }[];
  presets: Preset[];
}

const STEPS = ['球員與球場', '抓球與讓桿', '賭注', '確認'];

export function RoundSetupForm({ roundId, initial, players: initialPlayers, courses, presets: initialPresets }: Props) {
  const navigate = useNavigate();
  const api = useApi();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [players, setPlayers] = useState(initialPlayers);
  const [presets, setPresets] = useState(initialPresets);
  const [date, setDate] = useState(initial.date);
  const [groups, setGroups] = useState<number[][]>(initial.groups.length ? initial.groups : [[]]);
  const [courseId, setCourseId] = useState<number | null>(initial.courseId);
  const [courseName, setCourseName] = useState(initial.courseName);
  const [text, setText] = useState(initial.handicapText);
  const [bet, setBet] = useState(initial.bet);
  // 差點洞序：選了已建檔球場就用它；「其他」且沒換過球場時用球局原本的快照
  const hcpIndex =
    courseId !== null
      ? (courses.find((c) => c.id === courseId)?.hcpIndex ?? null)
      : initial.courseId === null
        ? (initial.courseSnapshot?.hcpIndex ?? null)
        : null;
  const [newName, setNewName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const playerIds = groups.flat();
  const slots = useMemo(
    () => groups.flatMap((ids, g) => ids.map((id, i) => ({ id, flight: g + 1, seat: seatAt(g + 1, i) }))),
    [groups],
  );
  const seats: Seat[] = useMemo(() => slots.map((x) => x.seat), [slots]);
  const twoGroups = groups.length > 1 && groups[1].length > 0;
  // 單組球局沒設定的配對預設平打（全部互抓）；兩組球局預設不抓，要抓的自己點
  const fallback: Grant = twoGroups ? { kind: 'none' } : { kind: 'even' };
  const nameOf = (id: number) => players.find((p) => p.id === id)?.name ?? '?';
  const names = Object.fromEntries(slots.map((x) => [x.seat, nameOf(x.id)])) as Record<Seat, string>;
  const parsed = useHandicapParse(text, seats.length >= 2 ? seats : ['A', 'B']);

  const stepErrors = (s: number): string[] => {
    if (s === 0) {
      const e: string[] = [];
      if (!date) e.push('請選日期');
      if (groups[0].length === 0) e.push('第 1 組至少要有 1 位球員');
      if (playerIds.length < APP_CONFIG.minPlayers) e.push(`至少選 ${APP_CONFIG.minPlayers} 位球員`);
      if (!courseName.trim()) e.push('請選擇或輸入球場');
      return e;
    }
    if (s === 1) {
      if (!parsed.ok) return ['讓桿規則有錯誤，請修正紅色標示的行'];
      if (!allPairs(seats).some((p) => isActive(parsed.matrix[p]))) return ['請至少選一對抓球對象'];
      return [];
    }
    if (s === 2) return betProblems(bet);
    return [];
  };

  const next = () => {
    const e = stepErrors(step);
    setErrors(e);
    if (!e.length) {
      // 進入抓球與讓桿設定時，依目前的座位整理：去掉已不存在的座位、沒設定的配對補上預設
      if (step === 0) setText((t) => normalizeForSeats(t, seats, fallback));
      setStep(step + 1);
      window.scrollTo({ top: 0 });
    }
  };

  const canAdd = (g: number) => groups[g].length < FLIGHT_SIZE;
  const addTo = (g: number, id: number) =>
    setGroups((gs) => gs.map((ids, i) => (i === g && ids.length < FLIGHT_SIZE && !gs.flat().includes(id) ? [...ids, id] : ids)));
  const removePlayer = (id: number) => setGroups((gs) => gs.map((ids) => ids.filter((x) => x !== id)));
  const move = (g: number, i: number, d: -1 | 1) =>
    setGroups((gs) =>
      gs.map((ids, k) => {
        const j = i + d;
        if (k !== g || j < 0 || j >= ids.length) return ids;
        const next = [...ids];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
    );
  /** 把球員移到另一組（另一組還有位置時） */
  const switchGroup = (g: number, id: number) =>
    setGroups((gs) => {
      const other = g === 0 ? 1 : 0;
      if (!gs[other] || gs[other].length >= FLIGHT_SIZE) return gs;
      return gs.map((ids, k) => (k === g ? ids.filter((x) => x !== id) : k === other ? [...ids, id] : ids));
    });
  const addPlayer = () =>
    start(async () => {
      let created: { id: number; name: string };
      try {
        created = await api.createPlayer(newName);
      } catch (e) {
        return setErrors([(e as Error).message]);
      }
      qc.invalidateQueries({ queryKey: ['players'] });
      setPlayers((ps) => [...ps, { ...created, active: true }]);
      // 放進第一個還有位置的組
      const g = groups.findIndex((ids) => ids.length < FLIGHT_SIZE);
      if (g >= 0) addTo(g, created.id);
      setNewName('');
      setErrors([]);
    });

  const submit = () =>
    start(async () => {
      const input = {
        date,
        playerIds: slots.map((x) => x.id),
        flights: slots.map((x) => x.flight),
        courseId,
        courseName,
        handicapText: text,
        matrix: parsed.matrix,
        bet,
      };
      try {
        if (roundId) {
          await api.updateRoundSetup(roundId, input);
        } else {
          const id = await api.createRound(input);
          navigate(`/rounds/${id}/scores`, { replace: true });
        }
      } catch (e) {
        return setErrors([(e as Error).message]);
      }
      qc.invalidateQueries({ queryKey: ['rounds'] });
      qc.invalidateQueries({ queryKey: ['round', roundId] });
      qc.invalidateQueries({ queryKey: ['players'] });
      if (roundId) navigate(`/rounds/${roundId}`, { replace: true });
    });

  const { match, stroke } = bet.games;

  return (
    <div>
      <ol className="mb-4 flex gap-1">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              disabled={i > step}
              onClick={() => {
                setStep(i);
                setErrors([]);
              }}
              className={`w-full border-b-4 pb-1 text-xs ${i <= step ? 'border-brand-600 font-bold text-brand-700' : 'border-gray-200 text-gray-400'}`}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <div className="card grid grid-cols-1 gap-3">
            <div>
              <label className="label">日期</label>
              <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label">球場</label>
              <select
                className="field"
                value={courseId ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setCourseId(id);
                  setCourseName(id ? (courses.find((c) => c.id === id)?.name ?? '') : '');
                }}
              >
                <option value="">其他（尚未建檔）</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {courseId === null && (
                <>
                  <input
                    className="field mt-2"
                    placeholder="輸入球場名稱"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500">未建檔的球場，上傳成績卡時會一併讀取 Par 與差點洞序並建檔。</p>
                </>
              )}
            </div>
          </div>

          {groups.map((ids, g) => (
            <div key={g} className="card">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-bold">
                  {groups.length > 1 ? `第 ${g + 1} 組` : '球員'}（{ids.length}/{FLIGHT_SIZE}）
                </span>
                {g === 1 && (
                  <button
                    type="button"
                    className="text-sm text-gray-400"
                    onClick={() => (ids.length === 0 || confirm('移除第 2 組？')) && setGroups((gs) => gs.slice(0, 1))}
                  >
                    移除這一組
                  </button>
                )}
              </div>
              <p className="mb-3 text-xs text-gray-500">
                請依這一組成績卡上的順序排列：第 1 位 = {seatAt(g + 1, 0)}、第 2 位 = {seatAt(g + 1, 1)}…
              </p>
              {ids.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {ids.map((id, i) => (
                    <li key={id} className="flex items-center gap-1 rounded-xl bg-brand-50 px-3 py-2">
                      <span className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white">
                        {seatAt(g + 1, i)}
                      </span>
                      <span className="flex-1 truncate font-semibold">{nameOf(id)}</span>
                      {groups.length > 1 && (
                        <button
                          type="button"
                          className="min-h-9 rounded-lg px-2 text-xs text-brand-700 disabled:opacity-30"
                          onClick={() => switchGroup(g, id)}
                          disabled={groups[g === 0 ? 1 : 0].length >= FLIGHT_SIZE}
                        >
                          移到第 {g === 0 ? 2 : 1} 組
                        </button>
                      )}
                      <button
                        type="button"
                        className="px-2 text-xl text-gray-500 disabled:opacity-20"
                        onClick={() => move(g, i, -1)}
                        disabled={i === 0}
                        aria-label="上移"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="px-2 text-xl text-gray-500 disabled:opacity-20"
                        onClick={() => move(g, i, 1)}
                        disabled={i === ids.length - 1}
                        aria-label="下移"
                      >
                        ↓
                      </button>
                      <button type="button" className="px-2 text-xl text-gray-400" onClick={() => removePlayer(id)} aria-label="移除">
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {players
                  .filter((p) => p.active && !playerIds.includes(p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium active:bg-gray-200 disabled:opacity-40"
                      onClick={() => addTo(g, p.id)}
                      disabled={!canAdd(g)}
                    >
                      ＋ {p.name}
                    </button>
                  ))}
              </div>
            </div>
          ))}

          {groups.length < APP_CONFIG.maxFlights && (
            <button type="button" className="btn-secondary w-full" onClick={() => setGroups((gs) => [...gs, []])}>
              ＋ 加第 2 組（跨組抓球）
            </button>
          )}

          <div className="card">
            <label className="label">名單裡沒有的球友</label>
            <div className="flex gap-2">
              <input className="field" placeholder="新球友名字" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button type="button" className="btn-secondary shrink-0" onClick={addPlayer} disabled={pending || !newName.trim()}>
                新增
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <HandicapEditor
          hcpIndex={hcpIndex}
          fallback={fallback}
          seats={seats}
          names={names}
          text={text}
          onTextChange={(t) => {
            setText(t);
            setErrors([]);
          }}
          presets={presets}
          onPresetsChange={setPresets}
        />
      )}

      {step === 2 && <BetEditor bet={bet} onChange={setBet} />}

      {step === 3 && (
        <div className="space-y-4">
          <div className="card">
            <div className="font-bold">
              {date}・{courseName}
            </div>
            {groups.map((ids, g) =>
              ids.length === 0 ? null : (
                <div key={g} className="mt-2">
                  {twoGroups && <div className="text-xs text-gray-500">第 {g + 1} 組</div>}
                  <ul className="space-y-1">
                    {ids.map((id, i) => (
                      <li key={id}>
                        <b className="text-brand-700">{seatAt(g + 1, i)}</b> {nameOf(id)}
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
          <div className="card">
            <div className="mb-2 font-bold">
              抓球與讓桿（{allPairs(seats).filter((p) => isActive(parsed.matrix[p])).length} 對）
            </div>
            <ul className="space-y-1 text-sm">
              {allPairs(seats)
                .filter((p) => isActive(parsed.matrix[p]))
                .map((p) => (
                  <li key={p}>
                    ・{describeGrant(p, parsed.matrix[p], names)}
                    {twoGroups && flightOf(p[0] as Seat) !== flightOf(p[1] as Seat) && (
                      <span className="ml-1 text-xs text-amber-600">跨組</span>
                    )}
                  </li>
                ))}
            </ul>
            {allPairs(seats).some((p) => !isActive(parsed.matrix[p])) && (
              <p className="mt-2 text-xs text-gray-400">
                其餘 {allPairs(seats).filter((p) => !isActive(parsed.matrix[p])).length} 對不抓
              </p>
            )}
          </div>
          <div className="card text-sm">
            <div className="mb-2 font-bold">賭注</div>
            <p>
              每點 {bet.pointValue} {APP_CONFIG.currency}
            </p>
            {match.enabled && (
              <p>
                比洞：每洞 {match.options.pointsPerHole} 點，{TIE_RULE_LABEL[match.options.tie]}
              </p>
            )}
            {stroke.enabled && (
              <p>
                總桿：{STROKE_MODE_LABEL[stroke.options.mode]}，
                {(Object.keys(stroke.options.segments) as Segment[])
                  .filter((s) => stroke.options.segments[s].enabled)
                  .map((s) => `${SEGMENT_LABEL[s]} ${stroke.options.segments[s].points} 點`)
                  .join('、')}
              </p>
            )}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="mt-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="sticky bottom-20 z-10 mt-4 flex gap-2">
        {step > 0 && (
          <button type="button" className="btn-secondary flex-1" onClick={() => {
              setStep(step - 1);
              setErrors([]);
            }}>
            上一步
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn-primary flex-1" onClick={next}>
            下一步
          </button>
        ) : (
          <button type="button" className="btn-primary flex-1" onClick={submit} disabled={pending}>
            {roundId ? '儲存設定' : '建立球局'}
          </button>
        )}
      </div>
    </div>
  );
}
