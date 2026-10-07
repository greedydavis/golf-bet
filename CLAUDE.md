# 高爾夫賭球結算：開發規則

使用者規格與上線步驟見 [README.md](README.md)。架構比照 `C:\Users\User\Desktop\麵店\recipe-system`（GitHub Pages + Supabase）。

## 架構

- 前端：React 19 + Vite + React Router（`createHashRouter`，靜態託管不需要改寫網址）+ TanStack Query + Tailwind 4。介面一律繁體中文（台灣用語），手機優先。
- 後端：Supabase（Postgres、Auth、Storage 私有 bucket `scorecards`、Edge Function `recognize-scorecard`）。
- **兩種後端，同一套 SQL**（`src/data/backend.ts`）：有 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 時用 Supabase；沒有時用示範模式（瀏覽器內 PGlite 跑同一套 migrations）。`supabase/local/auth_shim.sql` 只給 PGlite 用。
- 權限：角色 `owner`（第一個註冊的帳號）、`member`、`pending`。`app` schema 的資料表開 RLS、不開 policy；前端只能呼叫 `public` schema 的 RPC，每個 RPC 先 `app.require_member()` / `app.require_owner()`。
- 結算：前端用 `src/engine/` 計算，`set_round_result` 由資料庫檢查（每位球員都有、加總為 0、成績完整、有球場資料）後寫入 `net_points` / `net_money`。改成績或設定的 RPC 會先把球局退回 draft，前端再呼叫 `api.resettle()`。
- 分組：一場球局最多 2 組、8 人。座位第 1 組固定 A~D、第 2 組 E~H（`seatAt` / `flightOf`），組別由座位推得、資料庫不另存；某一組加減人不會讓另一組的座位代號位移。
- 抓球對象：讓桿矩陣的 `kind: 'none'` 代表這一對不抓，`settleRound` 會跳過。文字語法是 `AE不抓`。沒寫到的配對在引擎裡視為平打；開局精靈會用 `normalizeForSeats(text, seats, fallback)` 把所有配對明確寫出（單組補平打、兩組補不抓）。
- 前九戰況：`src/engine/interim.ts` 的 `frontNineReport` 只算前九（比洞用 `PairContext.upTo = 9`），結果不寫入資料庫。測試保證它和整場結算裡的前九小計完全一致，改比洞或讓桿分配時要一起顧到。
- 27 洞球場：差點洞序可以輸入「前九、後九各自 1~9」。畫面不當成重複，儲存前用 `toEighteenIndex` 換算成 18 洞（前九單數、後九雙數）再送資料庫；資料庫與引擎仍然只認 1~18 各一次。
- 成績卡圖片：一次最多 4 張（計分 App 常分前九、後九兩張），當成同一張成績卡送出；帶入表格時合併，預設只補空格。
- 辨識結果對應座位：模型回傳每一列對應名單的編號（`match`，比對同音字、異體字），`src/data/recognitionMapping.ts` 先用名字對應、對不上的再照成績卡順序。有些計分 App 一張圖只有一位球員，不能只靠順序。
- repo 是公開的：使用者放在專案根目錄的成績卡圖片（真實姓名與成績）已用 `.gitignore` 排除，不要加入版本控制，測試資料一律用虛構名字。
- 成績卡辨識：`supabase/functions/recognize-scorecard/core.ts` 不 import 任何套件，Edge Function（Deno）與本機開發伺服器（`vite.config.ts` 的 `/api/recognize`）共用。模型固定 `claude-sonnet-5`（使用者指定）。

## 規則

- **新增或修改 RPC 的 migration，結尾一定要重跑 `20260923000003_grants.sql` 的權限區塊**，否則新函式會開放給 `anon`。
- `public.ping()` 是唯一開放給 `anon` 的函式（保活排程 `.github/workflows/keepalive.yml` 用）。重跑權限區塊後要再 `grant execute on function public.ping() to anon`，其他函式不可開放給 `anon`。
- 新增資料表：放在 `app` schema、啟用 RLS、只透過 RPC 存取，並在 `db-tests/` 補權限測試。
- `src/engine/` 不能 import React 或 Supabase；修改時一定要同時修改測試。計算相關的 bug 先補會失敗的測試再修。
- Anthropic API key 只能放在 Supabase Edge Function secret 與本機 `.env`；不能出現在前端、repo 或 `VITE_` 開頭的變數。
- 說「完成」前要跑 `npm run typecheck` 與 `npm test`；有改畫面就用示範模式在瀏覽器實際操作一次。
- 使用者的 Vercel 帳號不能建立專案，不要提議 Vercel。
