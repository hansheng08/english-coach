# RUNBOOK

- 版本：v0.10（2026-11-25，O-014：Claude 用量上限 `outcome=usage_limit` 與 `usage_limit_*` 欄位（§1.5）、post-check 從 GitHub 重抓 main 並排除 main 上的 commit（§6.2）、假金鑰寫法（§6.1）。v0.9：2026-11-24，O-008：`taskcheck` job 與 run-task 的 Task lint 接線，見 §4。v0.8：O-007：Verify 改用 `gh api`＋`gh run list`、不再 `git fetch`；Notify 區分 `verify_failed`；`claude-code-action` 釘 SHA。v0.7：O-006 `--max-turns` 200 與 T-003 run 45314135320 實測）
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
3. 失敗一律 exit 1，並把原因碼寫進 `GITHUB_OUTPUT` 的 `verify_reason`：`bad_input`（缺 `GH_TOKEN`／`GITHUB_REPOSITORY`、分支名不合法、輪詢參數不合法、缺合法 `PRE_HEAD`）、`branch_missing`（HTTP 404：推送沒到 GitHub）、`api_auth`（HTTP 401／403）、`api_error`（其他 `gh api` 錯誤）、`bad_ref_json`、`head_mismatch`（遠端 tip 不等於這次 local HEAD）、`stale_head`（遠端 tip 等於 `PRE_HEAD`，這次沒有新的推送）、`run_list_error`（`gh run list` 失敗，含 401／403）、`bad_run_json`、`no_push_run`（分支在、但找不到對應的 push run）。成功為 `ok`（O-026：還必須遠端 tip＝local HEAD 且 ≠ `PRE_HEAD`，且該 SHA 已觸發 `ci.yml` event=push 的 run；不要求該 run 的 `conclusion=success`）。`GH_TOKEN` 的值不會印出。

**Notify 區分 Claude 與 Verify（O-007）**：`run-task-outcome.sh --json` 產生 webhook 的 outcome 欄位，`claude-task-finished` payload 保留 `event`、`task`、`run`、`outcome`，另加 `claude_outcome`、`verify_outcome`、`summary_outcome`、`verify_reason`：

| `outcome` | 條件 | 怎麼看 |
|---|---|---|
| `success` | Claude、Verify、summary 三步都是 success | 唯一的綠燈 |
| `verify_failed` | Claude success、summary success、Verify failure | Claude 已完成；看 `verify_reason`：`branch_missing` 代表分支沒推上去（當成任務問題處理），`api_auth`／`api_error`／`run_list_error`／`bad_*` 是基礎設施，`no_push_run` 是分支在但沒有 push CI |
| `summary_failed` | Claude success、Verify success、summary failure | 偵測到拆開重送，或 PR／commit 摘要留言失敗 |
| `usage_limit` | （O-014）Task lint success、Claude failure，且 execution file 最後一個 result 是 `is_error: true`＋`api_error: "usage_limit_reached"`＋`api_error_status: 429` | Claude 帳號撞到用量上限，不是任務問題：看 `usage_limit_action`，`reschedule` 排程重派（不寫修正單），`stop` 停下回報 |
| `cancelled` | Claude cancelled | |
| `failure` | 其他所有組合：Claude failure／skipped／不合法值、Verify 與 summary 同時失敗、Claude success 但 Verify／summary 為 skipped／cancelled／不合法值、參數個數不對 | 預設失敗 |

這**不是** fail-open：`verify_failed`／`summary_failed` 都不是 success，而且 Verify 失敗時該步驟本身仍失敗，整個 job 仍是紅燈。

