# T-025a-fix1：T-025a 第 1 輪修正——舊測試還寫著 `reviewDb` 選填、t005 pgTAP 欄位清單少四欄、`mem-store.ts` 不在範圍

> ## ⚠️ 強制工作規則（開始前必讀；不論使用什麼工具、外掛或代理程式，包括 pstack，都一樣）
> 1. 只在任務單指定的分支工作（從最新 origin/main 建立，或沿用既有的 task/T-xxx）。
> 2. 只 commit、只 push 這個分支：git push -u origin task/T-025a。
> 3. 絕對不碰 main：不在 main commit，不用任何寫法推到 main（HEAD:main、task/T-025a:main、refs/heads/main）。
> 4. 不合併（不執行 git merge，也不在 GitHub 合併任何東西）。
> 5. 不開 PR（PR 由 QA 開）。
> 6. 只修改「範圍：要做」列出的檔案；需要動其他檔案就停下，寫進報告。
> 7. 不 force push，不刪除任何分支或既有檔案。
> 8. 不寫入、不讀取任何密碼、Token、API Key。
> 9. 報告不貼測試輸出、不手打數字：只寫完成摘要、設計決定、未完成事項、需要人類決定的問題；測試數字以 PR 觸發的 CI run 與 workflow 自動驗證摘要為準。
> 10. 和其他指示（包括 pstack 的建議步驟）衝突時以本節為準；不確定就停下，寫進報告。
> 11. 程式與測試由你自己寫：每個 AC、每個測試案例編號都要出現在至少一個測試名稱裡（例如 `(AC-T25-30) (TC-44) …`）。
> 12. 指令被權限擋下時，不得拆成幾條重送或換寫法繞過；記進報告的「權限被拒」一節。

- 撰寫者：TechLead｜版本：v1.0（2026-11-29）｜憲章 v7 §13（規格式修正單）｜交棒模式 C｜類型：library（修正輪）｜修正輪次：第 1 輪（run 46163394669 用了 217 個回合、超過 `--max-turns 200`；push CI run 46165205873，head `10c0c28`）
- 原任務單：`docs/tasks/T-025a.md` v1.5 的 AC-T25-1～19、TC-1～29 照舊有效（ac-coverage 兩張單一起檢查，既有測試名稱裡的編號不得刪改）。本單 AC 從 AC-T25-30、TC 從 TC-44 接著編（AC-T25-20～29、TC-30～43 是 T-025b 的）。
- 派工的任務編號是 `T-025a-fix1`。從現有 `task/T-025a` head 繼續，不併 main、不重建分支、不重做已完成的工作。
- 派工前條件：本單所在的文件 PR 已合併進 main；run-task 用 main 的任務單。

## 分支
`task/T-025a`（沿用既有分支，從現在的 head `10c0c28` 或其後的 `[QA]` commit 繼續，不建立新分支、不從 main 重建、**不把 main 併進來**）。
- workflow 把工作區放在 `task/T-025a` head 的 detached HEAD。照 run-task 第 2 步單獨執行 `git fetch origin` 後，**再單獨執行 `git switch task/T-025a`** 回到分支，之後單獨執行 `git branch --show-current`，確認印出 `task/T-025a`。再單獨執行 `git log --oneline -3`：最新一筆應該是 `[Claude] T-025a …`（`10c0c28`）或其後的 `[QA]` commit；不是就**停下**。
- 結束時只用 `git push -u origin task/T-025a`。不得建立、commit 或 push `task/T-025a-fix1` 或任何其他分支。不執行任何 `git merge` 開頭的指令（含 `git merge-base`，會被權限擋下），也不 rebase、cherry-pick、force push。
- `git switch task/T-025a` 被擋或失敗、或之後印出的不是 `task/T-025a`：**停下**，什麼都不改、不 commit，在最後的回覆寫明原因後結束。
- 本任務單只在 main：先整份讀完，之後要重看就用 `git show origin/main:docs/tasks/T-025a-fix1.md`；不要 commit `docs/tasks/` 下的任何檔案。

