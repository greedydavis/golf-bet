import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useTransition } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '@/app/auth';
import { BetEditor, betProblems } from '@/components/BetEditor';
import { HandicapEditor, useHandicapParse, type Preset } from '@/components/HandicapEditor';
import { APP_CONFIG, STROKE_MODE_LABEL, TIE_RULE_LABEL } from '@/engine/config';
import { describeGrant } from '@/engine/handicap/parser';
import { allPairs, seatsFor } from '@/engine/pairs';
import type { BetConfig } from '@/engine/games/registry';
import { SEATS, SEGMENT_LABEL, type Seat, type Segment } from '@/engine/types';

export interface SetupInitial {
  date: string;
  playerIds: number[];
  courseId: number | null;
  courseName: string;
  handicapText: string;
  bet: BetConfig;
}

interface Props {
  roundId?: number;
  initial: SetupInitial;
  players: { id: number; name: string; active: boolean }[];
  courses: { id: number; name: string }[];
  presets: Preset[];
}

const STEPS = ['球員與球場', '讓桿', '賭注', '確認'];

export function RoundSetupForm({ roundId, initial, players: initialPlayers, courses, presets: initialPresets }: Props) {
  const navigate = useNavigate();
  const api = useApi();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [players, setPlayers] = useState(initialPlayers);
  const [presets, setPresets] = useState(initialPresets);
  const [date, setDate] = useState(initial.date);
  const [playerIds, setPlayerIds] = useState(initial.playerIds);
  const [courseId, setCourseId] = useState<number | null>(initial.courseId);
  const [courseName, setCourseName] = useState(initial.courseName);
  const [text, setText] = useState(initial.handicapText);
  const [bet, setBet] = useState(initial.bet);
  const [newName, setNewName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const seats: Seat[] = useMemo(
    () => (playerIds.length >= 2 ? seatsFor(playerIds.length) : SEATS.slice(0, Math.max(playerIds.length, 0))),
    [playerIds.length],
  );
  const nameOf = (id: number) => players.find((p) => p.id === id)?.name ?? '?';
  const names = Object.fromEntries(playerIds.map((id, i) => [SEATS[i], nameOf(id)])) as Record<Seat, string>;
  const parsed = useHandicapParse(text, seats.length >= 2 ? seats : ['A', 'B']);

  const stepErrors = (s: number): string[] => {
    if (s === 0) {
      const e: string[] = [];
      if (!date) e.push('請選日期');
      if (playerIds.length < APP_CONFIG.minPlayers) e.push(`至少選 ${APP_CONFIG.minPlayers} 位球員`);
      if (!courseName.trim()) e.push('請選擇或輸入球場');
      return e;
    }
    if (s === 1) return parsed.ok ? [] : ['讓桿規則有錯誤，請修正紅色標示的行'];
    if (s === 2) return betProblems(bet);
    return [];
  };

  const next = () => {
    const e = stepErrors(step);
    setErrors(e);
    if (!e.length) {
      setStep(step + 1);
      window.scrollTo({ top: 0 });
    }
  };

  const togglePlayer = (id: number) => {
    setPlayerIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < APP_CONFIG.maxPlayers ? [...ids, id] : ids,
    );
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= playerIds.length) return;
    const ids = [...playerIds];
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setPlayerIds(ids);
  };
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
      if (playerIds.length < APP_CONFIG.maxPlayers) setPlayerIds((ids) => [...ids, created.id]);
      setNewName('');
      setErrors([]);
    });

  const submit = () =>
    start(async () => {
      const input = { date, playerIds, courseId, courseName, handicapText: text, matrix: parsed.matrix, bet };
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

          <div className="card">
            <div className="mb-1 font-bold">
              球員（{playerIds.length}/{APP_CONFIG.maxPlayers}）
            </div>
            <p className="mb-3 text-xs text-gray-500">請依成績卡上的順序排列：第 1 位 = A、第 2 位 = B…</p>
            {playerIds.length > 0 && (
              <ul className="mb-3 space-y-2">
                {playerIds.map((id, i) => (
                  <li key={id} className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 font-bold text-white">
                      {SEATS[i]}
                    </span>
                    <span className="flex-1 font-semibold">{nameOf(id)}</span>
                    <button type="button" className="px-2 text-xl text-gray-500 disabled:opacity-20" onClick={() => move(i, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="px-2 text-xl text-gray-500 disabled:opacity-20"
                      onClick={() => move(i, 1)}
                      disabled={i === playerIds.length - 1}
                    >
                      ↓
                    </button>
                    <button type="button" className="px-2 text-xl text-gray-400" onClick={() => togglePlayer(id)}>
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
                    onClick={() => togglePlayer(p.id)}
                    disabled={playerIds.length >= APP_CONFIG.maxPlayers}
                  >
                    ＋ {p.name}
                  </button>
                ))}
            </div>
            <div className="mt-3 flex gap-2">
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
            <ul className="mt-2 space-y-1">
              {playerIds.map((id, i) => (
                <li key={id}>
                  <b className="text-brand-700">{SEATS[i]}</b> {nameOf(id)}
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <div className="mb-2 font-bold">讓桿</div>
            <ul className="space-y-1 text-sm">
              {allPairs(seats).map((p) => (
                <li key={p} className={parsed.unspecified.includes(p) ? 'text-amber-600' : ''}>
                  ・{describeGrant(p, parsed.matrix[p], names)}
                  {parsed.unspecified.includes(p) && '（未設定）'}
                </li>
              ))}
            </ul>
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
