# 高爾夫賭球結算

手機優先的賭球結算網站：讓桿簡寫解析、比洞 / 總桿結算、成績卡照片辨識（Claude）、LINE 摘要、歷史與球友累計輸贏。

架構與麵店食譜系統相同：**GitHub Pages（靜態網站）+ Supabase（資料庫、登入、照片、Edge Function）**，沒有自己的伺服器。

## 本機試用（示範模式）

```bash
npm install
npm run dev
```

打開 http://localhost:5190 。沒有設定 Supabase 時會進入**示範模式**：資料庫在瀏覽器內執行（PGlite），資料只存在這台電腦的瀏覽器。登入頁直接點示範帳號即可。

本機開發時，`.env` 的 `ANTHROPIC_API_KEY` 會讓示範模式也能辨識成績卡（由開發伺服器代為呼叫，不會打包進前端）。

## 測試

```bash
npm run typecheck
npm test
```

包含計分引擎、成績卡辨識核心，以及在 PGlite 上跑的資料庫測試（權限、驗證、結算檢查）。不需要 Docker。

## 上線步驟

### 1. 建立 Supabase 專案

1. 用**新的帳號**登入 [supabase.com](https://supabase.com)（免費方案每個帳號 2 個專案），New Project。
   - Region 選 Northeast Asia（Tokyo）
   - 保持 **Enable Data API** 開啟
2. 本機執行 `npm run db:bundle`，產生 `supabase/setup-all.sql`。
3. Supabase **SQL Editor** → New query → 貼上 `setup-all.sql` 全部內容 → Run。最後一列出現「安裝完成」代表成功。
4. **Project Settings → API Keys**：複製 Project URL 與 Publishable key（或舊的 anon public key）。
5. **Authentication → Sign In / Providers → Email**：保持開啟，建議**關閉 Confirm email**（新帳號本來就要管理者開通才能用）。

### 2. 先建立管理者帳號（部署之前）

**第一個註冊的帳號會自動成為管理者。** 部署前先到 Supabase **Authentication → Users → Add user → Create new user**，填你的 Email 與密碼，勾選 **Auto Confirm User**。

之後球友自己註冊的帳號都是「待開通」，由你在「更多 → 帳號與權限」改成「球友」。

### 3. 成績卡辨識（Edge Function）

1. Supabase **Edge Functions → Secrets** → 新增 `ANTHROPIC_API_KEY`，值填你的 Anthropic API key。
2. 部署函式（二選一）：
   - **自動**：GitHub repo 設定 secret `SUPABASE_ACCESS_TOKEN`（Supabase 帳號 → Access Tokens 產生）與 variable `SUPABASE_PROJECT_REF`（Project Settings → General 的 Project ID），推送後 GitHub Actions 自動部署。
   - **手動**：`npx supabase login`，再 `npx supabase functions deploy recognize-scorecard --project-ref <Project ID>`。

### 4. 設定 GitHub 變數，觸發網站部署

GitHub repo → **Settings → Secrets and variables → Actions → Variables**：

| 名稱 | 值 |
|---|---|
| `VITE_SUPABASE_URL` | Project URL，例如 `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Publishable key（或舊的 anon key） |
| `SUPABASE_PROJECT_REF` | Project ID（自動部署 Edge Function 用） |

**Settings → Pages → Source** 選 **GitHub Actions**。之後到 **Actions → 測試並部署 → Run workflow** 手動跑一次，或推送新的 commit。

Publishable key 本來就是公開給前端用的，資料安全由資料庫權限負責。**Secret key（舊名 service role key）與 Anthropic API key 絕對不要放進 GitHub 或前端。**

### 5. 上線後檢查

1. 用管理者帳號登入手機版網站
2. 新增球友 → 開一場球局 → 上傳成績卡照片，確認辨識與結算正常
3. 請球友註冊，在「更多 → 帳號與權限」開通

## 備份與注意事項

- Supabase 免費專案連續 7 天沒有使用會被暫停，進後台按 Restore 就能恢復。
- 免費方案沒有可下載的自動備份。

## 結構

| 路徑 | 說明 |
|---|---|
| `src/engine/` | 純函式計分引擎（不相依 React / Supabase），測試在 `tests/engine/` |
| `src/engine/config.ts` | 所有規則參數與預設值 |
| `src/engine/games/` | 賽制模組與登錄表（新增玩法：寫一個模組 → 加進 `registry.ts`） |
| `src/data/` | 後端介面（Supabase / 示範模式）、RPC 包裝、示範資料 |
| `src/pages/`、`src/components/` | 畫面 |
| `supabase/migrations/` | 資料表、RPC、權限 |
| `supabase/functions/recognize-scorecard/` | 成績卡辨識 Edge Function（`core.ts` 與本機開發伺服器共用） |
| `db-tests/` | 在 PGlite 上跑的資料庫測試 |

## 規則摘要

- **讓桿**：全場讓 N 依 18 洞差點洞序分配（超過 18 桿第二輪）；前 X 後 Y 在各九洞內依差點排名分配（超過 9 桿第二輪）。
- **比洞**：每洞以淨桿比勝負、每洞計點；carry over 會跨前後九累積，第 18 洞仍平手則作廢。前九 / 後九只是小計。
- **總桿**：前九 / 後九 / 全場各一注。全場讓 N 的配對只比 18 洞總桿（扣 N）；前 X 後 Y 的配對前九扣 X、後九扣 Y、全場扣 X+Y。
