# RUNBOOK

- 版本：v0.5（2026-11-24）
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

O-002 合併進 main 之後，Claude 推 `task/*` 或 `fix/*` 時，應出現 `event=push` 的 `ci.yml` run，而且 `headSha` 等於該分支先端。若當時已經有 PR，也應出現 `pull_request` 的 synchronize run。workflow 裡的「Verify push triggered CI」步驟會查這件事；若約 3 分鐘內沒有對應的 push run，該步驟會失敗，方便回報幕僚長。O-003 起：通知幕僚長的 `outcome` 不再只看 `steps.claude.outcome`；若「Verify push triggered CI」失敗，webhook 的 `outcome` 會是 `failure`（以前仍會回 success）。

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
   - 用本機 Auth 註冊測試使用者取得的 access token → 200 `{ "ok": true }`
5. ADR-009 (1)：serve 日誌不得出現 `@english-coach/contracts` 解析失敗。
6. ADR-009 (2)：**不要**跑 `supabase functions deploy`（CLI 3.2.0 為 Remote only，且沒有 `--dry-run`）。本機若找不到 eszip，以 serve 成功載入 contracts 作為本機等效，並標 UNCONFIRMED。如何結案見 §2.4；T-018 的前端 Vite／`bundle` job **不算**。
7. 無論成功失敗，最後會 `supabase stop`（腳本 `trap`）。

timeout 為 20 分鐘（O-001 原為 15，因新增 serve／health／打包檢查而延長）。

### 2.3 失敗時怎麼看

- **job 被略過（skipped）**：不是 PR，或兩個 `config.toml` 都不存在。O-003 之後探針應讓 `has_supabase=true`。
- **`docker info` 或 `supabase start` 失敗**：映像拉取逾時、或排除的服務名稱拼錯。對照 `supabase start --help` 的 `-x` 清單。
- **health 一直連不上**：看該步驟上傳／印出的 `functions-serve.log` 末段；常見是函式編譯失敗或 contracts 路徑不對。
- **無 JWT 不是 401、或 ANON_KEY 變成 200**：閘道 `verify_jwt` 可能仍開著，或函式沒做 `requireUser`。確認 `config.toml` 有 `[functions.api] verify_jwt = false`，且 serve 有 `--no-verify-jwt`。
- **使用者 JWT 不是 200**：本機 signup 是否回了 `access_token`（email 確認是否關閉）；或 CLI 只注入舊金鑰名稱（`SUPABASE_ANON_KEY`），探針會在 200 路徑回 500 並讓 job 失敗——這時依 ADR-010 **停下回報 Architect**，不要改產品程式去讀舊名稱。
- **ADR-009 (1) 失敗**：`deno.json` 的 `imports` 是否指向 `packages/contracts/src/index.ts`。
- 不要在 CI 對已連結的遠端專案跑 `functions deploy`（需要新的 `SUPABASE_ACCESS_TOKEN`，必須先問幕僚長）。

本文件不記載任何 token 或金鑰的值。


### 2.4 ADR-009 在 CLI 3.2.0 的結果（O-003 實測）

**ADR-009 (1) 已通過。** CLI 3.2.0 預設不會讀 `supabase/functions/deno.json`，必須在探針 `config.toml` 的 `[functions.api]` 寫 `import_map = "./functions/deno.json"`（路徑相對 `supabase/`）。`functions serve` 啟動時會刪掉 `supabase start` 起的 edge-runtime 再起一個新容器；要等日誌出現 `Serving functions on` 之後，再對**新容器**做 `docker inspect`。修正後的 PR-event run：

- https://github.com/hansheng08/english-coach/actions/runs/45213610756
- https://github.com/hansheng08/english-coach/actions/runs/45214375918（2026-11-24 00:15–00:17 台北時間）

都有 `SERVE_READY`、`MOUNT_OK: packages/contracts appears in the container mount list.`、serve 日誌無 contracts 解析錯誤，且 health 有跑到使用 contracts 的探針（無 JWT／ANON_KEY → 401，使用者 JWT → 200）。

