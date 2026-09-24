import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useRef, useState, useTransition } from 'react';
import { useNavigate } from 'react-router';
import { useApi, useBackend } from '@/app/auth';
import { courseProblems, toNum, type Holes } from '@/components/HoleTable';
import type { RecognizeResult as RecognizeResponse } from '@/data/backend';
import type { Seat } from '@/engine/types';

interface Props {
  roundId: number;
  courseName: string;
  players: { seat: Seat; name: string; scores: Holes }[];
  course: { pars: number[]; hcpIndex: number[] } | null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('讀取圖片失敗'));
    reader.readAsDataURL(blob);
  });
}

/** 前端先把照片縮小再上傳（長邊 1600px），省流量也加快辨識；重新編碼同時移除 EXIF（含 GPS） */
async function resizeImage(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), 'image/jpeg', 0.85),
  );
}

export function ScoreEditor({ roundId, courseName, players, course }: Props) {
  const navigate = useNavigate();
  const api = useApi();
  const backend = useBackend();
  const qc = useQueryClient();
  const recognitionEnabled = backend.recognitionAvailable;
  const seats = players.map((p) => p.seat);
  const [scores, setScores] = useState<Record<Seat, Holes>>(
    () => Object.fromEntries(players.map((p) => [p.seat, [...p.scores]])) as Record<Seat, Holes>,
  );
  const needCourse = course === null;
  const [pars, setPars] = useState<Holes>(course?.pars ?? new Array(18).fill(null));
  const [hcp, setHcp] = useState<Holes>(course?.hcpIndex ?? new Array(18).fill(null));
  const [saveAsCourse, setSaveAsCourse] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [recognized, setRecognized] = useState<RecognizeResponse | null>(null);
  const [mapping, setMapping] = useState<Record<Seat, number>>({} as Record<Seat, number>);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string[] } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const setCell = (seat: Seat, i: number, v: string) => {
    const n = toNum(v);
    setScores((s) => ({ ...s, [seat]: s[seat].map((x, j) => (j === i ? n : x)) }));
    // 輸入 2~9 自動跳到同一位球員的下一洞
    if (n !== null && n >= 2 && n <= 9 && i < 17) {
      document.getElementById(`cell-${seat}-${i + 1}`)?.focus();
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setRecognizing(true);
    setMessage(null);
    try {
      const blob = await resizeImage(file);
      // 照片存檔失敗不影響辨識
      const stored = api.attachScorecard(roundId, blob).then(
        () => qc.invalidateQueries({ queryKey: ['round', roundId] }),
        () => setMessage({ tone: 'error', text: ['成績卡照片存檔失敗（不影響辨識）'] }),
      );
      const r = await backend.recognize({
        imageBase64: await blobToBase64(blob),
        mediaType: 'image/jpeg',
        playerNames: players.map((p) => p.name),
        needCourse,
      });
      await stored;
      setRecognized(r);
      // 預設依成績卡順序對應 A、B、C、D
      setMapping(Object.fromEntries(seats.map((s, i) => [s, i < r.players.length ? i : -1])) as Record<Seat, number>);
    } catch (e) {
      setMessage({ tone: 'error', text: [e instanceof Error ? e.message : '辨識失敗'] });
    } finally {
      setRecognizing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyRecognized = () => {
    if (!recognized) return;
    const next = { ...scores };
    for (const s of seats) {
      const row = recognized.players[mapping[s]];
      if (row) next[s] = row.strokes.map((v) => (v === null ? null : v));
    }
    setScores(next);
    if (needCourse) {
      if (recognized.pars) setPars(recognized.pars);
      if (recognized.hcpIndex) setHcp(recognized.hcpIndex);
    }
    setShowMissing(true);
    setRecognized(null);
    const missing = seats.reduce((c, s) => c + next[s].filter((v) => v === null).length, 0);
    setMessage({
      tone: 'info',
      text: [
        '已帶入辨識結果，請逐格核對。',
        ...(missing ? [`有 ${missing} 格辨識不出來（紅框），請手動補上。`] : []),
        ...(recognized.notes ? [`備註：${recognized.notes}`] : []),
      ],
    });
  };

  const save = () =>
    start(async () => {
      setShowMissing(true);
      let res;
      try {
        res = await api.saveScores(roundId, scores, needCourse ? { pars, hcpIndex: hcp, saveAsCourse } : undefined);
      } catch (e) {
        return setMessage({ tone: 'error', text: [(e as Error).message] });
      }
      qc.invalidateQueries({ queryKey: ['rounds'] });
      qc.invalidateQueries({ queryKey: ['round', roundId] });
      qc.invalidateQueries({ queryKey: ['players'] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      if (res.ok) navigate(`/rounds/${roundId}`);
      else setMessage({ tone: 'error', text: ['已暫存，但還不能結算：', ...res.errors] });
    });

  const cp = courseProblems(pars, hcp);
  const sum = (xs: Holes, from: number, to: number) => xs.slice(from, to).reduce<number>((a, x) => a + (x ?? 0), 0);
  const cellCls = (bad: boolean) =>
    `h-11 w-full rounded-lg border text-center text-lg tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${
      bad ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
    }`;

  const subtotalRow = (label: string, from: number, to: number) => (
    <tr className="bg-gray-50 text-sm font-bold">
      <td className="py-2">{label}</td>
      <td>{sum(pars, from, to)}</td>
      <td />
      {seats.map((s) => (
        <td key={s} className="tabular-nums">
          {sum(scores[s], from, to) || ''}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="card">
        {recognitionEnabled ? (
          <>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <button type="button" className="btn-primary w-full py-4" onClick={() => fileRef.current?.click()} disabled={recognizing}>
              {recognizing ? '辨識中，請稍候…' : '📷 拍照 / 上傳成績卡'}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              辨識後可逐格核對修改；也可以直接在下表手動輸入。
              {needCourse && '此球場尚未建檔，會一併讀取 Par 與差點洞序。'}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">示範模式無法辨識成績卡，請直接在下表手動輸入桿數。</p>
        )}
      </div>

      {recognized && (
        <div className="card border-2 border-brand-500">
          <div className="mb-2 font-bold">辨識完成：請確認球員對應</div>
          <ul className="space-y-2">
            {seats.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="w-24 shrink-0 font-semibold">
                  {s} {players.find((p) => p.seat === s)?.name}
                </span>
                <select
                  className="field"
                  value={mapping[s] ?? -1}
                  onChange={(e) => setMapping({ ...mapping, [s]: Number(e.target.value) })}
                >
                  <option value={-1}>（不套用）</option>
                  {recognized.players.map((p, i) => (
                    <option key={i} value={i}>
                      第 {i + 1} 列：{p.nameOnCard || '（無名字）'}・{p.strokes.reduce<number>((a, x) => a + (x ?? 0), 0)} 桿
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setRecognized(null)}>
              取消
            </button>
            <button type="button" className="btn-primary flex-1" onClick={applyRecognized}>
              帶入表格
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${message.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-900'}`}>
          {message.text.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
      )}

      <div className="card px-2">
        <div className="mb-2 px-2 font-bold">{courseName}</div>
        <table className="w-full table-fixed text-center">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="text-xs text-gray-500">
              <th className="w-9 py-2">洞</th>
              <th className={needCourse ? 'w-12' : 'w-9'}>Par</th>
              <th className={needCourse ? 'w-12' : 'w-9'}>差點</th>
              {players.map((p) => (
                <th key={p.seat} className="truncate px-0.5 text-sm text-gray-900">
                  <div className="text-xs text-brand-700">{p.seat}</div>
                  <div className="truncate">{p.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 18 }, (_, i) => (
              <Fragment key={i}>
                <tr>
                  <td className="font-semibold text-gray-500">{i + 1}</td>
                  {needCourse ? (
                    <>
                      <td className="p-0.5">
                        <input
                          inputMode="numeric"
                          className={cellCls(cp.badPar(i)) + ' text-base'}
                          value={pars[i] ?? ''}
                          onChange={(e) => setPars(pars.map((x, j) => (j === i ? toNum(e.target.value) : x)))}
                          onFocus={(e) => e.target.select()}
                        />
                      </td>
                      <td className="p-0.5">
                        <input
                          inputMode="numeric"
                          className={cellCls(cp.badHcp(i)) + ' text-base'}
                          value={hcp[i] ?? ''}
                          onChange={(e) => setHcp(hcp.map((x, j) => (j === i ? toNum(e.target.value) : x)))}
                          onFocus={(e) => e.target.select()}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-gray-600">{pars[i]}</td>
                      <td className="text-xs text-gray-400">{hcp[i]}</td>
                    </>
                  )}
                  {seats.map((s) => {
                    const v = scores[s][i];
                    const bad = (showMissing && v === null) || (v !== null && (v < 1 || v > 20));
                    return (
                      <td key={s} className="p-0.5">
                        <input
                          id={`cell-${s}-${i}`}
                          inputMode="numeric"
                          enterKeyHint="next"
                          className={cellCls(bad)}
                          value={v ?? ''}
                          onChange={(e) => setCell(s, i, e.target.value)}
                          onFocus={(e) => e.target.select()}
                        />
                      </td>
                    );
                  })}
                </tr>
                {i === 8 && subtotalRow('前九', 0, 9)}
                {i === 17 && subtotalRow('後九', 9, 18)}
                {i === 17 && subtotalRow('總', 0, 18)}
              </Fragment>
            ))}
          </tbody>
        </table>

        {needCourse && (
          <div className="mt-3 px-2">
            {showMissing && cp.errors.length > 0 && <p className="mb-2 text-sm text-red-600">球場資料：{cp.errors.slice(0, 3).join('、')}</p>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={saveAsCourse} onChange={(e) => setSaveAsCourse(e.target.checked)} />
              把 Par 與差點洞序存成球場「{courseName}」，下次直接使用
            </label>
          </div>
        )}
      </div>

      <div className="sticky bottom-20 z-10">
        <button type="button" className="btn-primary w-full py-4 text-lg shadow-lg" onClick={save} disabled={pending}>
          {pending ? '儲存中…' : '儲存並結算'}
        </button>
      </div>
    </div>
  );
}

