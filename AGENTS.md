# 高爾夫賭球結算：開發規則

使用者規格與上線步驟見 [README.md](README.md)。架構比照 `C:\Users\User\Desktop\麵店\recipe-system`（GitHub Pages + Supabase）。

## 架構

- 前端：React 19 + Vite + React Router（`createHashRouter`，靜態託管不需要改寫網址）+ TanStack Query + Tailwind 4。介面一律繁體中文（台灣用語），手機優先。
- 後端：Supabase（Postgres、Auth、Storage 私有 bucket `scorecards`、Edge Function `recognize-scorecard`）。
- **兩種後端，同一套 SQL**（`src/data/backend.ts`）：有 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 時用 Supabase；沒有時用示範模式（瀏覽器內 PGlite 跑同一套 migrations）。`supabase/local/auth_shim.sql` 只給 PGlite 用。
- 權限：角色 `owner`（第一個註冊的帳號）、`member`、`pending`。`app` schema 的資料表開 RLS、不開 policy；前端只能呼叫 `public` schema 的 RPC，每個 RPC 先 `app.require_member()` / `app.require_owner()`。
- 結算：前端用 `src/engine/` 計算，`set_round_result` 由資料庫檢查（每位球員都有、加總為 0、成績完整、有球場資料）後寫入 `net_points` / `net_money`。改成績或設定的 RPC 會先把球局退回 draft，前端再呼叫 `api.resettle()`。
- 成績卡辨識：`supabase/functions/recognize-scorecard/core.ts` 不 import 任何套件，Edge Function（Deno）與本機開發伺服器（`vite.config.ts` 的 `/api/recognize`）共用。模型固定 `Codex-sonnet-5`（使用者指定）。

## 規則

- **新增或修改 RPC 的 migration，結尾一定要重跑 `20260923000003_grants.sql` 的權限區塊**，否則新函式會開放給 `anon`。
- 新增資料表：放在 `app` schema、啟用 RLS、只透過 RPC 存取，並在 `db-tests/` 補權限測試。
- `src/engine/` 不能 import React 或 Supabase；修改時一定要同時修改測試。計算相關的 bug 先補會失敗的測試再修。
- Anthropic API key 只能放在 Supabase Edge Function secret 與本機 `.env`；不能出現在前端、repo 或 `VITE_` 開頭的變數。
- 說「完成」前要跑 `npm run typecheck` 與 `npm test`；有改畫面就用示範模式在瀏覽器實際操作一次。
- 使用者的 Vercel 帳號不能建立專案，不要提議 Vercel。
