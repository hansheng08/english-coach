# RUNBOOK

- 版本：v0.8（2026-11-24，O-007：Verify 改用 `gh api`＋`gh run list`、不再 `git fetch`；Notify 區分 `verify_failed`；`claude-code-action` 釘 SHA。v0.7：O-006 `--max-turns` 200 與 T-003 run 45314135320 實測）
- 擁有者：SRE
- 專案：hansheng08/english-coach
- 本文件記錄維運時怎麼查、怎麼排除問題。關卡文件與發佈清單不在這裡。

## 1. 模式 C 疑難排解：Claude 推分支後 CI 沒重跑

**模式 C** 是憲章規定的交棒方式：任務單進 main 後，用 `repository_dispatch`（GitHub 的自訂事件）叫 GitHub Actions 上的 Claude Code 執行，再把結果推到 `task/<編號>` 或 `fix/<編號>`。

### 1.1 為什麼用 `GITHUB_TOKEN` 推送不會觸發 CI

**`GITHUB_TOKEN`** 是 GitHub Actions 自動提供的短期權限憑證。為了避免 workflow 自己觸發自己、形成無窮迴圈，GitHub 規定：用這個 token 做的 `git push`（以及多數其他事件）**不會**開新的 workflow run。例外只有 `workflow_dispatch`（手動或用 API 指定跑某個 workflow）和 `repository_dispatch`。