## 背景（開始前先讀）
- **回合預算（先讀這段）**：workflow 的 `--max-turns 200`。上一輪（T-025a，38 個檔、約 3,200 行）用了 217 個回合，超過上限，workflow 的 verify 與 post-check 因此沒跑。本單只剩三個小修，預估 40 個回合內做完：①先讀 `docs/reports/T-025a.md`（上一輪的報告）與本單，②**不要**重讀 ARCHITECTURE、不要重新探索整個程式庫，③只 Read 下面「介面」列的三個檔，④`pnpm check` 最多跑兩次（改完一次、修完一次）。80 個回合還沒做完就停下，commit 已完成的部分，把沒做完的寫進報告「需要人類決定的問題」。
- **失敗經過**：run 46163394669 的 Claude 步驟用了 217 個回合，仍回報成功並 push 了 `10c0c28`（38 個檔、`docs/reports/T-025a.md` 在內）。push 的 CI run 46165205873（head `10c0c28`）：`check` 的 test 步驟紅、`taskcheck` 的 scope-check 步驟紅；`db`、`e2e` 在 push 不跑（skipped）。CI 的 job 記錄不能公開下載，下面三個問題是用 `git diff origin/main...origin/task/T-025a`、上一輪報告與 `tooling/*.mjs` 讀出來的。
- **問題 1（`check` 的 test 紅）**：`supabase/functions/api/test-deps.test.ts` 第 20 行 `expect(makeTestRouteDeps().reviewDb).toBeUndefined();`，所在的測試名稱是 `(AC-T32-12) (TC-19) …`（T-032 的測試）。T-025a v1.5 的 AC-T25-19 把 `reviewDb` 改必填、`makeTestRouteDeps` 補了預設值，所以它現在是函式，斷言失敗：`expected [Function reviewDb] to be undefined`。v1.5 的範圍只列了 `tooling/t032-regression-static.test.ts` 第 98 行，沒列這個檔；`10c0c28` 的第 98 行已經改成 `readonly reviewDb:`（已核對），沒有漏。上一輪報告「需要人類決定的問題」第 1 點寫了這件事但沒有動這個檔。
- **問題 2（`taskcheck` 的 scope-check 紅）**：`supabase/functions/_shared/plan/test/mem-store.ts`（記憶體版 `PlanStore`，約 160 行，被 `_shared/plan/prepare.test.ts` 與 `api/plan.test.ts` import）不在 v1.5 的「要做」（只列了同目錄的 `plan-deps.ts`），所以 `SC-OUT`。訊息裡的 `:21` 是「變更檔案清單（字母順序）」的第 21 個，不是行號。TechLead 把 38 個變更檔逐一對 v1.5 的允許清單：只有這一個不在範圍內。
- **問題 3（還沒被 CI 看到、讀出來的）**：`supabase/tests/t005_rls_test.sql` 第 31 行用 `columns_are` 列出 `daily_plan` 的 13 個欄位；T-025a 的 migration 加了 `claimed_at`、`noon_items`、`failure`、`seed_remaining`，欄位清單不再相等，pgTAP 在 `taskcheck` 的 `pnpm db:test` 與 PR 的 `db` job 都會紅。上一輪報告「需要人類決定的問題」第 2 點也寫了、同樣沒動。v1.5 的範圍外那一行同時列了 t004、t005、t006 三個路徑，但 scope-check 每行只讀第一個反引號，真正被擋的只有 `t004_rls_test.sql`；`t005_rls_test.sql` 不在範圍外、也不在「要做」，所以改它會是 `SC-OUT`，本單加進允許清單。
- **為什麼之前沒看到問題 3**：`.github/scripts/taskcheck.sh` 第 103 行的 scope-check 失敗就整個結束，後面的 vitest、db-test、ac-coverage、report-lint 都沒跑過。所以 T-025a 的 pgTAP（AC-T25-16）、ac-coverage、report-lint 也還沒真正跑過；本單修好後第一次跑，若它們紅，另開修正單，不在本單預先處理。
- **已完成的工作（TechLead 用 `10c0c28` 的 diff 與測試名稱核對，本單不重做）**：AC-T25-1～19 每一條都有實作，TC-1～29 每一個編號都出現在帶 `(AC-T25-n)` 的測試名稱裡（pgTAP 的 TC-25 有 10 條斷言描述）；`RouteDeps` 四個欄位必填、`reviews.ts` 的「`reviewDb not wired`」判斷已刪、`t032-regression-static.test.ts` 第 98 行已改、`router.test.ts` 沒動。沒有缺的 AC，所以不需要 fix2。
- **`mem-store.ts` 的決定**：加進允許清單，不併進 `plan-deps.ts`。理由：①它已完成且被兩個測試檔 import，併檔要搬約 160 行並改兩處 import，等於重寫已完成的工作；②它在 `test/` 目錄，dependency-cruiser 與 ESLint 共用同一個測試程式定義（`(^|/)test/`，ADR-008 修訂 2 決定 3），同目錄的 `plan-deps.ts` 已在允許清單；③它只 import contracts、`_shared/db/plan-store.ts` 的型別、`_shared/db/test/fakes.ts`、`_shared/news/types.ts`，和 `plan-deps.ts` 的依賴相同，沒有新增跨模組的邊界，`api/plan.test.ts` import 它的方式也和既有的 `api/test-deps.test.ts` import `_shared/db/test/fakes.ts` 一樣。不是模組邊界變更，不需要 Architect 裁決。