修正前（僅作對照）：在尚未設定 `import_map` 時，即使主機上 `packages/contracts` 已與 `supabase/` 同層，`functions serve` 仍會 `Module not found "file://…/packages/contracts/src/index.ts"`，health 為 HTTP 503 `BOOT_ERROR`。那不是目前狀態。備案（搬到 `supabase/functions/_shared/`，套件名稱不變）只在 (1) 再次失敗、或下面的 (2) 被推翻時才啟動。

**ADR-009 (2) 仍為 UNCONFIRMED。** CLI 3.2.0 的 `functions deploy` 是 remote only、沒有 `--dry-run`，CI 不得部署。目前找不到本機 eszip，腳本以 serve 成功 import／掛載 contracts 作為本機等效，並在日誌標明尚未直接證明「部署包」含 contracts。

要關閉 UNCONFIRMED，需等到下列之一：未來 CLI 提供本機打包或 dry-run，且產物能證明含 contracts；或 Hansheng 核准的 staging／G4 部署能直接證明部署包含 contracts。**T-018 的前端 Vite／`apps/web`／`bundle` job 不算**，不能用來結案 (2)。在此之前 T-003 可繼續做 ADR-009 (3) 與產品骨架。


## 3. 執行環境能力表（寫任務單前先對照）

本表說明模式 C 各執行環境**現在實際做得到／做不到的事**。表上沒列、或標「未驗證」的，不得寫成任務單前提（憲章 v5 §4）。下列「已驗證」格子都附觀察證據；未實測的能力不寫成「能做」。

### 3.1 Actions 上的 Claude Code（`claude-run-task.yml`）

| 項目 | 狀態 | 依據 |
|---|---|---|
| 在 `task/`、`fix/`、`poc/` 分支工作；`git add`／`commit`；單獨的 `git push -u origin <目前同名分支>` | 能做（已驗證） | T-012 等任務把分支推上 GitHub 並觸發 `ci.yml` `push` run（例如 run 45205560119 的後續乾淨 `git push` 曾成功；複合 `git push … 2>&1` 則被 pushguard 擋下） |
| `pnpm install --frozen-lockfile`、`pnpm check`／`typecheck`／`lint`／`arch`／`test`／`e2e` | 能做（設定已列） | `claude_args --allowedTools` 白名單（見 workflow）。個別指令是否每次成功視任務而定 |
| 檔案用 Read／Write／Edit／Glob／Grep | 能做（設定已列） | 同上 `--allowedTools` |
| 改／推 `.github/workflows/` | 不能做（政策）；**一次被拒的推送未在本環境實測，標未驗證** | 憲章 v5 §5：Claude Code 的權杖改不了 workflow，改由 SRE 在 box 以 O-xxx 開 [G3] PR |
| Bash `cat`／`grep`／`head`／`ls`／`sed`（含複合指令裡的同名命令） | 不能做 | `.claude/settings.json` deny 與 pushguard；T-012 曾用 `cd …; cat …; grep … \| head; ls; sed`（當時尚未 deny） |
| `gh`（含唯讀）、`curl`／`wget`／`sudo`、任意 `supabase` CLI、`docker` | 不能做（設定已列） | `--allowedTools` 未開放；不得當作任務單裡的驗證手段 |
| 開 PR、合併 PR、推 `main`、force push | 不能做 | pushguard + 任務單強制工作規則；本表不把這些寫成可做之事 |
| 新增套件（改 lockfile） | 須先核准；**一次被拒的實測未做，標未驗證** | 任務單／`--frozen-lockfile` 限制 |
| 指令被擋後拆開重送（例如複合 `git push` 被拒後再送單獨 `git push`） | 不能做；被偵測到則 `run_task_summary` 失敗 | `detect-resplit.mjs`；憲章 v5 §13 第 12 條。`git status` 等附帶允許指令不當作拆送 |

### 3.2 box 上的 SRE（共享 Linux；2026-11-24 08:09 Asia/Taipei 實測）

**沒有 Docker、沒有本機 Supabase CLI。** 本機實測原始輸出：

