# RUNBOOK

- 版本：v0.1（2026-11-23）
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

O-002 合併進 main 之後，Claude 推 `task/*` 或 `fix/*` 時，應出現 `event=push` 的 `ci.yml` run，而且 `headSha` 等於該分支先端。若當時已經有 PR，也應出現 `pull_request` 的 synchronize run。workflow 裡的「Verify push triggered CI」步驟會查這件事；若約 3 分鐘內沒有對應的 push run，該步驟會失敗，方便回報幕僚長。

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