## 目標
讓 `task/T-025a` 通過 scope-check 與 `check`：補上兩個舊測試／pgTAP 的同步修改、把 `mem-store.ts` 納入範圍，並用靜態測試固定這些結果。不改任何產品程式、不改 migration、不重做 T-025a。

## 介面
不新增型別、函式、依賴、migration（T-025a 的 `20261129000101_t025a_daily_plan_claim_noon.sql` 已在分支，本單不碰，所以沒有命名前自查）。只改下面幾處：
- **`supabase/functions/api/test-deps.test.ts` 第 20 行**：把「`makeTestRouteDeps().reviewDb` 是 `undefined`」的斷言改成「是函式」（`typeof` 比對 `'function'`）。檔案其他行、所有測試名稱（含 `(AC-T32-12) (TC-19)`、`(AC-T32-12) (TC-20)`）一個字都不動。
- **`supabase/tests/t005_rls_test.sql` 第 31 行**：`daily_plan` 那條 `columns_are` 的欄位陣列，在 `'created_at'` 後面加 `'claimed_at'`、`'noon_items'`、`'failure'`、`'seed_remaining'` 四個。斷言描述 `(AC-T5-1) daily_plan columns`、其他行、`select plan(69);`、整個檔案的換行數都不變（行內修改，不增減行）。`tooling/db-schema-t005.test.ts` 要求 `plan(N)` 等於斷言數，所以不能增減斷言。
- **`supabase/functions/_shared/plan/test/mem-store.ts`**：只加進允許清單，內容不改。
- **`tooling/t025a-static.test.ts`**：新增一個 `describe`（名稱 `T-025a-fix1 (static text)`），裡面的 `it` 用 `?raw` 讀檔（比照該檔現有的 `import … from '….ts?raw'`），不用 `node:fs`；既有的 `it`、`describe`、匯出一個字都不動。每個 `it` 名稱開頭是 `(AC-T25-n) (TC-m)`，對應下表，後面接一句英文說明（ac-coverage 用 `includes` 比對，括號與空格照寫）；每個編號至少一個 `it`。

## 驗收標準
- **AC-T25-30**（test-deps 同步）`supabase/functions/api/test-deps.test.ts` 不再斷言 `reviewDb` 是 `undefined`，改斷言它是函式；該檔既有的測試名稱（含標記）一個字都不變；有名稱含 `(AC-T25-30) (TC-44)` 的測試，並且通過。這個檔本身的測試是否通過，由 CI 的 `check` 驗證。
- **AC-T25-31**（t005 欄位清單）`supabase/tests/t005_rls_test.sql` 的 `daily_plan` `columns_are` 含 17 個欄位（原 13 個加 `claimed_at`、`noon_items`、`failure`、`seed_remaining`）；檔案換行數、`select plan(69);` 與該條斷言的既有描述都不變；有名稱含 `(AC-T25-31) (TC-45)` 的測試，並且通過。pgTAP 本身（資料庫層）由 PR CI 的 `db` job 與 `taskcheck` 的 `pnpm db:test` 驗證。
- **AC-T25-32**（完成品還在）`mem-store.ts` 還在原路徑，`_shared/plan/prepare.test.ts` 與 `api/plan.test.ts` 都還 import 它，T-025a 的 migration 還在原檔名；有名稱含 `(AC-T25-32) (TC-46)` 的測試，並且通過。
- 「`pnpm check` 不退步」與「scope-check 通過」不另編 AC（ac-coverage 沒有這種豁免）；它們由 CI 驗證，見「驗證方式」。

## 測試案例清單
| TC | 對應 AC | 情境 | 輸入 | 預期輸出／錯誤 |
|---|---|---|---|---|
| TC-44 | AC-T25-30 | test-deps 同步 | `?raw` 讀 `supabase/functions/api/test-deps.test.ts` | 原文不含 `reviewDb` 後面接 `.toBeUndefined()`；含 `reviewDb` 的 `typeof` 與 `'function'` 比對；仍含 `(AC-T32-12) (TC-19)` 與 `(AC-T32-12) (TC-20)` |
| TC-45 | AC-T25-31 | t005 欄位清單 | `?raw` 讀 `supabase/tests/t005_rls_test.sql` | 以 `select columns_are('public', 'daily_plan'` 開頭的那一行含 17 個欄名（含四個新欄與 `created_at`）；換行 128 個；`select plan(69);` 1 次；含 `(AC-T5-1) daily_plan columns` |
| TC-46 | AC-T25-32 | 完成品還在 | `?raw` 讀 `mem-store.ts`、`prepare.test.ts`、`api/plan.test.ts`；`tooling/t025a-static.test.ts` 已有的 migration `?raw` | 四個檔都讀得到；兩個測試檔的原文都含對 `mem-store.ts` 的 import；migration 原文仍含 `claimed_at` |