```
MISSING docker (command not found)
docker info: docker: command not found（/var/run/docker.sock 亦不存在）
MISSING supabase (command not found)
FOUND node     /usr/local/bin/node        v24.22.1
FOUND npm      /usr/local/bin/npm         11.21.1
FOUND npx      /usr/local/bin/npx         11.21.1
FOUND gh       /usr/local/bin/gh          2.103.0
FOUND git      /usr/bin/git               2.47.3
FOUND actionlint /usr/local/bin/actionlint 1.7.12
FOUND python3  /usr/bin/python3           Python 3.13.5
FOUND jq       /usr/bin/jq                jq-1.7
FOUND curl     /usr/bin/curl              8.14.1
MISSING deno (command not found)
FOUND pnpm     /usr/local/bin/pnpm        12.21.0（需自設 COREPACK_HOME；預設路徑 /usr/local/share/corepack/v1 無寫入權）
MISSING gitleaks (command not found)（CI 的 secrets job 另有安裝，不代表 box 預裝）
```

| 項目 | 狀態 | 依據 |
|---|---|---|
| `curl`、`gh`、`git`、`actionlint` 1.7.12、`node`／`npm`／`jq`／`python3` | 能做（已驗證） | 上表 `command -v` 與 `--version`（2026-11-24 08:09 Asia/Taipei） |
| 改 CI／探針／`.github/workflows/` 並推 `task/O-xxx`、開 [G3] PR | 能做（已驗證） | 本機成功 `git push` 含 workflow 的 `task/O-004`，並 `gh pr create`／`gh pr edit`（PR #18） |
| Docker、`supabase start`／`functions serve` | **不能做** | `docker`／`supabase` 指令不存在；db job 的 CLI 驗證只能在 GitHub Actions 的 `db` job 跑 |
| 合併 PR、推 `main`、force push、自設 GitHub secret、未核准就派 Claude Code | 不做（政策） | 交接單與憲章；本輪未嘗試這些動作 |

### 3.3 各權杖

| 權杖 | 已驗證能做 | 限制／不能做 | 未驗證 |
|---|---|---|---|
| **`ci.yml` 的 `GITHUB_TOKEN`** | 讀 repo、checkout（workflow 設 `persist-credentials: false`）、跑測試、彙總 `ci-ok` | workflow 宣告 `permissions: contents: read`。用這個 token 做的 `git push` **不會**觸發新的 workflow（見 §1.1）。本環境觀察：`gh pr checks`／`statusCheckRollup` 曾 403（沒有 checks 讀取權） | 是否另有未寫在 workflow 的隱藏權限 |
| **`claude-run-task.yml` 的 `GITHUB_TOKEN`** | 依 workflow 宣告：`contents: write`、`id-token: write`、`actions: read`、`pull-requests: write`（後者供既有 PR 留言） | 不應用來開新 PR 或合併。C3 在 `gh pr comment` 403 時改留 commit comment | 尚未在真實 run-task 上觀察 C3 留言／403 fallback（本單禁止派 Claude Code） |
| **Claude GitHub App token（OIDC）** | 推送到 `task/`／`fix/`／`poc/` 且可觸發 `ci.yml` 的 `push` run（O-002 修正後的既有 run） | 不應用來合併或改 repo secrets；依憲章不能改 `.github/workflows/` | action 是否偶爾仍用 `GITHUB_TOKEN` 寫入（故仍保留 `contents: write`）；workflow 推送被拒的一次實測 |
| **box 上 SRE 使用的 GitHub 權杖** | 細項 PAT（`gh auth status` 顯示 `github_pat_`，API 無 `X-OAuth-Scopes` 標頭；到期 2026-12-21 23:30 Asia/Taipei）。已驗證：推送含 `.github/workflows/` 的分支（等同需要 workflow 寫入）、開／編輯 PR、讀 Actions log 與 issue comment | 本輪未用它合併、未設 secret、未推 `main`、未 force push | 細項 PAT 的完整權限矩陣無法從 API 標頭列完，除上述已觀察項外皆標未驗證 |

### 3.4 `poc-spike.yml`（手動 `workflow_dispatch`）

在 `poc/A-xxx` 分支上跑 `.github/ci/spike.sh` 或環境檢查；**不需要 Docker**。不部署、不加 secret。不得把 spike 當成 T-018 `bundle` job 或 ADR-009 (2) 的部署證明。本輪**未**對此 workflow 做一次 `workflow_dispatch` 實測（標未驗證）。

`db` job 只在 `pull_request` 跑；`push` 事件若略過 `db`，`ci-ok` 會標「未驗證」，該次 push 綠燈不代表 health／ADR-009 已驗過。
