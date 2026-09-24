// 成績卡辨識核心邏輯：不 import 任何套件，Supabase Edge Function（Deno）與本機開發伺服器（Node）共用。
// Anthropic client 由呼叫端傳入。

export const MODEL = 'claude-sonnet-5';

export interface RecognizeInput {
  imageBase64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  playerNames: string[];
  needCourse: boolean;
}

export interface RecognizeResult {
  players: { nameOnCard: string; strokes: (number | null)[] }[];
  pars: (number | null)[] | null;
  hcpIndex: (number | null)[] | null;
  notes: string;
}

export class RecognizeError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

const SYSTEM = `你是高爾夫成績卡的讀取助手。使用者會給你一張手寫或印刷的成績卡照片，請把資料轉成 JSON。

規則：
- players：依成績卡上由上到下的順序列出每一位球員（通常 2~4 位），只列實際有填桿數的球員列。
- strokes：每位球員第 1 洞到第 18 洞的「實際桿數」，共 18 個數字，依洞號排列。
  - 不要把 OUT / IN / TOT / 前九 / 後九 / 總計 等小計欄當成洞。
  - 有些成績卡記的是「與 Par 的差」（例如 0、+1、-1、○、△），請換算成實際桿數；無法確定時給 null。
  - 看不清楚、空白、被塗改到無法判斷的格子一律給 null，不要猜。
- pars / hcpIndex：只有使用者要求時才讀，否則給 null。差點洞序通常標示為 HDCP、H.C.P.、Handicap 或「差點」。
- 若卡上有小計，可以拿來核對；對不上時在 notes 說明是哪位、哪幾洞可能有誤。
- notes 用繁體中文。`;

const nullableInt = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const holes = (description: string) => ({ type: 'array', items: nullableInt, description });

/** structured output 的 JSON schema（不支援陣列長度限制，18 格在收到後補齊） */
export const SCORECARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['players', 'pars', 'hcpIndex', 'notes'],
  properties: {
    players: {
      type: 'array',
      description: '成績卡上由上到下每一位球員',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nameOnCard', 'strokes'],
        properties: {
          nameOnCard: { type: 'string', description: '該列的球員名字，看不出來就給空字串' },
          strokes: holes('第 1~18 洞的桿數，共 18 個；看不清楚或空白的格子給 null'),
        },
      },
    },
    pars: { anyOf: [holes('第 1~18 洞的 Par'), { type: 'null' }] },
    hcpIndex: { anyOf: [holes('第 1~18 洞的差點洞序（1~18）'), { type: 'null' }] },
    notes: { type: 'string', description: '需要人工注意的地方，沒有就給空字串' },
  },
} as const;

/** 呼叫端只需提供 messages.create；Node 與 Deno 的 Anthropic SDK 都符合 */
export interface MessagesClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      stop_reason: string | null;
      content: { type: string; text?: string }[];
    }>;
  };
}

export function validateInput(body: unknown): RecognizeInput {
  const b = body as Partial<RecognizeInput> | null;
  if (!b || typeof b.imageBase64 !== 'string' || b.imageBase64.length === 0) throw new RecognizeError('沒有收到圖片', 400);
  if (b.imageBase64.length > 7_000_000) throw new RecognizeError('圖片太大，請重新拍照', 400);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(b.mediaType as string)) {
    throw new RecognizeError('只支援 JPG / PNG / WebP 圖片', 400);
  }
  return {
    imageBase64: b.imageBase64,
    mediaType: b.mediaType as RecognizeInput['mediaType'],
    playerNames: Array.isArray(b.playerNames) ? b.playerNames.map(String).slice(0, 4) : [],
    needCourse: b.needCourse === true,
  };
}

function fit18(arr: unknown): (number | null)[] {
  const a = Array.isArray(arr) ? arr.slice(0, 18) : [];
  while (a.length < 18) a.push(null);
  return a.map((v) => (typeof v === 'number' && Number.isInteger(v) ? v : null));
}

const validStroke = (v: number | null) => (v !== null && v >= 1 && v <= 20 ? v : null);

/** 整理模型輸出：補齊 18 格、剔除不合理的數字 */
export function postprocess(raw: unknown): RecognizeResult {
  const r = raw as Partial<{ players: { nameOnCard?: unknown; strokes?: unknown }[]; pars: unknown; hcpIndex: unknown; notes: unknown }>;
  if (!r || !Array.isArray(r.players)) throw new RecognizeError('辨識結果格式不正確，請重試或改用手動輸入');
  if (r.players.length === 0) throw new RecognizeError('成績卡上找不到球員桿數，請確認照片是否清楚');

  const notes = [typeof r.notes === 'string' ? r.notes.trim() : ''];
  if (r.players.some((p) => !Array.isArray(p.strokes) || p.strokes.length !== 18)) {
    notes.push('部分球員讀到的洞數不是 18 洞，請特別核對。');
  }
  return {
    players: r.players.slice(0, 6).map((p) => ({
      nameOnCard: typeof p.nameOnCard === 'string' ? p.nameOnCard.trim() : '',
      strokes: fit18(p.strokes).map(validStroke),
    })),
    pars: Array.isArray(r.pars) ? fit18(r.pars) : null,
    hcpIndex: Array.isArray(r.hcpIndex) ? fit18(r.hcpIndex) : null,
    notes: notes.filter(Boolean).join(' '),
  };
}

export async function recognizeScorecard(client: MessagesClient, input: RecognizeInput): Promise<RecognizeResult> {
  const instruction = [
    input.playerNames.length
      ? `這場有 ${input.playerNames.length} 位球員，名字可能是：${input.playerNames.join('、')}（成績卡上可能寫綽號、縮寫或空白）。`
      : '',
    input.needCourse ? '這個球場尚未建檔，請一併讀取每洞的 Par 與差點洞序。' : 'pars 與 hcpIndex 請給 null。',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 } },
          { type: 'text', text: instruction },
        ],
      },
    ],
    output_config: { format: { type: 'json_schema', schema: SCORECARD_SCHEMA } },
  });

  if (response.stop_reason === 'refusal') throw new RecognizeError('這張圖片無法辨識，請改用手動輸入');
  if (response.stop_reason === 'max_tokens') throw new RecognizeError('辨識結果過長，請重試');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new RecognizeError('辨識結果是空的，請重試或改用手動輸入');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RecognizeError('辨識結果格式不正確，請重試或改用手動輸入');
  }
  return postprocess(parsed);
}

/** 把 Anthropic SDK 的錯誤轉成給使用者看的訊息（用 status 判斷，Node / Deno 通用） */
export function describeApiError(e: unknown): RecognizeError {
  if (e instanceof RecognizeError) return e;
  const status = typeof e === 'object' && e !== null && 'status' in e ? Number((e as { status: unknown }).status) : NaN;
  if (status === 401) return new RecognizeError('ANTHROPIC_API_KEY 無效，請檢查設定', 500);
  if (status === 429 || status === 529) return new RecognizeError('辨識服務忙碌中，請稍後再試', 503);
  if (status === 400) return new RecognizeError('圖片無法處理，請重新拍照', 400);
  if (Number.isFinite(status)) return new RecognizeError(`辨識服務錯誤（${status}）`, 502);
  return new RecognizeError('無法連線到辨識服務，請稍後再試', 502);
}