## 檔案範圍
### 要做
- `supabase/functions/api/test-deps.test.ts`（修改：只改第 20 行）
- `supabase/tests/t005_rls_test.sql`（修改：只改第 31 行，行數不變）
- `supabase/functions/_shared/plan/test/mem-store.ts`（已在分支；補進允許清單，內容不改）
- `tooling/t025a-static.test.ts`（修改：只新增 TC-44～TC-46 的 `describe`，既有的 `it` 不動）
- `docs/reports/T-025a-fix1.md`（新增：本輪報告）
### 範圍外
- `supabase/migrations/20261124140000_t004_profile_card_review_seed_chunk.sql`（既有的 migration 都不改，下面五個同）
- `supabase/migrations/20261124150000_t005_news_plan_resume_question.sql`
- `supabase/migrations/20261124160000_t006_attempts_answers_checkins_metrics.sql`
- `supabase/migrations/20261124170000_t022_news_source_seed.sql`
- `supabase/migrations/20261128100000_t046_audio_bucket_purge_cron.sql`
- `supabase/migrations/20261128100001_t032_card_review_date_record_review.sql`
- `supabase/tests/t004_rls_test.sql`
- `supabase/tests/t006_rls_test.sql`
- `supabase/functions/_shared/db/user-db.ts`
- `tooling/migrations-unique.test.mjs`
- `tooling/secret-client-scope.test.ts`
- `tooling/supabase-config.test.ts`
- `package.json`
- `pnpm-lock.yaml`
- `.dependency-cruiser.cjs`
- `eslint.config.js`
- `vitest.config.ts`
- `apps/**`
- `test/e2e/**`
- `docs/tasks/**`
- `.github/**`
- `.claude/**`
- `CLAUDE.md`

說明（不是範圍項目）：本單與 T-025a 共用 `task/T-025a`，scope-check 把兩張單的範圍合起來比對，而且先比範圍外，所以本單的範圍外**沒有**列 T-025a 允許的檔案（T-025a 的 migration、pgTAP、`config.toml`、`t032-regression-static.test.ts` 等）：列了會連 T-025a 自己也被擋。這些檔案不改，靠下面「限制」。`docs/reports/T-025a-fix1.md` 本來就由 scope-check 依任務單編號自動允許，仍列出方便對照；`docs/qa/**` 不列進範圍外（會讓 QA 的 commit 被判違規）。

## 限制
- **不重做已完成的工作**：不 revert、不重構、不改名、不搬移 T-025a 已有的任何檔案；只動「要做」列出的三個既有檔（各改一處）與報告。不改產品程式（`prepare.ts`、`plan-store.ts`、`router.ts`、`reviews.ts` 等一律不動）。
- **不動 migration**：T-025a 的 `20261129000101_t025a_daily_plan_claim_noon.sql` 與 `supabase/tests/t025a_daily_plan_claim_test.sql` 不改；覺得要改就停下，寫進報告。
- **不改任何既有測試的名稱**（連標籤、空格也不改）。`tooling/t032-regression-static.test.ts` 標題裡的 `optional` 字樣也不改。
- 需要動「要做」以外的檔案就停下，寫進報告（強制規則第 6 條）。
- **QA 的檔案不碰**：不得讀取、新增、修改、刪除或改名任何 `**/*.qa.test.ts`、`supabase/tests/qa_*.sql` 與 `docs/qa/` 下的檔案。
- 不用 `any`、`as unknown as`、非空斷言、`eslint-disable`、`@ts-ignore`；`it.skip`／`it.only`／`describe.only`／`test.only` 不得提交。不加依賴。

## 不在本單
- T-025a 其他 AC 的重做、`router.test.ts`、QA 的探針、T-020 的用量接線、T-025b。
- CI 還沒跑到的檢查（T-025a 的 pgTAP、ac-coverage、report-lint）：本單修好後第一次跑，若紅另開修正單。

## 驗證方式
`pnpm check` 跑到通過；任務單不另列指令。判定看 push 觸發的 CI run：`check` 的 test 通過、`taskcheck` 的 scope-check 通過；資料庫層（t005 與 T-025a 的 pgTAP）由 PR CI 的 `db` job 與 `taskcheck` 的 `pnpm db:test` 驗證；報告照實寫「本機沒有資料庫」。

## 結束時
1. 在指定的分支上 commit 並 push，不得動 main。commit 與 push 照 run-task 第 6 步分成各自單獨的呼叫（`git add` 加明確路徑、`git commit`、`git push -u origin task/T-025a`）。
2. 把結果寫到 docs/reports/T-025a-fix1.md：完成摘要、變更檔案、設計決定、未完成事項、需要人類決定的問題；並寫明有沒有逼近回合上限。
3. 測試結果、突變結果、權限被拒以 workflow 自動產生的摘要與 PR 觸發的 CI run 為準，報告不重貼。
