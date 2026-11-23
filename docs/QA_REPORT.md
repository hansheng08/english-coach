# QA_REPORT

QA 擁有的工作文件。每個進 QA 的 PR 追加一節，不覆寫舊內容（憲章 v4 §5）。

## PR #9：T-900 模式 C 試跑（2026-11-23 21:11 台北時間）

- PR：https://github.com/hansheng08/english-coach/pull/9（task/T-900，library PR，只驗單元層）
- head SHA：24a008cc4659b74b86294707af50c5730e122c8b
- CI run：https://github.com/hansheng08/english-coach/actions/runs/45180613771（pull_request，同 SHA，`## ci-ok: PASS`）
  - 略過、未驗證的 job：bundle、db、e2e
- QA 自跑（worktree /workspace/projects/english-coach-qa）：`pnpm install --frozen-lockfile`、typecheck、lint、arch（25 modules，0 violations）、`vitest run --no-cache`（Tests 251 passed (251)）、`pnpm check`，全部 exit 0；`git diff --name-only origin/main...HEAD` 只有 4 個範圍內的檔案。
- 結論：通過。AC-T900-1、AC-T900-2、AC-T900-3 通過。PR 留言：https://github.com/hansheng08/english-coach/pull/9#issuecomment-7102186092
  - AC-T900-2 的突變要求（改壞常數後測試失敗）是對照測試斷言判定的，沒有實際改程式重跑，因為 QA 不得修改產品程式。這類 AC 的做法待 Hansheng 決定。
- 缺陷：無。
- 待補驗 AC：無。

## PR #14：T-008 SrsSettingsSchema＋台北日期＋SRS 間隔（2026-11-23 22:34 台北時間）

- PR：https://github.com/hansheng08/english-coach/pull/14（task/T-008，library PR，只驗單元層）
- head SHA：3cd4cc1199fe9cebb3a499a288801645889c263a
- CI run：https://github.com/hansheng08/english-coach/actions/runs/45194764432（pull_request，同 SHA，`ci-ok` conclusion：success；完成於 2026-11-23 22:30:12 台北時間）
  - 略過、未驗證的 job：bundle、db、e2e
- QA 自跑（worktree /workspace/projects/english-coach-qa，當時 detached 於 origin/task/T-008，與 PR head 相同 SHA）：`pnpm install --frozen-lockfile`、typecheck、lint、arch（32 modules，0 violations）、`vitest run --no-cache --reporter=verbose`（Tests 300 passed (300)，15 files）、`pnpm check`，全部 exit 0。原始日誌在 /workspace/qa/english-coach-pr14/。`git diff --name-only origin/main...HEAD` 剛好 10 個範圍內的檔案，沒有範圍外檔案；當時 `git status --short` 無輸出。
- 交接單寫 TechLead Review 已核准，但 GitHub 上沒有 review 紀錄（reviews 與 review comments 皆空）。
- 結論：通過。AC-T8-1、AC-T8-2、AC-T8-3、AC-T8-4、AC-T8-5、AC-T8-6、AC-T8-7（M1～M7）、AC-T8-8 通過。
  - AC-T8-7 的 M1～M7 依幕僚長轉達的 Hansheng 決定，QA 未改程式，只對照 `docs/reports/T-008.md` 所貼的原始輸出核對（PR body 僅有摘要；PR 留言與 review comments 皆空）。每一條都有該次 `vitest run` 的 FAIL 測試名稱、AssertionError 與 EXIT 1；突變內容與 AC 描述相符，失敗的測試也對應到該突變會破壞的斷言。
  - M3：輸出有缺列（報告自行說明少貼 4 行 `::error`，並把 Isolate 那行拆成兩行），但 FAIL 名稱與斷言原文仍在，故仍判定可核對、通過。
  - M4 觀察（不當缺陷）：把上限 `365` 改成 `366` 時，只有 `rejects after_last_days 366` 失敗；`rejects step day 366`、`rejects forgot_days 366` 仍會被其他跨欄位規則擋下，所以沒有單獨鎖住這兩個欄位的 365 上限。Claude 報告的「決定紀錄」也寫了這點。
  - 各條沒有單獨的「還原後再跑一次通過」輸出，只有報告 #8 在全部還原後的 300／300、EXIT 0。
- 缺陷：無。
- 待補驗 AC：本單無。PRD AC-09 的設定頁儲存與答完後排程不在本單範圍。
