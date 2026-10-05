import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useRef, useState, useTransition } from 'react';
import { useNavigate } from 'react-router';
import { useApi, useBackend } from '@/app/auth';
import { courseProblems, toNum, type Holes } from '@/components/HoleTable';
import type { RecognizeResult as RecognizeResponse } from '@/data/backend';
import { defaultMapping } from '@/data/recognitionMapping';
import { isValidStroke } from '@/engine/course';
import type { Seat } from '@/engine/types';

interface Props {
  roundId: number;
  courseName: string;
  players: { seat: Seat; flight: number; name: string; scores: Holes }[];
  course: { pars: number[]; hcpIndex: number[] } | null;
  /** 目前已存的成績卡照片路徑：[第 1 組, 第 2 組] */
  images: (string | null)[];
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

/** 一次最多幾張（計分 App 常把前九、後九分成兩張） */
const MAX_IMAGES = 4;

/** 把多張圖拼成一張存檔用：橫的圖上下排、直的圖左右排 */
async function stitchImages(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  const bitmaps = await Promise.all(blobs.map((b) => createImageBitmap(b)));
  const vertical = bitmaps.every((b) => b.width >= b.height);
  const width = vertical ? Math.max(...bitmaps.map((b) => b.width)) : bitmaps.reduce((w, b) => w + b.width, 0);
  const height = vertical ? bitmaps.reduce((h, b) => h + b.height, 0) : Math.max(...bitmaps.map((b) => b.height));
  const scale = Math.min(1, 2400 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let offset = 0;
  for (const b of bitmaps) {
    if (vertical) ctx.drawImage(b, 0, offset * scale, b.width * scale, b.height * scale);
    else ctx.drawImage(b, offset * scale, 0, b.width * scale, b.height * scale);
    offset += vertical ? b.height : b.width;
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), 'image/jpeg', 0.85),
  );
}

const FRONT_HOLES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const BACK_HOLES = [9, 10, 11, 12, 13, 14, 15, 16, 17];