**用量上限欄位（O-014）**：`claude-task-finished` 一律附 4 個欄位；`outcome` 不是 `usage_limit` 時為 `none`／`none`／`0`／`none`。`usage_limit_reset_at`：最後一個 `status: "rejected"` 的 `rate_limit_event` 的 `resetsAt` 轉成 UTC ISO（例：T-023 run 45545848159 → `2026-11-25T05:20:00Z`＝台北 13:20），沒有就是 `unknown`（`result` 文字只有時刻沒有日期，不解析）。`usage_limit_type`：同一事件的 `rateLimitType`（例 `five_hour`）或 `unknown`。`usage_limit_streak`／`usage_limit_action`：上一次同任務 run（artifact `run-task-outcome-<task>` 最新一筆，排除本 run；`gh api "repos/<repo>/actions/artifacts?name=run-task-outcome-<task>&per_page=100"`）不是 `usage_limit` 或沒有 → `1`／`reschedule`；是 `usage_limit` 且次數 n → `n+1`／`stop`；查詢失敗、過期、超過一頁、zip 或 JSON 壞掉 → `unknown`／`stop`。偵測：`run-task-usage-limit.sh detect`（呼叫 `tooling/usage-limit.mjs`；execution file 讀不到或不是 JSON → 步驟失敗、`outcome` 維持 `failure`）。每次 run 都上傳 `run-task-outcome-<task>`（通知 JSON，保留 30 天）。O-014 合併前的 run 沒有這個 artifact，下一次算第 1 次。測試：`run-task-usage-limit-test.sh`（假 `gh`）、`run-task-outcome-test.sh` 的 O-014 案例與突變。

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
| `pnpm db:test`（O-010：psql＋pgTAP 逐檔跑 `supabase/tests/*.sql`，寫 `.tmp/pgtap/*.tap`，成敗只看 TAP） | 設定已開放（`--allowedTools`、`.claude/settings.json`、SKILL 都列 `Bash(pnpm db:test*)`，`claude-permission-check` 靜態檢查通過）；Actions 上真的跑得起來**待下次真實 run-task 實測驗證** | workflow 在 Claude 之前裝 SHA 釘選的 `supabase/setup-cli`（CLI 3.2.0）並 `supabase start -x studio,imgproxy,logflare,vector,mailpit,realtime,postgres-meta,supavisor`（與 `db` job 同一組排除）；起不來時 Claude 步驟被略過、Notify 判失敗。O-010 本身的 run 45434212541 是在接線前跑的，沒有本機 Supabase，也依任務單沒有執行 `pnpm db:test`。Claude 仍不能直接呼叫 `supabase`／`psql`／`docker` |
| Write／Edit QA 擁有檔（`**/*.qa.test.ts`、`supabase/tests/qa_*.sql`；O-012；`docs/qa/mutants/*.json`；O-013） | 不能做（設定 deny）；真實被拒**待下次真實 run-task 實測驗證** | `.claude/settings.json` deny `Write(**/*.qa.test.ts)`、`Edit(**/*.qa.test.ts)`、`Write(./supabase/tests/qa_*.sql)`、`Edit(./supabase/tests/qa_*.sql)`、`Write(./docs/qa/mutants/*.json)`、`Edit(./docs/qa/mutants/*.json)`（O-013，突變 M49～M53）；`claude-permission-check` 以本表的路徑比對模型靜態檢查（一般 `*.test.ts`、其他 `.sql` 仍可寫，突變 M38～M41）。`Bash(git rm …)`／`git mv` 不受這條 deny 擋，由下一列的 post-check 抓 |
| run-task 內 Claude 的 commit 碰 QA 擁有檔（O-012） | 會被判 `post_check_failed`（box 測試已驗證；Actions 上**待下次真實 run-task 實測驗證**） | Claude 之前 `run-task-pre-head.sh` 記下任務單分支當時的 head（不存在用 origin/main）；post-check 以 `<pre_head>..HEAD` 的 commit 清單跑 `scope-check --all-non-qa`，不看前綴與作者。O-013：任務單從 `BASE_REF`（main）的 `docs/tasks` 取（`--tasks-dir`），不是分支樹 |
| run-task post-check 跑 QA 的突變（O-013） | `docs/qa/mutants/<基礎編號>.json` 存在就跑 `run-mutants`；存活或沒產出報告 → `post_check_failed`（box 測試已驗證；Actions 上**待下次真實 run-task 實測驗證**） | 基礎編號＝`tooling/task-file.mjs` 的 `baseTaskId`（`T-015-fix1`→`T-015`）；`fix0` 等無效編號 → post-check 失敗 |
| run-task 偵測 Claude 用量上限（O-014） | `outcome=usage_limit`＋`usage_limit_*`（box 測試已驗證；Actions 上**待下次真實撞到 429 時實測驗證**） | `Detect Claude usage limit` 步驟；`?name=` 查詢在 box 以真實 repo API 實測（存在的 artifact 回 1 筆、不存在的名稱回 `total_count: 0`），artifact zip 下載後的檔名為上傳檔的檔名 |
| post-check 用本 job 權杖從 GitHub 重抓 main（O-014） | 能做（box 以同一個 `git -c credential.helper= -c credential.helper=!gh auth git-credential fetch` 指令對真實 repo 實測成功；只重設 helper、不給 gh helper 時 `could not read Username`）；Actions 上以 `GH_TOKEN` 走 gh helper **待下次真實 run-task 實測驗證** | 失敗 → `main-fetch`、步驟 exit 1（`post_check_failed`），見 §6.2 |
| `gh`（含唯讀）、`curl`／`wget`／`sudo`、任意 `supabase` CLI、`docker` | 不能做（設定已列） | `--allowedTools` 未開放；不得當作任務單裡的驗證手段 |
| 開 PR、合併 PR、推 `main`、force push | 不能做 | pushguard + 任務單強制工作規則；本表不把這些寫成可做之事 |
| 已核准的 lockfile 更新：單獨一條 `pnpm install --no-frozen-lockfile`（先用 Edit 改 `package.json`，再跑這條） | 能做（已驗證：真實 run-task） | T-003 run [45314135320](https://github.com/hansheng08/english-coach/actions/runs/45314135320)（2026-11-24 10:40–10:51 Asia/Taipei；head `1743021f5f96051d5683c58fe558c820142b55f2`）execution artifact 出現一次、且僅一次，指令原文為 `pnpm install --no-frozen-lockfile`（tool-use step 18，`is_error=False`）。原始輸出：`Scope: all 4 workspace projects`／`✓ Lockfile passes supply-chain policies (verified 55s ago)`／`Packages: +9`／`Done in 1.6s using pnpm v12.21.0`。加上參數（例如 `… 2>&1`、`… zod`）仍不符精確規則（O-005 靜態檢查） |
| 未核准的新增／移除套件：`pnpm add *`、`pnpm remove *`、`pnpm install <套件>`、`pnpm i <套件>` | 不能做（設定）；真實 run-task 的被拒行為**未驗證** | 同一支檢查輸出：`pnpm add zod`／`pnpm remove zod` → `settings=ask actions=ask`（無人值守無法回答 ask），`pnpm install zod`／`pnpm i zod` → `settings=none actions=none`。O-005 前 `--allowedTools` 的 `Bash(pnpm install *)` 會放行 `pnpm install zod`（對 origin/main 跑同一支檢查得到 `claude-run-task.yml allows unapproved "pnpm install zod" via Bash(pnpm install *)`） |
| Read 真實環境檔（`.env`、`.env.local`、`.env.*.local`、`.env.dev*`、`.env.prod*`、`.env.stag*`、`.env.test*`、`.env.preview*`、`.env.secret*`、`.env.keys`、`.env.ci*`、備份檔 `.env.bak*` 等；根目錄與子資料夾） | 不能做（設定 deny）；真實 run-task 的比對行為**未驗證** | `.claude/settings.json` 對每種各列 `Read(./…)` 與 `Read(**/…)`；檢查輸出例如 `Read apps/web/.env.local: deny (Read(**/.env.local))`。未列名的變體（例如 `.env.foo`）不會被擋——repo 的 `.gitignore` 忽略 `.env*`，Actions 的 checkout 本來就沒有真實環境檔 |
| Write／Edit `supabase/functions/.env.example` | 能做（已驗證：真實 run-task） | T-003 run 45314135320 execution artifact：Write 一次（tool-use step 34）結果 `File created successfully at: /home/runner/work/english-coach/english-coach/supabase/functions/.env.example (file state is current in your context — no need to Read it back)`；Edit 兩次（steps 97、99）結果均為 `The file /home/runner/work/english-coach/english-coach/supabase/functions/.env.example has been updated successfully. (file state is current in your context — no need to Read it back)` |
| Read `.env.example`（根目錄、`apps/web/`、`supabase/functions/`） | 設定不擋（靜態規則檢查通過）；真實 run-task 的 Read **未實測** | T-003 run 45314135320 的 15 次 Read 的 `file_path` 都不含 `.env.example`（Write／Edit 成功後的回傳也寫「no need to Read it back」）。O-005 拿掉會連帶擋住 `.env.example` 的 `Read(./.env.*)`、`Read(**/.env.*)`；靜態檢查仍輸出 `Read .env.example: not denied`。根目錄與 `apps/web/.env.example` 的 Write／Edit／Read 在該次都未出現 |
| Verify 步驟用 `git fetch` 讀遠端分支 | 不能做（已在真實 run-task 失敗） | run 45323782247 Step 10：`remote: Invalid username or token. Password authentication is not supported for Git operations.`、`##[error]Process completed with exit code 128.`（App token 已在 Step 7 結束前撤銷）。O-007 改用 `gh api`＋`gh run list`（見 §1.5）；新做法在 Actions 上**待下次真實 `run-task` 實測驗證** |
| 寫入 `.claude/`（含 `.claude/skills/run-task/SKILL.md`） | 未驗證；預期不能做 | Claude Code 官方文件（permission modes → Protected paths）：寫入 `.claude/` 在 `default`／`acceptEdits` 會跳確認，無人值守的 run 無法回答。因此 O-004～O-006、O-009 的 `.claude/` 變更都由 SRE 在 box 上改 |
| `git add`／`git commit`／`git push -u origin <分支>` 從頭就分成三次單獨的 Bash 呼叫 | 能做（已驗證：真實 run-task） | O-009 run [45426570786](https://github.com/hansheng08/english-coach/actions/runs/45426570786)：三條指令各自一次 tool call，push 成功、`Detect denied-command resplit…` 步驟 success。同一次 run 唯一的被拒是 `git fetch origin && git checkout -b task/O-009 origin/main && ls tooling tooling/fixtures`（`ls` 被擋）；之後單獨送 `git checkout -b task/O-009 origin/main`，detect-resplit 只看 `git push` 與 `cat`／`grep`／`head`／`ls`／`sed`，所以沒判定。O-009 起 SKILL 第 2 步要求 fetch 與建分支也各自單獨送 |
| 指令被擋後拆開重送（例如複合 `git push` 被拒後再送單獨 `git push`） | 不能做；被偵測到則 `run_task_summary` 失敗 | `detect-resplit.mjs`；憲章 v5 §13 第 12 條。`git status` 等附帶允許指令不當作拆送 |

**權限規則怎麼驗（O-005、O-006）**：`.github/scripts/claude-permission-check.mjs` 讀真實的 `.claude/settings.json`、`claude-run-task.yml`、run-task SKILL，用「deny > ask > allow；`./x` 只比對根目錄、`**/x` 含根目錄的任何深度、`*` 不跨 `/`、`**` 跨 `/`；Bash 規則整條比對、`*` 為任意字元」的模型判斷；並檢查 `--max-turns` 必須是 200，以及 SKILL 含明確路徑 `git add` 與內建工具提醒。CI `ci-guard` job（O-015 前是 `pushguard` job）每次都跑它與 `claude-permission-check.test.mjs`（含把規則故意改壞、斷言 exit 1 的突變測試）。這是**對設定檔的靜態檢查**；Claude Code 執行時的實際比對器行為，除本節已引用的 T-003 run 45314135320 觀察外，其餘仍標未實測。

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
| PostgreSQL 17.12＋pgTAP 1.3.3、`psql` 17.12、`pg_prove` 3.37（O-010） | 能做（已驗證：2026-11-25 00:20 Asia/Taipei） | `psql --version` → `psql (PostgreSQL) 17.12 (Debian 17.12-0+deb13u1)`；`pg_prove --version` → `pg_prove 3.37`；`select extversion from pg_extension where extname='pgtap'` → `1.3.3`。叢集 `17 main`（埠 5432）平時是 `down`，要 `sudo -n pg_ctlcluster 17 main start` 才起來；pgTAP 裝在 `extensions` schema，`search_path` 要含 `extensions`（Supabase 預設如此），否則 `plan(integer) does not exist`、psql exit 3、db-test 判 `DB-PSQL`。**這不是 Supabase**：沒有 `auth` schema 與 Supabase 角色，`supabase/tests/*.sql` 的 RLS 測試不能在 box 上跑；box 只用來驗證 TAP 格式與 db-test 的判定 |
| `pnpm db:test` 判定（O-010） | 能做（已驗證：box 真實 PG17） | 自備兩個測試檔、`--db-url postgresql://postgres:postgres@127.0.0.1:5432/postgres`：全部 `ok` → `db-test: OK 1 file(s), 2 test(s)`、exit 0；其中一項 `not ok` → 同一個 psql 指令直接執行時 **exit 0**，db-test 輸出 `DB-FAIL: b_test.sql: (AC-T9-2) two`、exit 1 |
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

## 4. 任務單 lint、範圍檢查、AC 覆蓋檢查（O-008，憲章 v6 §13）

腳本在 `tooling/`（Claude Code 依 `docs/tasks/O-008.md` 寫）；接線在 `.github/`（SRE）。三支腳本只用 Node 內建模組，失敗一律 exit 1。

| 檢查 | 何時跑 | 失敗時 |
|---|---|---|
| `tooling/task-lint.mjs` | `claude-run-task.yml` 的 `Task lint` 步驟（在 Claude 之前）；`ci.yml` `taskcheck` job：推到 `main` 時只檢查該次新增或修改的 `docs/tasks/*.md` | run-task：Claude 不啟動（0 turn），Notify 送 `outcome=task_lint_failed`、`task_lint_outcome=failure`。main：`ci-ok` 紅叉 |
| `tooling/scope-check.mjs` | `taskcheck` job：`task/**` 的 push 與 PR；變更清單＝`git diff --name-only <base>...<head>` | `ci-ok` 紅叉 |
| `tooling/ac-coverage.mjs` | 同上，讀 Vitest JSON、TAP，以及（O-025）已通過的 Playwright JSON | `ci-ok` 紅叉 |

- 接線腳本：`.github/scripts/taskcheck.sh`（模式由事件決定；BEFORE_SHA 為空或全 0、git diff 失敗、Vitest JSON 缺漏或為空都 exit 1），測試 `.github/scripts/taskcheck-test.sh`（三支工具以 stub 代替，只驗接線與 exit code），在 `ci-guard` job 的 `pushguard tests` 步驟執行（O-015 前是 `pushguard` job）。
- O-025：ac-coverage 會讀 Playwright JSON；e2e 有跑時 `taskcheck` 會等 `e2e` 並下載該檔，缺檔或無效就失敗；e2e 略過時不要求該檔、不傳 `--playwright`；以 PR 的 `ci-ok` 為準。
- `ci-ok.mjs` 把 `taskcheck` 列為條件 job：`workflow_dispatch`、light 模式、沒改 `docs/tasks/` 的 docs 模式會略過它（O-009 前 `fix/**` 也略過），摘要列在「Skipped (not verified)」；`needs` 裡缺少 `taskcheck` 時判失敗。O-015 起，模式要求它跑而它被略過也判失敗（§6.3）。
- `run-task-outcome.sh` 新增 `--task-lint <outcome>`：`failure` → `task_lint_failed`；`skipped`／空值／大小寫不符 → `failure`；`cancelled` → `cancelled`。
- O-010 起：有 `supabase/config.toml` 時，`taskcheck` job 先起本機 Supabase（同 `db` job 的 CLI 與排除清單；main 的 push 不起），`taskcheck.sh` 執行 `pnpm db:test --tap-dir $RUNNER_TEMP/taskcheck-pgtap`，再把每個 `*.tap` 以 `--tap` 交給 ac-coverage，所以只有 pgTAP 測試的 AC 也算覆蓋。db-test 失敗照樣跑 ac-coverage／report-lint／摘要並判紅；一個 TAP 檔都沒有時直接 exit 1。這條路徑在 Actions 上的第一次實測是 O-010 PR 的 CI。`fix/**` 分支自 O-009 起也跑（見 §5）。
- 實測狀態：本機 box 已跑 `taskcheck-test.sh`、`run-task-outcome-test.sh`、`ci-ok.test.mjs`、`actionlint`；Actions 上的 `taskcheck` job 與 `Task lint` 步驟**待 O-008 PR 的 CI 與下一次真實 `run-task` 實測驗證**。

## 5. mutants.json、自動驗證摘要、報告 lint、G3 留言檢查（O-009，憲章 v6 §0.1、§5、§9）

腳本在 `tooling/`（Claude Code 依 `docs/tasks/O-009.md` 寫：`run-mutants.mjs`、`verify-summary.mjs`、`report-lint.mjs`、`comment-lint.mjs`，`scope-check` 支援 `fix/Q-xxx`）；接線、SKILL 改版在 `.github/`、`.claude/skills/`（SRE）。全部只用 Node 內建模組，失敗一律 exit 1。

| 檢查 | 何時跑 | 失敗時 |
|---|---|---|
| `run-mutants`（QA 的 `docs/qa/mutants/<基礎編號>.json`；O-013 起修正輪 `T-015-fix1` 也用 `T-015.json`） | `ci.yml` `taskcheck`：`task/**`、`fix/**` 的 push 與 PR，檔案存在才跑；不存在時 log 印「run-mutants: 未執行（沒有 …）」 | 存活（`MU-SURVIVED`）、解析失敗（`MU-RELATED`）、非預期失敗、基準失敗、錨點錯、還原比對不符都 exit 1 → `ci-ok` 紅叉。QA 判定是否退件；等價突變由 QA 從 JSON 移除 |
| `report-lint` | `taskcheck`：本分支新增或修改的 `docs/reports/*.md`；`claude-run-task.yml`「Report lint and automatic verification summary」步驟：`docs/reports/$TASK.md` | taskcheck：`ci-ok` 紅叉；run-task：Notify `outcome=post_check_failed` |
| `verify-summary`（自動驗證摘要：測試數、突變、權限被拒、變更檔案） | `taskcheck` 寫進 job summary；run-task 寫進 job summary 並附在 run-task 留言（PR 留言或 commit comment） | 輸入缺漏或結構錯 exit 1（taskcheck 紅叉／run-task `post_check_failed`） |
| `comment-lint` | 新 workflow `g3-comment-guard.yml`：`pull_request`（opened／edited／reopened／synchronize）、`issue_comment`、`pull_request_review`、`pull_request_review_comment`。標題以 `[G3]` 開頭時跑 comment-lint；不是 `[G3]` 開頭時在 head SHA 寫 success（description 恰好為 `not a [G3] PR; not checked`），不跑 comment-lint（O-021） | `[G3]` 違規或讀／寫失敗：寫 PR head 的 commit status `g3-comment-guard`＝failure，job exit 1。非 `[G3]` 寫入 success 失敗同樣 exit 1 |

- O-019：每筆突變改跑該目標檔的相關測試（Vitest import graph，`vitest related`）；0 個相關測試改跑完整套件；解析失敗為 `MU-RELATED`（fail-closed，不判 KILLED）；相關測試沒抓到仍為 `MU-SURVIVED`。baseline 仍先跑一次完整套件。`ci.yml` `taskcheck` 的 `timeout-minutes: 40` 不變。
- 接線腳本：`taskcheck.sh`（測試 `taskcheck-test.sh`，新增 fix 分支、report-lint、run-mutants、verify-summary 案例）、`run-task-post-check.sh`（測試 `run-task-post-check-test.sh`，用真的 report-lint／verify-summary）、`g3-comment-guard.sh`（測試 `g3-comment-guard-test.sh`，假 gh＋真的 comment-lint）、`run-task-outcome.sh` 新增 `--post-check`（`post_check_failed`、`post_check_outcome`）、`run-task-summary-step.sh` 附上自動驗證摘要。全部在 `ci-guard` job 的 `pushguard tests` 步驟執行（O-015 前是 `pushguard` job）。
- `g3-comment-guard` **不屬於 `ci-ok`**：留言事件不會重跑 `ci.yml`。結果是 commit status；要不要在 main 分支保護設成必要檢查，由 Hansheng 在 G3 決定。`issue_comment`／review 事件從預設分支執行 workflow（不 checkout PR 程式），所以要等 O-009 合併後才會對留言事件生效。
- O-015（retro §3.7 C8）：**light 模式的 push run 綠燈不算數**，以同一個 head 的 pull_request run 為準；push run 的彙總檢查名稱是 `ci-ok (push)`，不是必過的 `ci-ok`。**PR 有合併衝突時 GitHub 不會觸發 pull_request run**，這段期間只剩 light 的 push run，它的綠燈不能當成「CI 過了」；解完衝突後的 push 才會觸發 PR run。**docs 模式（純文件推 main）的 `check` 是「未驗證」**，`ci-ok (push)` 摘要會寫出來；以下一個 pull_request run 為準。詳見 §6.3。
- 判斷依據只有留言開頭文字（所有留言作者都是 `hansheng08`）。已知限制：開頭不是 `TechLead Review` 的留言不會被判；QA 寫「不在本機重跑 pnpm check」也會判紅（寧可誤報）；QA 驗收留言請只引用 CI run。
- 權杖：`g3-comment-guard.yml` 用 `GITHUB_TOKEN`（`contents: read`、`pull-requests: read`、`issues: read`、`statuses: write`），不新增 secret。
- run-task SKILL（O-009 改版）：第 2 步 fetch 與建分支各自單獨送；第 5 步報告格式與 ≤ 80 行（report-lint）；第 6 步 `git add`、`git commit`、`git push -u origin <分支>` 從頭就三次單獨送；第 9 步改為憲章 v6 §13 第 9 條。`claude-permission-check.mjs` 檢查這些字句（突變測試 M26～M28）。
- 實測狀態：box 上已跑 `taskcheck-test.sh`、`run-task-post-check-test.sh`、`g3-comment-guard-test.sh`、`run-task-outcome-test.sh`、`run-task-summary-step-test.sh`、`node --test`、`claude-permission-check`、`fail-open-lint`、`actionlint`、`pnpm check`；`run-mutants` 在 box 以真的 Vitest 跑過一次（`tooling/task-lint.mjs` 的兩筆突變：一筆被抓、一筆存活，目標檔 SHA-256 前後相同）；`comment-lint` 對 PR #21、#27 的真實留言都判出 `CM-TECHLEAD` 與 `CM-QA-RERUN`。Actions 上的 `taskcheck` 新步驟以 O-009 PR 的 CI 為準；run-task 的「Report lint and automatic verification summary」步驟、`post_check_failed` 通知，以及 `g3-comment-guard` 對留言事件的觸發與 commit status，**待下次真實 run-task 實測驗證**（後者要等 O-009 合併）。

## 6. QA 擁有檔（O-012，憲章 v6 §5「QA 驗收規則」）
- 命名（QA 同意）：Vitest `**/*.qa.test.ts`、pgTAP `supabase/tests/qa_*.sql`。清單在 `tooling/qa-owner.mjs` 的 `QA_GLOBS`。
- 執行：`vitest.config.ts` 的 `test.include` 含 `**/*.qa.test.ts`（任何目錄）；`pnpm db:test` 預設逐檔跑 `supabase/tests/*.sql`，已含 `qa_*.sql`。`tooling/o012.test.mjs` 以故意失敗的樣本證明兩者真的會執行。
- 範圍：`task/**`、`fix/Q-*` 分支上 QA 擁有檔一律允許（在 `SC-DENY`／`SC-OUT` 之前），改由擁有者檢查把關。
- 擁有者檢查（scope-check `--commits`）：`taskcheck.sh` 以 `git log --format=%x1e%H%x1f%ae%x1f%ce%x1f%s --name-status -M --diff-merges=dense-combined <BASE>..<HEAD>` 產生 commit 清單。QA commit ＝ 主旨以 `[QA] ` 開頭，且作者與提交者信箱都不是 bot（`BOT_EMAILS` 或含 `[bot]`）。非 QA commit 對 QA 擁有檔的任何新增、修改、刪除、改名、合併中的變動 → `SC-QA-OWNER`；變更含 QA 擁有檔卻沒有 commit 清單或清單沒碰到 → `SC-QA-NOLOG`。
- 為什麼用前綴：main 上 Claude 的 commit 作者是 `claude[bot]`，但 QA、SRE、Architect、PM 與部分 TechLead 都是同一個 `GrokBot`（共用 hansheng08），其他 TechLead 是 `hansheng08`；作者只分得出「是不是 Claude」。
- 已知限制：前綴是自己宣告的，box 上任何 Bot 都能寫 `[QA]`；Claude 有 `Bash(git *)`，理論上能改作者與前綴（`git config` 在 deny，但 `git commit --author` 不在）。補強：run-task 內 Claude 的 commit 一律 `--all-non-qa`（§3.1）。合併 commit 只看與所有父節點都不同的檔案（dense-combined）。
- run-task 接線：`Record branch head before Claude`（`run-task-pre-head.sh`，輸出 `branch`、`pre_head`）→ post-check 帶 `PRE_HEAD`、`BRANCH` 跑 `scope-check --all-non-qa`（同時套用範圍規則）；失敗算 `post_check_failed`。Claude 端另有 settings deny 與 SKILL 第 3 步的規則。
- E2E `**/*.qa.spec.ts`：延後。repo 目前沒有 Playwright 設定（`ci.yml` 的 `e2e` job 一律略過）；T-018 加入後另開小 O 單。
- 實測狀態：box 上已跑 `taskcheck-test.sh`（含真的 scope-check：Claude commit 改 QA 檔判紅、`[QA]` 判綠、`[QA]` 前綴但作者 `claude[bot]` 判紅）、`run-task-post-check-test.sh`、`run-task-pre-head-test.sh`、`claude-permission-check` 與突變 M38～M48、`fail-open-lint`、`actionlint`、`pnpm check`。Actions 上的 `taskcheck` 以 O-012 PR 的 CI 為準；pre-head 步驟、post-check 的 `--all-non-qa`、settings 的 Write／Edit deny 在真實 Claude 上的效果，**待下次真實 run-task 實測驗證**。

### 6.1 O-013：修正輪、突變歸 QA、失敗原因、gitleaks
- 事件（run 45526553673，T-015-fix1）：post-check 印 `scope-check: FAIL docs/reports/T-015-fix1.md:1: SC-OUT`，**不是** `SC-QA-OWNER`。原因：scope-check 讀分支樹的 `docs/tasks`，而 `T-015-fix1.md` 只在 main（748b8aa）。O-012 沒有修正輪測試，通知又一律寫 `scope-qa-owner`，造成誤判。
- 任務單來源：`taskcheck.sh` 與 `run-task-post-check.sh` 都用 `git archive <BASE> docs/tasks` 取 main 的任務單，傳 `--tasks-dir` 給 scope-check（taskcheck 另傳給 ac-coverage）。BASE 沒有 `docs/tasks/*.md` → 失敗（fail-closed）。
- `docs/qa/mutants/*.json` 是 QA 擁有檔（`QA_GLOBS`）：只有 `[QA]` commit 能改；run-task 內一律 `SC-QA-OWNER`。Claude 端另有 settings deny 與 SKILL 第 3 步。只有任務本身、基礎編號、分支編號的 mutants 檔在範圍內，其他編號仍 `SC-OUT`。
- post-check 失敗原因（post-check 步驟 log 的 `run-task-post-check: FAILED: <原因>`；`post_check_outcome` 仍是 `failure`）：`pre-head-invalid`、`tasks-from-main`、`scope-check:<規則，逗號分隔>`（例如 `scope-check:SC-OUT`、`scope-check:SC-QA-OWNER`）、`run-mutants`（有存活或錯誤）、`run-mutants-report`（沒產出報告），以及原有的 `report-lint`、`verify-summary`。
- gitleaks：QA commit 1cf0fda 的測試假金鑰（`gemini.qa.test.ts` 第 13 行）讓 `secrets` job 掃全部 ref 時判紅。`.gitleaksignore` 只加這一個指紋 `1cf0fdab9bc5fd0519c175cf32126bde00533950:supabase/functions/_shared/providers/gemini/gemini.qa.test.ts:generic-api-key:13`；SRE 已確認值是明顯的測試值（未印出）。不改寫歷史。之後 QA 測試的假金鑰請用不會被規則抓到的寫法，不要再加指紋。
- 測試用的假金鑰一律用明顯低熵的字串（例如重複字元 `AAAAAAAAAAAAAAAAAAAA`、`test-key-xxxx`），不要用看起來像真金鑰的亂數，以免 gitleaks 判紅；不再新增 `.gitleaksignore` 指紋（O-014）。
- 實測狀態：box 上已跑 `taskcheck-test.sh`（修正輪案例 T-953）、`run-task-post-check-test.sh`（事件拓樸 T-971／T-971-fix1：通過、存活、沒報告、分支樹任務單重現 `SC-OUT`、Claude 改 QA 檔、偽造 `[QA]` 改 mutants、main 無任務單、`fix0`）、`claude-permission-check` 與突變 M47、M49～M54。Actions 上 post-check 的 mutants 執行與 `--tasks-dir`，**待下次真實 run-task 實測驗證**。

### 6.2 O-014：post-check 範圍排除 main 上的 commit

- 事故：T-009 run 45575460457 `post_check_failed`，`scope-check: FAIL docs/tasks/O-014.md:2: SC-OUT`。`task/T-009` 當時不存在，pre-head 記 `origin/main` 20c206c（16:20:55 台北時間 checkout）；SRE 在 16:21:36 把 755c7d4（O-014 任務單）推上 main；Claude 依 SKILL 第 2 步單獨執行 `git fetch origin`、`git switch -c task/T-009 origin/main`（artifact 的 Bash 指令只有這兩條加 add／commit／push，沒有 merge、rebase、pull），分支直接從 755c7d4 長出來，`PRE_HEAD..HEAD` 就把那個 main commit 算成本次 run 的變更。
- 修正：post-check 在 Claude 之後用本 job 權杖、明確 URL 從 GitHub 抓 main 到 `refs/run-task/fresh-main`，本次 run 的 commit ＝ `git rev-list <PRE_HEAD>..HEAD --not <fresh main>`；變更清單由這些 commit 的 name-status 路徑組成（含改名來源），不再用 `git diff PRE_HEAD HEAD`。`--all-non-qa`、QA 擁有檔、`--tasks-dir` 不變。fresh main 同時是預設 `BASE_REF`（任務單來源與摘要的變更檔案）。
- 為什麼不用 `merge-base(HEAD, origin/main)..HEAD`：那會丟掉 `PRE_HEAD` 下界，分支上 QA 先前的 `[QA]` commit（碰 QA 擁有檔）會被 `--all-non-qa` 當成 Claude 的而誤判 `SC-QA-OWNER`；而且本機 `refs/remotes/origin/main` 是 Claude 可以 `git fetch`／`update-ref` 移動的 ref，用它排除等於讓 Claude 決定檢查範圍。保留下界、只減去「GitHub 上的 main 已有的 commit」兩邊都顧到，也涵蓋分支從新 main 長出、fast-forward、merge main 三種情況。
- 失敗原因：`main-fetch`（抓不到 main、`GITHUB_REPOSITORY` 不合法）→ 步驟 exit 1，不跑 scope-check、不印 OK。
- 測試（`run-task-post-check-test.sh`）：(a) 執行中被帶進來的 main commit 不算 → exit 0、範圍 1 個 commit；(a2) 既有分支 `merge --no-ff main` → exit 0；拿掉排除的突變讓 (a)、(a2) 都變成 `SC-OUT`；(b) Claude 自己改範圍外（同一個 main 也改過的檔）→ `SC-OUT`；(d) Claude 把本機 `origin/main` 移到 HEAD 仍 `SC-OUT`；(c) 抓 main 失敗 → `main-fetch` exit 1；排除 main 後 Claude 碰 QA 檔仍 `SC-QA-OWNER`。

### 6.3 O-015：ci-guard 與三種模式（降低 Actions 用量）

- 結構：原本每次都跑的 `detect`、`actionlint`、`pushguard`、`secrets` 併成一個 job `ci-guard`（GitHub 每個 job 各自進位到整分鐘）。`ci-guard` 的 job 層權限是 `contents: read`、`pull-requests: read`（job 層會整個取代 workflow 層）。`ci-ok` 的 job id、語意不變；`g3-comment-guard` 不動。
- 安全步驟 `actionlint`、`pushguard tests`、`gitleaks (full history)`、`secret scanner self-test` 不帶模式條件，只有 `if: ${{ !cancelled() }}`：三種模式都跑，前一步失敗也會跑完、各自報錯。
- 模式（`ci-guard` 的「Decide CI mode」步驟：`.github/scripts/ci-guard-mode.sh` → `tooling/ci-mode.mjs`）：
  - `full`：PR、手動觸發、沒有 PR 的 task／fix push、非純文件的 main push、任何判斷失敗。照舊跑全部。
  - `docs`：推到 `main` 且只改文件（`docs/**/*.md`，不含 `docs/poc/`、`docs/qa/`；根目錄 `*.md`）。略過 `check`、`bundle`、`e2e`；改到 `docs/tasks/` 時仍跑 `taskcheck`（task-lint）。
  - `light`：推到 `task/**`、`fix/**` 且已有開著、目標 `main` 的 PR（`gh api repos/<repo>/pulls?state=open&base=main&head=<owner>:<branch>`）。只跑 `ci-guard`；重 job 以同一個 head 的 pull_request run 為準。查詢失敗、回應不對、`gh` 非 0（即使有輸出）→ `full`。
- 為什麼不用 workflow 層的 `paths-ignore`：整個 workflow 不觸發，`ci-ok` 根本不出現，設成必過後只改文件的 PR 會一直等待；gitleaks、pushguard 也不會跑。
- 判斷文件的規則（retro §3.7）：
  - C1：變更清單一律 `git diff --no-renames --name-only "$BEFORE_SHA" "$SHA"`；`git mv apps/x.ts docs/x.md` 會同時列出 `apps/x.ts` → full。
  - C2：`docs/**` 底下非 `.md` 的變更一律當成被引用 → full。
  - C3：`.github/scripts/ci-referenced.mjs` 在 `$SHA` 的樹（不是工作目錄）裡，搜尋所有非文件檔有沒有寫到該文件的路徑字面；被刪除的文件也查。`--ref` 傳 `github.ref_name`（短名）。BEFORE 為空、全 0、不在 clone 裡、diff 或搜尋失敗 → full。
  - 已知殘留：用字串拼接或讀資料夾的程式抓不到；目前唯一讀資料夾的是 `taskcheck` 的 `docs/tasks`，docs 模式改到 `docs/tasks/` 時仍會跑 `taskcheck`。最壞情況是延後到下一個 PR run（一定是 full）才發現。
- 必過檢查（C4）：`ci-ok` 的顯示名稱是 `${{ github.event_name == 'pull_request' && 'ci-ok' || format('ci-ok ({0})', github.event_name) }}`。只有 pull_request run 會產生名為 `ci-ok` 的 check run；push run 是 `ci-ok (push)`，手動是 `ci-ok (workflow_dispatch)`，不會被 main 分支保護的 `ci-ok` 讀到（略過的同名檢查也算通過，所以 push run 連略過的 `ci-ok` 都不能有）。
- `ci-ok.mjs`（C5）：`ci-guard` 必須 success；依模式該跑的 job 必須 success，不能是 skipped：full 且 `has_node` → `check`；full 且 `has_web` → `bundle`；full PR 且 `has_supabase` → `db`；full PR 且 `has_e2e` → `e2e`；`has_node` 且（full 的 main／task／fix push 或 task／fix 的 PR，或 docs 且改到 `docs/tasks/`）→ `taskcheck`。模式不是 full／docs／light、PR 或手動觸發卻不是 full、docs 不在 main、light 不在 task／fix 或沒有 PR 編號 → 失敗。
- 測試：`ci-guard-mode-test.sh`（真的 git repo＋假 `gh`：28 個案例、5 個突變）、`ci-ok.test.mjs`（C5 表、context 檢查、9 個突變）、`ci-workflow-check.mjs`＋`.test.mjs`（C4 名稱跨 workflow 依事件唯一、C6、C7、W-5、單大括號 `${ … }`；17 個突變）。全部在 `ci-guard` 的 `pushguard tests` 步驟跑。

### 6.4 O-016：CI 成本 lint、PR 說明「Actions 分鐘數影響」、`--no-renames`

- CI 成本 lint 併在 `.github/scripts/ci-workflow-check.mjs`（`ci-guard` 的 `pushguard tests` 步驟跑），任何一條不符就讓 `ci-guard` 失敗：
  - CL-1：每個 workflow 的每個 job 都有 `timeout-minutes`，值是 1～60 的整數（GitHub 預設 360 分鐘；卡住的 job 會整段計費）。
  - CL-2：每個 workflow 都有頂層 `concurrency`（區塊寫法，含 `group:`）。
  - CL-3：每個 workflow 的 job 數 ≤ `.github/ci-budget.json` 的 `max_jobs`；每個 workflow 都要列，列了不存在的 workflow（例如刪檔後沒同步）也算失敗。要加 job 就要在同一個 PR 改 budget，改動會出現在 diff 裡。
- 目前的值：`claude.yml` 30 分（concurrency 依 issue／PR 編號＋「有沒有 @claude」分組、不取消；沒有 @claude 的事件 job 會略過，分到 `-false` 組，不會排在真的 Claude run 後面或把它換掉）、`notify-grok.yml` 5 分（依 PR 編號、不取消）、`poc-spike.yml` 補 concurrency（依 `inputs.ref`、不取消）。原本的 Claude Code Review workflow（PR 自動審查，憲章 v6 已取消 Review；一直是 `disabled_manually`）在 O-017 刪除（Hansheng 2026-11-25 22:41 核准，G3 合併後生效），`ci-budget.json` 同步移除。
- PR 說明檢查：`.github/pull_request_template.md` 在「風險」後有 `## Actions 分鐘數影響`。`ci.yml` 的 `ci-guard` 在 `pull_request` 事件跑「PR description: Actions 分鐘數影響」步驟（`.github/scripts/pr-body-check.sh`）：`git diff --no-renames --name-only <base>...<head>` 取變更檔，`gh api repos/<repo>/pulls/<n> --jq '.body // ""'` 取**目前**的 PR 說明（不用事件 payload），交給 `tooling/pr-body-lint.mjs`。改到 `.github/workflows/**`（含把 workflow 搬出去）時，該節必須有「數字＋分鐘」或「無影響：理由」；缺節 `PB-MISSING`、佔位文字 `PB-PLACEHOLDER`、空的 `PB-EMPTY`、沒有數字 `PB-VAGUE`。`gh` 失敗也判失敗。
- `ci.yml` 不在 `edited` 觸發（每改一次說明就重跑整套 CI 太貴；`ci-workflow-check` 會擋 `pull_request` 加 `types:`）。**改完說明後要推新 commit，或由 Hansheng 在 GitHub 按重跑**（box 的權杖不能 rerun）。
- `--no-renames`（retro M5）：`taskcheck.sh` 的三處 `git diff`（main push 的 task-lint 清單、scope-check 的變更清單、report-lint 清單）與 `run-task-post-check.sh` 的摘要變更清單。改名會同時列出舊路徑（刪除）與新路徑：把範圍外檔案 `git mv` 進範圍 → `SC-OUT`；改名的任務單、報告仍是 `A`，不會被 `--diff-filter=AM` 漏掉。post-check 的 scope-check 從 O-014 起就讀 `git log --name-status -M` 的每個路徑，不受影響（只加回歸測試）。`ci-workflow-check` 也檢查這兩支腳本的每個 `git diff` 都有 `--no-renames`，且呼叫數符合登記（新增一處要同步登記）。
- 測試：`ci-workflow-check.test.mjs`（CL-M1～CL-M13、NR-M1～NR-M5、PB-W1～PB-W5）、`pr-body-check-test.sh`（真的 `pr-body-lint.mjs`＋假 `gh`：13 個案例、2 個突變）、`taskcheck-test.sh`（改名任務單、改名報告、`git mv` 進範圍 → `SC-OUT`；突變 NR-T1～NR-T3）、`run-task-post-check-test.sh`（`git mv` 進範圍 → `SC-OUT`＋摘要列出舊路徑；突變 NR-P1）。

### 6.5 O-016：每日 Actions 用量（`tooling/actions-usage.mjs`，routine 用）

- 不接進任何 workflow（避免 CI 再花分鐘）；在 box 由幕僚長的 routine 執行。只呼叫 `gh api`（Actions 的 runs／jobs API），box 的 `gh` 登入權杖即可（要能讀 Actions；check-runs 與 billing API 對這個權杖是 403，所以不用）。測試用 `GH_BIN` 指向假 gh。
- 指令（台北時間每天早上跑前一天）：`node tooling/actions-usage.mjs --repo hansheng08/english-coach --date <前一天 YYYY-MM-DD> --included 2000`。`--included` 必填：免費方案 2000，升級 Pro 後改 3000。其他選項：`--cycle-start`（預設 `--date` 所在月份 1 日）、`--tz-offset`（預設 `+08:00`）、`--daily-warn`（100）、`--daily-stop`（200）、`--month-warn-pct`（75）、`--month-stop-pct`（90）。
- 算法：每個不是 skipped 的 completed job 以 ⌈(completed_at − started_at) ÷ 60 秒⌉ 加總（GitHub 對每個 job 各自進位）。completed 且 `conclusion: skipped` 的 job 一律 0 分鐘、不看時間（GitHub 常回顛倒 1～10 秒的時間）；沒有合法 `started_at` 的 skipped job 不計入任何數字；其他 job 的時間顛倒或不合法仍是 `DATA` 失敗。這是**估計值**，不是帳單；非 ubuntu runner 直接失敗（倍率未知）。
- 輸出：一行 JSON（`schema: "actions-usage/v1"`）：`day`（當天計費分鐘、各 workflow 明細）、`cycle`（週期累計、日平均）、`allowance`（`used_minutes`、`remaining_minutes`、`used_pct`、`days_of_allowance_left`、`projected_cycle_minutes`）、`thresholds`、`status`（`ok`／`warn`／`stop`）、`reasons`（`daily-stop`、`month-stop`、`exhausted`、`daily-warn`、`month-warn`、`projected-over`）。
- exit code：0 ＝ stdout 恰為一行 JSON；1 ＝ 失敗，stdout 是空的，stderr 是 `usage: <RULE> …`（`API`、`DATA`、`COUNT`、`RUNNER`、`USAGE`）。**exit 1 時 routine 要回報「用量查詢失敗」與 stderr，不能當成 0 分鐘或 ok。**
- 重試（O-017）：每個 `gh api` 呼叫最多試 3 次，第 2、3 次前各等 1 秒、2 秒（最壞情況每個呼叫多等 3 秒）。會重試的：gh 的 stderr 最後一個 `(HTTP nnn)` 是 5xx，或 exit 1 而 stderr 沒有 `(HTTP nnn)`（連線中斷之類的暫時性錯誤）。不重試：4xx（含 403、404、429）、exit 1 以外的 exit code、gh 執行不起來、exit 0 但輸出不是 JSON。重試過程不輸出任何東西；3 次都失敗仍是 exit 1、stdout 空、`usage: API … 失敗（已試 3 次，最後 exit …，狀態碼 …）`。環境變數 `ACTIONS_USAGE_RETRY_BASE_MS` 只給測試用（設 0 不等待），routine 不要設。API 每小時 5,000 次的上限仍要留意（每個 run 各查一次 jobs，重試也算次數）。
- 實測紀錄（box，`task/O-017` 的 b6bd0e7；`GH_BIN` 指向只記錄 exit code 的 gh 包裝，用來看有沒有重試）：
  - O-016 時（無重試，2026-11-25 22:40～23:10 台北時間）：3 次都因某一個 run 的 jobs 查詢失敗（其中一個手動重查是 `HTTP 502 Server Error`，事後重查都正常）。
  - O-017，2026-11-25 23:32 台北時間同時開始兩次：3 天範圍（`--date 2026-11-24 --cycle-start 2026-11-24`）exit 1、801 秒、351 次 gh 呼叫、0 次失敗（沒有觸發重試）；週期起點 11/1（`--date 2026-11-24`）exit 1、744 秒、393 次 gh 呼叫、0 次失敗。兩次 stderr 都是 `usage: DATA job 的 completed_at 早於 started_at`，stdout 都是空的。
  - 原因：GitHub 對**被略過（`conclusion: skipped`）的 job** 常回 `started_at` 比 `completed_at` 晚 1～10 秒。另外逐一掃 11/23～11/25 的 jobs，這樣的 job 至少 111 個，全部是 skipped（docs／light 模式略過的 `check`、`bundle`、`db`、`e2e`，以及沒有 @claude 的 `claude`）。腳本依 O-016 規格把它判成資料錯誤，所以當時每天都會 exit 1。這要改規則（skipped 的 job 一律 0 分鐘、不看時間），由 O-018 處理。
- 實測紀錄（box，`task/O-018` 的 5028c6c；`GH_BIN` 指向只記錄 exit code 的 gh 包裝，用來看有沒有重試）：
  - O-018，2026-11-26 01:02:55～01:18:37 台北時間：週期起點 11/1（`node tooling/actions-usage.mjs --repo hansheng08/english-coach --date 2026-11-25 --included 3000`）exit 0、942 秒、413 次 gh 呼叫、1 次失敗（`net/http: TLS handshake timeout`，有觸發重試且成功）。stderr 空；stdout 一行 JSON，`status` 是 `stop`（`reasons` 為 `daily-stop`），當天 `day.billed_minutes` 889，週期 `cycle.billed_minutes` 2001。

### 6.6 O-023：`bundle` 的 mock 資料模式守衛

- `bundle` job（`full` 且 `has_web=true` 才跑）在 `pnpm build` 之前跑 `node tooling/data-mode-guard.mjs`，守衛與建置步驟都設 `VITE_DATA_MODE=mock`，不設任何 `VITE_SUPABASE_*`；`has_web=false` 時仍略過。`timeout-minutes` 仍為 10，不新增 job。

### 6.7 O-026：重跑必須接在既有任務分支上

- pre-head 之後、Claude 之前：若遠端已有任務單指定的 `task/*`／`fix/*`，以 `fetch-depth: 0`、`persist-credentials: false` 檢出該 `PRE_HEAD`，並把 Task lint 用過的 `docs/tasks/<TASK>.md`（dispatch 的 main 版本）放回工作區，不 merge main。`verify-push.sh` 要求遠端 tip＝這次 local HEAD 且 ≠ `PRE_HEAD`，且該 SHA 已觸發 push CI（進行中或 failure 也算；沒有 run 則失敗）；不得 `git fetch`。post-check 失敗時 outcome 為 `post_check_failed`（留言失敗不得覆蓋）。commit comment 只留在已推送到遠端的 SHA。