T-900 試跑（2026-11-23 21:01–21:03 台北時間，run [45179784919](https://github.com/hansheng08/english-coach/actions/runs/45179784919)）就是這個現象：`ci.yml` 雖然已設定 `on.push` 監聽 `task/**`，但只有後來開 PR 時才跑到一次 `pull_request` 的 CI，沒有 `event=push` 的 run。

就算 `claude-code-action` 已用 OIDC 換成 **Claude GitHub App token**（安裝在本 repo 的 GitHub App 憑證，用它推送理論上會觸發 CI），若 checkout 仍把 `GITHUB_TOKEN` 寫進 HTTP `Authorization` header，這個 header 會蓋過 remote URL 裡的 App token，推送看起來成功，CI 卻不會跑。

另外：用 `workflow_dispatch`，或把 CI 接在同一個 `repository_dispatch` run 裡當 reusable workflow，官方文件寫明其 job 檢查**不會**出現在 PR 檢查區，也不算 required check。因此不當作主方案。

### 1.2 修正（方案 A'，O-002）

`.github/workflows/claude-run-task.yml` 的 `actions/checkout` 必須設 `persist-credentials: false`，避免 `GITHUB_TOKEN` 的 credentials 檔（checkout v6 會用 `includeIf.gitdir` 掛上）蓋掉 App token。

`anthropics/claude-code-action` **不要**傳 `github_token` 輸入（尤其不要傳 `${{ secrets.GITHUB_TOKEN }}`），讓它繼續用既有的 OIDC → Claude GitHub App token 設定 git 認證。

O-002 合併進 main 之後，Claude 推 `task/*` 或 `fix/*` 時，應出現 `event=push` 的 `ci.yml` run，而且 `headSha` 等於該分支先端。若當時已經有 PR，也應出現 `pull_request` 的 synchronize run。workflow 裡的「Verify push triggered CI」步驟會查這件事；若約 3 分鐘內沒有對應的 push run，該步驟會失敗，方便回報幕僚長。（O-007 起這一步不再 `git fetch`，改用 `gh api`；見 §1.5。）O-003 起：通知幕僚長的 `outcome` 不再只看 `steps.claude.outcome`；若「Verify push triggered CI」失敗，webhook 的 `outcome` 會是 `failure`（以前仍會回 success）。

`ci.yml` 的 `db`、`e2e` job 只在事件為 `pull_request` 時執行。若只有 `push`、沒有 PR，這兩個 job 會被略過，這是既有設計，不是回歸錯誤。

### 1.3 在哪裡看權限拒絕與 execution 紀錄

Claude 若想跑未被允許的指令，action 的結果只會顯示 `permission_denials_count`（拒絕次數），預設 log 不會列出是哪一個指令。

O-002 之後，在該次 **Claude Run Task** 的 run 頁：

1. **Job summary**（作業摘要）：只列出被拒絕的 `tool_name`（工具名稱）與 `command`（指令）。count 可以是 0。
2. **Artifact**（可下載的附件）：名稱為 `claude-execution-output-<任務編號>-<run_id>`，內容是 `steps.claude.outputs.execution_file`（通常是 `$RUNNER_TEMP/claude-execution-output.json`），**保留 7 天**。

風險：這個 JSON 可能含倉庫內容，或工具輸出裡被回顯的敏感字串。本 repo 是私有的，凡有讀取權限的協作者都可以下載 artifact。不要把完整檔案貼到公開地方。

### 1.4 方案 A（另建 token）必須先問幕僚長

若 A' 合併並經過新的模式 C 試跑後，`event=push` 的 `ci.yml` 仍沒出現，備案是方案 A：另建一個 GitHub App 或 fine-grained PAT（個人精細權限憑證），把 App ID／私鑰或 PAT 存成 repo secret，讓推送使用這個憑證。

**任何人不得自行新增這個密鑰。** 要走方案 A 必須先問幕僚長，再由 Hansheng 核准後才設定。本文件不記載任何 token 或金鑰的值。


### 1.5 Verify 步驟在 `persist-credentials: false` 下的憑證限制（O-007）

**現象（假紅燈）**：T-003 重派 run [45323782247](https://github.com/hansheng08/english-coach/actions/runs/45323782247)（2026-11-24 12:04:09–12:10:39 Asia/Taipei，job `138208314360`）Step 7「Run Claude Code」success，Step 10「Verify push triggered CI」failure，Notify 把整次當成 failure。job log 原文（`gh run view 45323782247 --log --job 138208314360`，去掉 ANSI 色碼）：

```
2026-11-24T04:04:28.1226158Z App token successfully obtained
2026-11-24T04:04:28.4557801Z ✓ Updated remote URL with authentication token
2026-11-24T04:10:32.3551765Z ##[start-action display=Revoke app token;id=claude.__run_8]
2026-11-24T04:10:33.9848372Z fetching origin/task/T-003
2026-11-24T04:10:34.1898796Z remote: Invalid username or token. Password authentication is not supported for Git operations.
2026-11-24T04:10:34.1899836Z fatal: Authentication failed for 'https://github.com/hansheng08/english-coach.git/'
2026-11-24T04:10:34.1930578Z ##[error]Process completed with exit code 128.
2026-11-24T04:10:35.5361880Z notify outcome=failure (claude=success verify=failure summary=success)
```

**已驗證的事實**：
- 同一次 run 裡 Claude App 的推送**有**觸發 CI：push run [45324530991](https://github.com/hansheng08/english-coach/actions/runs/45324530991)（`event=push`、`headBranch=task/T-003`、`headSha=1a2ef4c4ded3241f9583f1e9d7a55e63080af29d`、`createdAt=2026-11-24T04:10:29Z`＝12:10:29 Asia/Taipei，早於 Verify 開始的 12:10:33；conclusion=success）。這證明 §1.1／§1.2 的 `persist-credentials: false` 保護在真實 run 有效，**不得**為了讓 `git fetch` 通過而改回 `true`。
- `claude-code-action` 在 Step 7 開頭把 App token 寫進 remote URL（`✓ Updated remote URL with authentication token`），在 Step 7 結束前執行 `Revoke app token`。之後的 `git fetch` 帶著已撤銷的 token，所以 GitHub 回 `Invalid username or token`。（機制依上方 log 順序推得；沒有另做「注入新憑證重跑」的對照實驗。）

**修正（O-007）**：`.github/scripts/verify-push.sh` 完全不跑 `git fetch`，改用 Verify 步驟注入的 `GH_TOKEN: ${{ github.token }}`（本 job 的 `GITHUB_TOKEN`，整個 job 期間有效，與 Claude App token 無關）：
1. `gh api repos/<owner>/<repo>/git/ref/heads/<branch>` 取遠端分支先端（需 `contents` 讀取；workflow 已有 `contents: write`）。回應必須是**單一** JSON 物件、`.ref == "refs/heads/<branch>"`、`.object.type == "commit"`、`.object.sha` 為 40 位小寫十六進位；JSON 陣列（舊 `git/refs` 端點的前綴比對會回陣列）或其他形狀一律失敗。box 實測：單數 `git/ref/heads/<前綴>` 對不存在的完整名稱回 `gh: Not Found (HTTP 404)`，不做前綴比對。
2. `gh run list --repo <repo> --workflow ci.yml --branch <branch> --event push --json …` 輪詢（預設 12 次、每次間隔 15 s，可用 `VERIFY_PUSH_ATTEMPTS`／`VERIFY_PUSH_SLEEP` 調整），必須找到 `event=push`、`headBranch=<branch>`、`headSha=<步驟 1 的 SHA>` 的 run（需 `actions: read`）。
3. 失敗一律 exit 1，並把原因碼寫進 `GITHUB_OUTPUT` 的 `verify_reason`：`bad_input`（缺 `GH_TOKEN`／`GITHUB_REPOSITORY`、分支名不合法、輪詢參數不合法）、`branch_missing`（HTTP 404：推送沒到 GitHub）、`api_auth`（HTTP 401／403）、`api_error`（其他 `gh api` 錯誤）、`bad_ref_json`、`run_list_error`（`gh run list` 失敗，含 401／403）、`bad_run_json`、`no_push_run`（分支在、但找不到對應的 push run）。成功為 `ok`。`GH_TOKEN` 的值不會印出。

**Notify 區分 Claude 與 Verify（O-007）**：`run-task-outcome.sh --json` 產生 webhook 的 outcome 欄位，`claude-task-finished` payload 保留 `event`、`task`、`run`、`outcome`，另加 `claude_outcome`、`verify_outcome`、`summary_outcome`、`verify_reason`：

| `outcome` | 條件 | 怎麼看 |
|---|---|---|
| `success` | Claude、Verify、summary 三步都是 success | 唯一的綠燈 |
| `verify_failed` | Claude success、summary success、Verify failure | Claude 已完成；看 `verify_reason`：`branch_missing` 代表分支沒推上去（當成任務問題處理），`api_auth`／`api_error`／`run_list_error`／`bad_*` 是基礎設施，`no_push_run` 是分支在但沒有 push CI |
| `summary_failed` | Claude success、Verify success、summary failure | 偵測到拆開重送，或 PR／commit 摘要留言失敗 |
| `cancelled` | Claude cancelled | |
| `failure` | 其他所有組合：Claude failure／skipped／不合法值、Verify 與 summary 同時失敗、Claude success 但 Verify／summary 為 skipped／cancelled／不合法值、參數個數不對 | 預設失敗 |

這**不是** fail-open：`verify_failed`／`summary_failed` 都不是 success，而且 Verify 失敗時該步驟本身仍失敗，整個 job 仍是紅燈。

**本機測試（2026-11-24，box；原始輸出見 `docs/reports/O-007.md`）**：`verify-push-test.sh` 31 個案例（假的 `gh`／`git` 放在 PATH 前面，零網路、不等待；假的 `git fetch` 一被呼叫就 exit 97）、`run-task-outcome-test.sh`、`claude-permission-check.test.mjs`（M19～M25：checkout 必須 `persist-credentials: false`、verify-push 不得 `git fetch`、Verify 必須帶 `GH_TOKEN`、`claude-code-action` 必須釘 SHA）全部 exit 0；對 `verify-push.sh`、`run-task-outcome.sh`、`claude-permission-check.mjs` 各做的暫時突變都讓對應測試 exit 1。box 上以 box 的 `gh` 權杖實跑 `verify-push.sh task/O-001` → `exit=0 verify_reason=ok`；`task/O-999` → `gh: Not Found (HTTP 404)`、`exit=1 verify_reason=branch_missing`。

**待下次真實 `run-task` 實測驗證**：在 Actions 上用 `github.token` 跑新的 Verify（`gh api git/ref` 與 `gh run list`）、`verify_reason` 在步驟失敗時仍寫進 `steps.verify_push.outputs`、Notify 送出的新 payload 欄位、以及釘 SHA 後的 `claude-code-action`。在那之前這幾項標未驗證。

## 2. CI `db` job：本機 Supabase 與 health／ADR-009 檢查

**`db` job** 只在 `pull_request` 事件、且偵測到 Supabase 設定時執行（`push` 到 `task/**` 會略過，這是既有設計）。偵測條件：repo 根目錄有 `supabase/config.toml`（T-003 之後的產品設定），或有 CI 探針 `.github/ci/supabase-probe/supabase/config.toml`（O-003 在產品骨架進 main 之前用來讓 job 真正跑起來，不是產品程式）。

### 2.1 Linux runner 上的工具

GitHub 的 `ubuntu-latest` runner 已內建 Docker，不必再裝。`ci.yml` 用釘選 SHA 的 `supabase/setup-cli@689adcfb80d947100a1eab127289b97d1fb07b13`（v3.2.0），版本號在 `env.SUPABASE_CLI_VERSION`。本機除錯可裝同一版 CLI，並確認 `docker info` 成功。

### 2.2 job 做什麼（腳本：`.github/scripts/db-job-verify.sh`）

1. `supabase start -x studio,imgproxy,logflare,vector,mailpit,realtime,postgres-meta,supavisor`（排除用不到的服務以省時間；不可排除 `gotrue`、`kong`、`edge-runtime`）。
2. `supabase db reset`。有 `supabase/tests/` 才跑 `supabase test db`（RLS 測試仍等 T-004）。
3. 背景執行 `supabase functions serve --no-verify-jwt`（與 ADR-010 的 `verify_jwt = false` 一致，讓請求進到函式內驗證），dummy `--env-file` 使用 ADR-010 的名稱（`GEMINI_API_KEY`、`GROQ_API_KEY`、`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`APP_ALLOWED_ORIGINS` 等），**不是** GitHub secret。
4. 對 `GET {API_URL}/functions/v1/api/health`（ADR-010、ARCHITECTURE §5.1）做 curl（最多約 30 次、每次 timeout 5 s）：
   - 無 JWT → 401
   - 帶 `supabase status -o env` 的 `ANON_KEY` → 401（這不是登入使用者的 JWT；`requireUser` 要求 `role === 'authenticated'`）
   - 用本機 **Auth Admin API** 建立的已確認測試使用者，以密碼登入取得的 access token → 200 `{ "ok": true }`（見下方第 4a 點）
4a. **註冊關閉與測試帳號（O-005，Q-26 方案 B）**：設定檔 `[auth] enable_signup = false`（Q-01、ARCHITECTURE §7「關閉註冊」）。腳本 `.github/scripts/db-auth-check.sh`（被 `db-job-verify.sh` source）逐項 fail-closed：
   - `GET /auth/v1/settings` 必須 HTTP 200 且 `disable_signup: true`；
   - `POST /auth/v1/signup` 必須被拒（HTTP 400／403／422 且 `error_code=signup_disabled`），證明註冊真的關閉；
   - `POST /auth/v1/admin/users`（`email_confirm: true`）只帶 `apikey: <SECRET_KEY>`：CLI 3.2.0 的本機 Kong 會把 `apikey` 等於 secret key 的請求轉成 `Authorization: Bearer <service_role JWT>` 再送 Auth（來源：supabase/cli v3.2.0 `apps/cli/src/commands/start/services/kong.service.ts` 的 `buildKongBearerToken`）；必須 HTTP 200／201，且有 `id`、相同 email、`email_confirmed_at`；
   - `POST /auth/v1/token?grant_type=password`（`apikey: <PUBLISHABLE_KEY>`）必須 HTTP 200、`token_type=bearer`、`access_token` 為三段式 JWT，且 payload `role=authenticated`、有 `sub`、非匿名。
   - `SECRET_KEY`、`PUBLISHABLE_KEY`、`ANON_KEY`、`API_URL` 取自 `supabase status -o env`（CLI 3.2.0 變數名，來源同上 repo 的 `apps/cli/src/commands/status/SIDE_EFFECTS.md`）；缺任何一個就失敗。測試密碼每次隨機產生、只用一次；**任何金鑰、密碼、token 的值都不印**，`supabase start`／`db reset` 輸出也先遮罩 `sb_secret_…`、`sb_publishable_…`、JWT 與 S3 金鑰。
   - 產品設定（T-003 起改用根目錄 `supabase/config.toml`）同樣要 `enable_signup = false`，否則 `db` job 會在上面第一、二項失敗——這是刻意的（Q-01）。
   - CI 實測：以 O-005 PR 觸發的 `pull_request` run 為準（run 連結記在 PR 說明與 TechLead Review 留言；憲章 v5 §9 不為補 run ID 另推 commit）。該 run 綠燈之前，上述 Auth 流程在 CLI 3.2.0 的實際行為視為未驗證；腳本邏輯本身由 `db-auth-check-test.sh`（CI `pushguard`）以假回應驗證。
5. ADR-009 (1)：serve 日誌不得出現 `@english-coach/contracts` 解析失敗。
6. ADR-009 (2)：**不要**跑 `supabase functions deploy`（CLI 3.2.0 為 Remote only，且沒有 `--dry-run`）。本機若找不到 eszip，以 serve 成功載入 contracts 作為本機等效，並標 UNCONFIRMED。如何結案見 §2.4；T-018 的前端 Vite／`bundle` job **不算**。
7. 無論成功失敗，最後會 `supabase stop`（腳本 `trap`）。

timeout 為 20 分鐘（O-001 原為 15，因新增 serve／health／打包檢查而延長）。

### 2.3 失敗時怎麼看

- **job 被略過（skipped）**：不是 PR，或兩個 `config.toml` 都不存在。O-003 之後探針應讓 `has_supabase=true`。
- **`docker info` 或 `supabase start` 失敗**：映像拉取逾時、或排除的服務名稱拼錯。對照 `supabase start --help` 的 `-x` 清單。
- **health 一直連不上**：看該步驟上傳／印出的 `functions-serve.log` 末段；常見是函式編譯失敗或 contracts 路徑不對。
- **無 JWT 不是 401、或 ANON_KEY 變成 200**：閘道 `verify_jwt` 可能仍開著，或函式沒做 `requireUser`。確認 `config.toml` 有 `[functions.api] verify_jwt = false`，且 serve 有 `--no-verify-jwt`。
- **`disable_signup=true` 或 signup 被拒檢查失敗**：設定檔 `[auth] enable_signup` 不是 `false`（產品設定或探針）。依 Q-01 改回 `false`，不要為了讓 CI 綠燈而打開註冊。
- **Auth Admin API 建帳號失敗（401／403）**：`supabase status -o env` 沒有 `SECRET_KEY`，或本機 Kong 沒把 secret key 轉成 service_role（CLI 版本變了）。看日誌的 `admin create user HTTP …` 與 `error_code`；不要改用寫死的金鑰值。
- **使用者 JWT 不是 200**：先看 `password sign-in HTTP …` 與 `user JWT: alg=… role=…` 兩行；或 CLI 只注入舊金鑰名稱（`SUPABASE_ANON_KEY`），探針會在 200 路徑回 500 並讓 job 失敗——這時依 ADR-010 **停下回報 Architect**，不要改產品程式去讀舊名稱。
- **ADR-010 金鑰檢查失敗**：函式日誌必須有獨立 token `adr010-env`，後面四欄 `has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false`（只記有無，不記值）。只有舊前綴 `o003-env` 也算失敗。T-003 的產品 `api` 函式要印同樣格式的一行。
- **ADR-009 (1) 失敗**：`deno.json` 的 `imports` 是否指向 `packages/contracts/src/index.ts`。
- 不要在 CI 對已連結的遠端專案跑 `functions deploy`（需要新的 `SUPABASE_ACCESS_TOKEN`，必須先問幕僚長）。

本文件不記載任何 token 或金鑰的值。


### 2.4 ADR-009 在 CLI 3.2.0 的結果（O-003 實測）

**ADR-009 (1) 已通過。** CLI 3.2.0 預設不會讀 `supabase/functions/deno.json`，必須在探針 `config.toml` 的 `[functions.api]` 寫 `import_map = "./functions/deno.json"`（路徑相對 `supabase/`）。`functions serve` 啟動時會刪掉 `supabase start` 起的 edge-runtime 再起一個新容器；要等日誌出現 `Serving functions on` 之後，再對**新容器**做 `docker inspect`。修正後的 PR-event run：

- https://github.com/hansheng08/english-coach/actions/runs/45213610756
- https://github.com/hansheng08/english-coach/actions/runs/45214375918（2026-11-24 00:15–00:17 台北時間）

都有 `SERVE_READY`、`MOUNT_OK: packages/contracts appears in the container mount list.`、serve 日誌無 contracts 解析錯誤，且 health 有跑到使用 contracts 的探針（無 JWT／ANON_KEY → 401，使用者 JWT → 200）。

修正前（僅作對照）：在尚未設定 `import_map` 時，即使主機上 `packages/contracts` 已與 `supabase/` 同層，`functions serve` 仍會 `Module not found "file://…/packages/contracts/src/index.ts"`，health 為 HTTP 503 `BOOT_ERROR`。那不是目前狀態。備案（搬到 `supabase/functions/_shared/`，套件名稱不變）只在 (1) 再次失敗、或下面的 (2) 被推翻時才啟動。

**ADR-009 (2) 仍為 UNCONFIRMED（未驗證）。** 2026-11-24 08:22 Hansheng 修訂憲章 v5 §0.1：先維持未驗證、不另建專用測試專案、**不擋 T-003 開工**；等之後建立正式免費 Supabase 專案（尚無正式資料時）再實測一次部署（需要的雲端資源或 Secret 仍比照 G4 經 Hansheng 核准）；若屆時打包失敗，依 ADR-009 備案把 contracts／domain 搬到 `supabase/functions/_shared/`。 CLI 3.2.0 的 `functions deploy` 是 remote only、沒有 `--dry-run`，CI 不得部署。目前找不到本機 eszip，腳本以 serve 成功 import／掛載 contracts 作為本機等效，並在日誌標明尚未直接證明「部署包」含 contracts。

要關閉 UNCONFIRMED，需等到下列之一：未來 CLI 提供本機打包或 dry-run，且產物能證明含 contracts；或上述正式免費專案上、經 Hansheng 核准的一次部署能直接證明部署包含 contracts。**T-018 的前端 Vite／`apps/web`／`bundle` job 不算**，不能用來結案 (2)。在此之前 T-003 可繼續做 ADR-009 (3) 與產品骨架。


## 3. 執行環境能力表（寫任務單前先對照）

本表說明模式 C 各執行環境**現在實際做得到／做不到的事**。表上沒列、或標「未驗證」的，不得寫成任務單前提（憲章 v5 §4）。下列「已驗證」格子都附觀察證據；未實測的能力不寫成「能做」。

### 3.1 Actions 上的 Claude Code（`claude-run-task.yml`）

| 項目 | 狀態 | 依據 |
|---|---|---|
| 在 `task/`、`fix/`、`poc/` 分支工作；對**明確檔案路徑**做 `git add`／`commit`；單獨的 `git push -u origin <目前同名分支>` | 能做（已驗證） | T-012 等任務把分支推上 GitHub 並觸發 `ci.yml` `push` run（例如 run 45205560119 的後續乾淨 `git push` 曾成功；複合 `git push … 2>&1` 則被 pushguard 擋下）。`git add -A`／`--all`／`.`／`-u` 在 deny 清單，不是「能做」 |
| `git add -A`、`git add --all`、`git add .`、`git add -u` | 不能做（設定 deny）；`git add -A` 已在真實 run-task 被拒 | T-003 run 45314135320：tool-use step 167 指令原文 `git add -A`，結果 `Permission to use Bash with command git add -A has been denied.`（列在 artifact `permission_denials` 第 3 筆）。`--all`／`.`／`-u` 的真實被拒**未實測**（設定已列 `Bash(git add --all*)`、`Bash(git add .)`、`Bash(git add -u*)`） |
| `pnpm install --frozen-lockfile`、`pnpm check`／`typecheck`／`lint`／`arch`／`test`／`e2e` | 能做（設定已列） | `claude_args --allowedTools` 白名單（見 workflow）。個別指令是否每次成功視任務而定。O-005 起 `--allowedTools` 與 run-task SKILL 由 `Bash(pnpm install *)` 收窄為 `Bash(pnpm install --frozen-lockfile*)`＋`Bash(pnpm install --no-frozen-lockfile)` |
| `--max-turns` | 現行為 `200`（O-006 由 `120` 調高） | T-003 run 45314135320 的 `claude_args` 當時為 `--max-turns 120`（log 亦有 `"maxTurns": 120`）。execution artifact 的 result 事件：`"num_turns": 170`、`"stop_reason": "end_turn"`、`"terminal_reason": "completed"`、`"is_error": false`、`"subtype": "success"`（Claude 本身沒有在第 120 步停下）。action 隨後失敗，原始錯誤為 `Claude reported a successful result after 170 turns, exceeding the configured maximum of 120`，接著 `Process completed with exit code 1.`。因此將上限改為 200，讓 170 步的任務不會只因步數被判失敗 |
| 檔案用 Read／Write／Edit／Glob／Grep | 能做（設定已列） | 同上 `--allowedTools` |
| 改／推 `.github/workflows/` | 不能做（政策）；**一次被拒的推送未在本環境實測，標未驗證** | 憲章 v5 §5：Claude Code 的權杖改不了 workflow，改由 SRE 在 box 以 O-xxx 開 [G3] PR |
| Bash `cat`／`grep`／`head`／`ls`／`sed`（含複合指令裡的同名命令） | 不能做（`head`、`sed` 已在真實 run-task 被拒；`cat`／`grep`／`ls` 的真實被拒**未實測**） | `.claude/settings.json` deny 與 pushguard。T-003 run 45314135320 `permission_denials`：tool-use step 24 指令含 `\| head -30`，結果 `PreToolUse:Bash hook error: pushguard: Bash(head) is denied; use the Read / Glob / Grep tools (settings.json deny list). If denied, stop and record it (charter v5 §13 rule #12); do not split and resend`；step 49 指令以 `sed -i -e` 開頭，結果同樣格式但為 `Bash(sed) is denied`。T-012 曾用 `cd …; cat …; grep … \| head; ls; sed`（當時尚未 deny） |
| `gh`（含唯讀）、`curl`／`wget`／`sudo`、任意 `supabase` CLI、`docker` | 不能做（設定已列） | `--allowedTools` 未開放；不得當作任務單裡的驗證手段 |
| 開 PR、合併 PR、推 `main`、force push | 不能做 | pushguard + 任務單強制工作規則；本表不把這些寫成可做之事 |
| 已核准的 lockfile 更新：單獨一條 `pnpm install --no-frozen-lockfile`（先用 Edit 改 `package.json`，再跑這條） | 能做（已驗證：真實 run-task） | T-003 run [45314135320](https://github.com/hansheng08/english-coach/actions/runs/45314135320)（2026-11-24 10:40–10:51 Asia/Taipei；head `1743021f5f96051d5683c58fe558c820142b55f2`）execution artifact 出現一次、且僅一次，指令原文為 `pnpm install --no-frozen-lockfile`（tool-use step 18，`is_error=False`）。原始輸出：`Scope: all 4 workspace projects`／`✓ Lockfile passes supply-chain policies (verified 55s ago)`／`Packages: +9`／`Done in 1.6s using pnpm v12.21.0`。加上參數（例如 `… 2>&1`、`… zod`）仍不符精確規則（O-005 靜態檢查） |
| 未核准的新增／移除套件：`pnpm add *`、`pnpm remove *`、`pnpm install <套件>`、`pnpm i <套件>` | 不能做（設定）；真實 run-task 的被拒行為**未驗證** | 同一支檢查輸出：`pnpm add zod`／`pnpm remove zod` → `settings=ask actions=ask`（無人值守無法回答 ask），`pnpm install zod`／`pnpm i zod` → `settings=none actions=none`。O-005 前 `--allowedTools` 的 `Bash(pnpm install *)` 會放行 `pnpm install zod`（對 origin/main 跑同一支檢查得到 `claude-run-task.yml allows unapproved "pnpm install zod" via Bash(pnpm install *)`） |
| Read 真實環境檔（`.env`、`.env.local`、`.env.*.local`、`.env.dev*`、`.env.prod*`、`.env.stag*`、`.env.test*`、`.env.preview*`、`.env.secret*`、`.env.keys`、`.env.ci*`、備份檔 `.env.bak*` 等；根目錄與子資料夾） | 不能做（設定 deny）；真實 run-task 的比對行為**未驗證** | `.claude/settings.json` 對每種各列 `Read(./…)` 與 `Read(**/…)`；檢查輸出例如 `Read apps/web/.env.local: deny (Read(**/.env.local))`。未列名的變體（例如 `.env.foo`）不會被擋——repo 的 `.gitignore` 忽略 `.env*`，Actions 的 checkout 本來就沒有真實環境檔 |
| Write／Edit `supabase/functions/.env.example` | 能做（已驗證：真實 run-task） | T-003 run 45314135320 execution artifact：Write 一次（tool-use step 34）結果 `File created successfully at: /home/runner/work/english-coach/english-coach/supabase/functions/.env.example (file state is current in your context — no need to Read it back)`；Edit 兩次（steps 97、99）結果均為 `The file /home/runner/work/english-coach/english-coach/supabase/functions/.env.example has been updated successfully. (file state is current in your context — no need to Read it back)` |
| Read `.env.example`（根目錄、`apps/web/`、`supabase/functions/`） | 設定不擋（靜態規則檢查通過）；真實 run-task 的 Read **未實測** | T-003 run 45314135320 的 15 次 Read 的 `file_path` 都不含 `.env.example`（Write／Edit 成功後的回傳也寫「no need to Read it back」）。O-005 拿掉會連帶擋住 `.env.example` 的 `Read(./.env.*)`、`Read(**/.env.*)`；靜態檢查仍輸出 `Read .env.example: not denied`。根目錄與 `apps/web/.env.example` 的 Write／Edit／Read 在該次都未出現 |
| Verify 步驟用 `git fetch` 讀遠端分支 | 不能做（已在真實 run-task 失敗） | run 45323782247 Step 10：`remote: Invalid username or token. Password authentication is not supported for Git operations.`、`##[error]Process completed with exit code 128.`（App token 已在 Step 7 結束前撤銷）。O-007 改用 `gh api`＋`gh run list`（見 §1.5）；新做法在 Actions 上**待下次真實 `run-task` 實測驗證** |
| 指令被擋後拆開重送（例如複合 `git push` 被拒後再送單獨 `git push`） | 不能做；被偵測到則 `run_task_summary` 失敗 | `detect-resplit.mjs`；憲章 v5 §13 第 12 條。`git status` 等附帶允許指令不當作拆送 |

**權限規則怎麼驗（O-005、O-006）**：`.github/scripts/claude-permission-check.mjs` 讀真實的 `.claude/settings.json`、`claude-run-task.yml`、run-task SKILL，用「deny > ask > allow；`./x` 只比對根目錄、`**/x` 含根目錄的任何深度、`*` 不跨 `/`、`**` 跨 `/`；Bash 規則整條比對、`*` 為任意字元」的模型判斷；並檢查 `--max-turns` 必須是 200，以及 SKILL 含明確路徑 `git add` 與內建工具提醒。CI `pushguard` job 每次都跑它與 `claude-permission-check.test.mjs`（含把規則故意改壞、斷言 exit 1 的突變測試）。這是**對設定檔的靜態檢查**；Claude Code 執行時的實際比對器行為，除本節已引用的 T-003 run 45314135320 觀察外，其餘仍標未實測。

### 3.2 box 上的 SRE（共享 Linux；2026-11-24 09:55 Asia/Taipei 重新實測）

**沒有 Docker、沒有本機 Supabase CLI。** 本機實測原始輸出（`command -v` 逐一檢查）：

```
2026-11-24 09:55 CST
MISSING docker (command not found)
MISSING supabase (command not found)
MISSING deno (command not found)
MISSING gitleaks (command not found)
FOUND node /usr/local/bin/node
FOUND gh /usr/local/bin/gh
FOUND git /usr/bin/git
FOUND actionlint /usr/local/bin/actionlint
FOUND jq /usr/bin/jq
FOUND python3 /usr/bin/python3
FOUND curl /usr/bin/curl
MISSING shellcheck (command not found)
v24.22.1
1.7.12
jq-1.7
gh version 2.103.0 (2026-10-21)
```

（`gitleaks` 不是預裝：O-005 掃描時臨時下載官方 8.30.1、`sha256sum -c` 驗證後放在 `/tmp`，用完不算 box 的固定能力。上一版 08:09 的實測另列 `npm` 11.21.1、`pnpm` 12.21.0（需自設 `COREPACK_HOME`）、`git` 2.47.3、`python3` 3.13.5、`curl` 8.14.1。）

| 項目 | 狀態 | 依據 |
|---|---|---|
| `curl`、`gh`、`git`、`actionlint` 1.7.12、`node`／`jq`／`python3` | 能做（已驗證） | 上方 `command -v` 與 `--version`（2026-11-24 09:55 Asia/Taipei） |
| 本機跑 CI 的腳本測試（`node --test`、`*-test.sh`、`claude-permission-check.mjs`、`fail-open-lint.mjs`、`actionlint`） | 能做（已驗證） | O-005 本機全數 exit 0，原始輸出見 `docs/reports/O-005.md` |
| `shellcheck`、`deno` | 不能做（未安裝） | 上方 `MISSING`；actionlint 因此不會對 `run:` 區塊做 shellcheck |
| 改 CI／探針／`.github/workflows/` 並推 `task/O-xxx`、開 [G3] PR | 能做（已驗證） | 本機成功 `git push` 含 workflow 的 `task/O-004`，並 `gh pr create`／`gh pr edit`（PR #18） |
| Docker、`supabase start`／`functions serve` | **不能做** | `docker`／`supabase` 指令不存在；db job 的 CLI 驗證只能在 GitHub Actions 的 `db` job 跑 |
| 合併 PR、推 `main`、force push、自設 GitHub secret、未核准就派 Claude Code | 不做（政策） | 交接單與憲章；本輪未嘗試這些動作 |

### 3.3 各權杖

| 權杖 | 已驗證能做 | 限制／不能做 | 未驗證 |
|---|---|---|---|
| **`ci.yml` 的 `GITHUB_TOKEN`** | 讀 repo、checkout（workflow 設 `persist-credentials: false`）、跑測試、彙總 `ci-ok` | workflow 宣告 `permissions: contents: read`。用這個 token 做的 `git push` **不會**觸發新的 workflow（見 §1.1）。本環境觀察：`gh pr checks`／`statusCheckRollup` 曾 403（沒有 checks 讀取權） | 是否另有未寫在 workflow 的隱藏權限 |
| **`claude-run-task.yml` 的 `GITHUB_TOKEN`** | O-007 起 Verify 用它跑 `gh api …/git/ref/heads/<branch>`（`contents`）與 `gh run list`（`actions: read`），Actions 上**待下次真實 `run-task` 實測驗證**（run 45323782247 的 Verify 在 `git fetch` 就結束，沒有跑到 `gh run list`）。無 PR 時，C3 會在 head commit 留言：T-003 run 45314135320 步驟「Detect denied-command resplit and post run-task summary」原始輸出 `Posted run-task summary as commit (1743021f5f96051d5683c58fe558c820142b55f2)`，GitHub commit comment `id` 211531977（建立於 2026-11-24 10:51:10 Asia/Taipei），開頭為 `## run-task summary (T-003)`。workflow 另宣告 `contents: write`、`id-token: write`、`actions: read`、`pull-requests: write` | 不應用來開新 PR 或合併。該次 `CLAUDE_OUTCOME=failure`、`VERIFY_OUTCOME=skipped`、`SUMMARY_OUTCOME=success`，Notify 輸出 `run-task-outcome: claude=failure verify=skipped summary=success -> failure` | 既有 PR 上的 `gh pr comment`、以及 `gh pr comment` 回 403 時改留 commit comment 的 fallback：該次是 `repository_dispatch` 打在 `main`、沒有 PR，走的是「無 PR → commit comment」路徑，**不是** 403 fallback，故這兩項仍標未驗證 |
| **Claude GitHub App token（OIDC）** | 推送到 `task/`／`fix/`／`poc/` 且可觸發 `ci.yml` 的 `push` run（O-002 修正後的既有 run；T-003 run 45323782247 的推送觸發 push run 45324530991，`event=push`、`headSha=1a2ef4c…`、success） | 不應用來合併或改 repo secrets；依憲章不能改 `.github/workflows/`。**只在 Step 7 內有效**：action 在步驟結束前 `Revoke app token`，之後的步驟不能用 remote URL 裡的 token 做 `git fetch`／`git push`（§1.5） | action 是否偶爾仍用 `GITHUB_TOKEN` 寫入（故仍保留 `contents: write`）；workflow 推送被拒的一次實測 |
| **box 上 SRE 使用的 GitHub 權杖** | 細項 PAT（`gh auth status` 顯示 `github_pat_`，API 無 `X-OAuth-Scopes` 標頭；到期 2026-12-21 23:30 Asia/Taipei）。已驗證：推送含 `.github/workflows/` 的分支（等同需要 workflow 寫入）、開／編輯 PR、讀 Actions log 與 issue comment | 本輪未用它合併、未設 secret、未推 `main`、未 force push | 細項 PAT 的完整權限矩陣無法從 API 標頭列完，除上述已觀察項外皆標未驗證 |

### 3.4 `poc-spike.yml`（手動 `workflow_dispatch`）

在 `poc/A-xxx` 分支上跑 `.github/ci/spike.sh` 或環境檢查；**不需要 Docker**。不部署、不加 secret。不得把 spike 當成 T-018 `bundle` job 或 ADR-009 (2) 的部署證明。本輪**未**對此 workflow 做一次 `workflow_dispatch` 實測（標未驗證）。

`db` job 只在 `pull_request` 跑；`push` 事件若略過 `db`，`ci-ok` 會標「未驗證」，該次 push 綠燈不代表 health／ADR-009 已驗過。