export function ScoreEditor({ roundId, courseName, players, course, images }: Props) {
  const navigate = useNavigate();
  const api = useApi();
  const backend = useBackend();
  const qc = useQueryClient();
  const recognitionEnabled = backend.recognitionAvailable;
  // 一組一張成績卡：依組別分頁顯示，每組各自上傳辨識；儲存時所有組一起存
  const flights = [...new Set(players.map((p) => p.flight))].sort();
  const [flight, setFlight] = useState(flights[0]);
  const shown = players.filter((p) => p.flight === flight);
  const seats = shown.map((p) => p.seat);
  const missingIn = (f: number) =>
    players.filter((p) => p.flight === f).reduce((c, p) => c + scores[p.seat].filter((v) => v === null).length, 0);
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
  /** 哪些座位是靠名字對應到的（顯示提示用） */
  const [matchedByName, setMatchedByName] = useState<Partial<Record<Seat, boolean>>>({});
  /** 帶入辨識結果時，已經填好的格子要不要保留（分兩次上傳前九、後九時才不會蓋掉改過的成績） */
  const [keepExisting, setKeepExisting] = useState(true);
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

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (files.length > MAX_IMAGES) {
      if (fileRef.current) fileRef.current.value = '';
      return setMessage({ tone: 'error', text: [`一次最多選 ${MAX_IMAGES} 張圖片`] });
    }
    setRecognizing(true);
    setMessage(null);
    try {
      const blobs = await Promise.all(files.map((f) => resizeImage(f)));
      // 分兩次上傳（先前九、後後九）時，把原本那張和新的拼在一起存，才不會只剩後半場的照片。
      // 只在這一組目前剛好填了半場時這樣做，避免重傳時一直疊上去。
      const filled = (holes: number[]) => seats.every((s) => holes.every((h) => scores[s][h] !== null));
      const empty = (holes: number[]) => seats.every((s) => holes.every((h) => scores[s][h] === null));
      const halfDone = (filled(FRONT_HOLES) && empty(BACK_HOLES)) || (filled(BACK_HOLES) && empty(FRONT_HOLES));
      const existing = images[flight - 1];
      let toStore = blobs;
      if (existing && blobs.length === 1 && halfDone) {
        try {
          const old = await (await fetch(await backend.imageUrl(existing))).blob();
          toStore = [old, ...blobs];
        } catch {
          // 讀不到舊照片就只存新的
        }
      }
      // 照片存檔失敗不影響辨識；多張時拼成一張存
      const stored = stitchImages(toStore)
        .then((blob) => api.attachScorecard(roundId, blob, flight))
        .then(
          () => qc.invalidateQueries({ queryKey: ['round', roundId] }),
          () => setMessage({ tone: 'error', text: ['成績卡照片存檔失敗（不影響辨識）'] }),
        );
      const r = await backend.recognize({
        images: await Promise.all(blobs.map(async (b) => ({ base64: await blobToBase64(b), mediaType: 'image/jpeg' as const }))),
        playerNames: shown.map((p) => p.name),
        needCourse,
      });
      await stored;
      setRecognized(r);
      // 已經有成績時預設只補空格
      setKeepExisting(true);
      // 預設對應：先看名字（同音字、異體字由模型比對），對不上的再照成績卡順序
      const { rowOfSeat, byName } = defaultMapping(seats.length, r.players);
      setMapping(Object.fromEntries(seats.map((s, i) => [s, rowOfSeat[i]])) as Record<Seat, number>);
      setMatchedByName(Object.fromEntries(seats.map((s, i) => [s, byName[i]])));
    } catch (e) {
      setMessage({ tone: 'error', text: [e instanceof Error ? e.message : '辨識失敗'] });
    } finally {
      setRecognizing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyRecognized = () => {
    if (!recognized) return;
    // 合併：辨識不到的格子保留原值；已經有值的格子依「保留已填好的格子」決定要不要覆蓋
    const merge = (cur: Holes, rec: (number | null)[]) =>
      cur.map((v, i) => (rec[i] === null || rec[i] === undefined ? v : keepExisting && v !== null ? v : rec[i]));
    const next = { ...scores };
    for (const s of seats) {
      const row = recognized.players[mapping[s]];
      if (row) next[s] = merge(scores[s], row.strokes);
    }
    setScores(next);
    if (needCourse) {
      if (recognized.pars) setPars(merge(pars, recognized.pars));
      if (recognized.hcpIndex) setHcp(merge(hcp, recognized.hcpIndex));
    }
    setShowMissing(true);
    setRecognized(null);
    const emptyIn = (holes: number[]) => seats.reduce((c, s) => c + holes.filter((h) => next[s][h] === null).length, 0);
    const backUntouched = seats.every((s) => BACK_HOLES.every((h) => next[s][h] === null));
    const frontUntouched = seats.every((s) => FRONT_HOLES.every((h) => next[s][h] === null));
    const missing = (frontUntouched ? 0 : emptyIn(FRONT_HOLES)) + (backUntouched ? 0 : emptyIn(BACK_HOLES));
    setMessage({
      tone: 'info',
      text: [
        '已帶入辨識結果，請逐格核對。',
        ...(missing ? [`有 ${missing} 格辨識不出來（紅框），請手動補上。`] : []),
        ...(backUntouched && !frontUntouched ? ['目前只有前九的成績。按下方按鈕儲存後可以先看前九戰況，後九打完再上傳。'] : []),
        ...(frontUntouched && !backUntouched ? ['目前只有後九的成績，前九請再上傳或手動輸入。'] : []),
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
      // 結算完成，或前九填完、後九還沒打（先看前九戰況）→ 到球局頁
      if (res.ok || frontOnly) navigate(`/rounds/${roundId}`);
      else setMessage({ tone: 'error', text: ['已暫存，但還不能結算：', ...res.errors] });
    });

  const cp = courseProblems(pars, hcp);
  // 前九全部填完、後九完全還沒填：打到一半，儲存後看前九戰況
  const everySeat = players.map((p) => p.seat);
  const frontOnly =
    everySeat.every((s) => FRONT_HOLES.every((h) => isValidStroke(scores[s][h]))) &&
    everySeat.every((s) => BACK_HOLES.every((h) => scores[s][h] === null));
  /** 這位球員在這半場（前九或後九）是否已經有任何成績；整個半場都空的不標紅 */
  const halfStarted = (s: Seat, i: number) => (i < 9 ? FRONT_HOLES : BACK_HOLES).some((h) => scores[s][h] !== null);
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
      {flights.length > 1 && (
        <div className="flex gap-2">
          {flights.map((f) => {
            const missing = missingIn(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFlight(f);
                  setRecognized(null);
                }}
                className={`min-h-11 flex-1 rounded-xl text-sm ring-1 ${
                  f === flight ? 'bg-brand-600 font-bold text-white ring-brand-600' : 'bg-white ring-gray-300'
                }`}
              >
                第 {f} 組
                <span className={`ml-1 text-xs ${f === flight ? 'text-white/80' : missing ? 'text-amber-600' : 'text-brand-600'}`}>
                  {missing ? `（缺 ${missing} 格）` : '（已填完）'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="card">
        {recognitionEnabled ? (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
            <button type="button" className="btn-primary w-full py-4" onClick={() => fileRef.current?.click()} disabled={recognizing}>
              {recognizing ? '辨識中，請稍候…' : flights.length > 1 ? `📷 拍照 / 上傳第 ${flight} 組成績卡` : '📷 拍照 / 上傳成績卡'}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              前九、後九分成兩張圖時，可以一次選兩張，也可以先傳前九、打完再傳後九。辨識後可逐格核對修改，也可以直接在下表手動輸入。
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
                  onChange={(e) => {
                    setMapping({ ...mapping, [s]: Number(e.target.value) });
                    setMatchedByName({ ...matchedByName, [s]: false });
                  }}
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
          <p className="mt-2 text-xs text-gray-500">
            {seats.some((s) => matchedByName[s])
              ? '已依成績卡上的名字自動對應；名字對不上的才照順序排。請確認每個人對到的是自己的成績。'
              : '成績卡上的名字和名單對不上，先照成績卡由上到下的順序對應。請確認每個人對到的是自己的成績。'}
          </p>
          {recognized.players.length < seats.length && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              這次只讀到 {recognized.players.length} 位球員的成績（這一組有 {seats.length} 位）。沒對到的人會維持原樣，可以再上傳其他人的圖片。
            </p>
          )}
          {seats.some((s) => scores[s].some((v) => v !== null)) && (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                checked={keepExisting}
                onChange={(e) => setKeepExisting(e.target.checked)}
              />
              <span>
                保留已經填好的格子，只補空格
                <span className="block text-xs text-gray-500">取消勾選的話，辨識到的桿數會蓋掉表格裡現有的數字。</span>
              </span>
            </label>
          )}
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
              {shown.map((p) => (
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
                    const bad = (showMissing && v === null && halfStarted(s, i)) || (v !== null && (v < 1 || v > 20));
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
          {pending ? '儲存中…' : frontOnly ? '儲存，看前九戰況' : '儲存並結算'}
        </button>
      </div>
    </div>
  );
}

