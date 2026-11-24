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

## PR #17：T-012 domain/speech-metrics——停頓、贅詞、每分鐘字數（2026-11-24 00:12 台北時間）

- PR：https://github.com/hansheng08/english-coach/pull/17（task/T-012，library PR，只驗單元層）
- head SHA：1429f5dcb3af3c23d69f8df49db78f544882715a
- CI run：https://github.com/hansheng08/english-coach/actions/runs/45212275148（pull_request，同 SHA，`ci-ok` conclusion：success；完成於 2026-11-24 00:05:18 台北時間）
  - 略過、未驗證的 job：bundle、db、e2e
- QA 自跑（worktree /workspace/projects/english-coach-qa，當時 detached 於 origin/task/T-012，與 PR head 相同 SHA）：`pnpm install --frozen-lockfile`、typecheck、lint、arch（34 modules，0 violations）、`vitest run --no-cache --reporter=verbose`（Tests 326 passed (326)，16 files）、`pnpm check`，全部 exit 0。原始日誌在 /workspace/qa/english-coach-pr17/。`git diff --name-only origin/main...HEAD` 剛好 4 個範圍內的檔案（`docs/reports/T-012.md`、`packages/domain/src/index.ts`、`packages/domain/src/speech-metrics.test.ts`、`packages/domain/src/speech-metrics.ts`），沒有範圍外檔案；當時 `git status --short` 無輸出。`git diff --name-only 392fa39..HEAD` 剛好 2 個檔案（報告與測試），`speech-metrics.ts` 無變更。
- TechLead 第二輪核准留言存在：https://github.com/hansheng08/english-coach/pull/17#issuecomment-7106599945（2026-11-24 00:05:49 台北時間，作者 hansheng08），正文寫「TechLead Review：核准（head 1429f5d）」，涵蓋本 PR head。GitHub 上的 reviews 與 review comments 皆空（核准是 PR 留言，不是正式 Review 紀錄）。
- 結論：通過。AC-T12-1、AC-T12-2、AC-T12-3、AC-T12-4（M1～M5）、AC-T12-5、AC-T12F1-1、AC-T12F1-2、AC-T12F1-3、AC-T12F1-4、AC-T12F1-5、AC-T12F1-6、AC-T12F1-7、AC-T12F1-8 通過。
  - 突變類 AC 依幕僚長轉達的 Hansheng 決定，QA 未改程式，只對照 Claude Code 報告所貼輸出，並以 GitHub Actions execution artifact 核對。
  - AC-T12-4 的 M1～M5：對照第一輪 artifact（run 45205560119，`claude-execution-output-T-012-45205560119`）。每條突變內容與 AC 相符，指定測試失敗。報告貼文在去掉命令結尾的 `echo "exit $?"` 之後，M1～M4 與 artifact 逐字相符；M5 另外多 1 行空行（`14|` 之後），FAIL 名稱與「expected err, got ok」仍在。
  - AC-T12F1-1～5 的 X7、X8、X9、X19、X17、X12：對照 fix1 artifact（run 45210521082，artifact `claude-execution-output-T-012-fix1-45210521082`，id 14836776241）。該 run 的 metadata head SHA 是派工當下的 main `a6ef4f3`（任務單），但 execution 紀錄裡 `git switch task/T-012` 後 HEAD 是 `392fa39`，接著 commit `80252c1`、`1429f5d` 並 push，也就是產生本 PR head 的那次執行。Edit 內容與 AC 指定寫法相符；除 X12 外，報告 fenced 區塊與 artifact 的 `pnpm test` 輸出（去掉工具包裝行 `Exit code 1`）逐字相符。
  - X12 發現：報告 `docs/reports/T-012.md` 第 868 行把 vitest 截斷的原始字串 `() =…`（`=` 後面直接是 U+2026 `…`）重打成 `() =>…`（多了 1 個 `>`，U+003E）。這是整段貼文唯一的差異。artifact 本身顯示測試 `(AC-T12F1-5) keeps a trailing apostrophe when normalizing` 失敗（expected 0，received 1），突變為第 20 行 `/^[^a-z']+|[^a-z']+$/g` 改成 `/^[^a-z]+|[^a-z]+$/g`。依交接單「以 artifact 為準，不用因為這個擋合併」，本條仍判通過。
  - AC-T12-2 測試充分性：現有測試有鎖住「較長優先」（含 list 兩種順序，以及 fix1 把組成字也列入清單）、重疊候選不雙算、相鄰但不重疊的重複片語、以及 AC 寫到的大小寫／標點／空清單。等長片語在同一起點不會同時命中；等長但位置交疊的情況由 AC-T12F1-2 覆蓋。AC 沒有規定等長同位置的決勝規則。缺口（不列為缺陷，是否開 Q-xxx 由 Hansheng／幕僚長決定）：（1）較長命中之後、緊接著另一個較短贅詞（例如 `you know um`）沒有單獨斷言；（2）3 個字以上的片語也沒有測試（AC 例子只有 1 字與 2 字）。
- 缺陷：無。
- 待補驗 AC：本單無。

## PR #21：T-003 Supabase 骨架（2026-11-24 12:37 台北時間）

- PR：https://github.com/hansheng08/english-coach/pull/21 （`task/T-003` → `main`，library／後端骨架 PR，尚無前端 UI／CLI／E2E，依憲章 v5 §5 驗單元層與驗收條件）
- head SHA：`1a2ef4c4ded3241f9583f1e9d7a55e63080af29d`
- PR 觸發 CI run：https://github.com/hansheng08/english-coach/actions/runs/45326259235 （`pull_request`，同 head SHA，2026-11-24 12:25:10–12:27:33 台北時間，`ci-ok` conclusion：`success`）
  - 通過 job：`actionlint`、`secrets`（79 commits scanned，no leaks found，自測 3 項偵測通過）、`pushguard`、`detect`、`db`、`check`、`ci-ok`
  - 略過、未驗證的 job：`bundle`、`e2e`（另 `db` job 因尚未有 `supabase/tests` 略過 RLS 測試，屬 T-004 範圍）
  - 全 job 日誌（6,410 行）掃描結果：0 密鑰外洩
- QA 自跑（worktree `/workspace/projects/english-coach-qa`，detached 於 `origin/task/T-003`，head 與 PR 一致；Node v24.22.1、pnpm 12.21.0）：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm arch`（45 modules，115 dependencies cruised，0 violations，高於基準 34 modules）、`pnpm vitest run --no-cache --reporter=verbose`（Test Files 21 passed (21)，Tests 402 passed (402)）、`pnpm check`（21／402），全部 exit 0。原始日誌存於 `/workspace/qa/english-coach-pr21/`。`git diff --name-only origin/main...HEAD` 剛好 27 個範圍內檔案，無越界變更，跑完後 `git status --short` 無輸出。
- TechLead Review 留言已確認存在：https://github.com/hansheng08/english-coach/pull/21#issuecomment-7122057931 （2026-11-24 12:28:51 台北時間，涵蓋 head `1a2ef4c4ded3241f9583f1e9d7a55e63080af29d`；GitHub 正式 reviews 為 0，依憲章 v5 §9 以留言為準）。
- 結論：通過。AC-T3-1、AC-T3-2、AC-T3-3、AC-T3-4、AC-T3-5、AC-T3-6、AC-T3-7、AC-T3-8 及完成條件 1、2 全部通過。
  - AC-T3-1～AC-T3-7 邊界與負面測試檢查：逐檔檢視 `supabase-config.test.ts`（4）、`functions-resolve.test.ts`（3，含 `/testing` 對應未排除）、`env.test.ts`（17）、`auth.test.ts`（12）、`router.test.ts`（24，以 `Object.keys(ROUTES)` 走訪全路由、字面比對 `adr010-env`、`throw` 只記 error name）、`api.test.ts`（`HealthResponseSchema` 2）、`lint-rules.test.ts`（修訂 3 表 14 列）、`deno.test-d.ts`（2 個 `@ts-expect-error`）。無弱斷言、無假綠燈、無 `eslint-disable`／`@ts-ignore`／`it.skip`／`it.only`。
  - AC-T3-8（`db` job `138216511857` 原始日誌核對）：確認 `Using project supabase/ at repo root (T-003+).`、`SERVE_READY after 3s`、`MOUNT_OK: packages/contracts appears in the container mount list.`、`No contracts resolution error in serve log.`、`GET /auth/v1/settings reports disable_signup = true`、`signup HTTP 422 error_code=signup_disabled`、`admin create user HTTP 200` 與 ES256 登入、`/health` 無 JWT → 401／`ANON_KEY` → 401／使用者 JWT → 200 `{"ok":true}`、4 行 `adr010-env has_supabase_url=true has_publishable=true has_secret=true only_legacy_keys=false`（`Key-name check passed (4 adr010-env line(s)).`）、`db-job-verify: all checks passed.`。
  - 突變測試 M1～M12（依 Hansheng 決定由 QA 核對報告與 artifact，未自行改程式）：對照 run `45323782247` execution artifact（`claude-execution-output-T-003-45323782247`，115 turns，`permission_denials: []`），M1～M12 皆實際改壞、跑指定單檔指令失敗、並還原後通過 `pnpm check`；報告 `#1`～`#13` 與 M1～M12 貼文片段皆與 artifact 逐字相符（M4 因執行環境截斷 4,745 字元而標明省略）。
  - 非阻擋備註（不構成缺陷）：① `docs/reports/T-003.md` M12 標題寫 `exit 1`，artifact Bash #28 實為 `Exit code 2`（`TS2578` 失敗本身屬實，以 artifact 為準）；② artifact Bash #9 曾執行一次 `tail -c 200 tooling/lint-rules.test.ts`（不在任務單特別規則 17 清單，但未被權限擋下，對產品與測試無影響）；③ 細微測試補充建議（可於後續單順手補）：`env.test.ts` 只測了 `SUPABASE_ANON_KEY` 單獨觸發 `only_legacy_keys=true`（未單獨測 `SUPABASE_SERVICE_ROLE_KEY`）、`router.test.ts` 未在 `OPTIONS`／錯誤回應額外斷言 `Access-Control-Allow-Headers` 與 `Vary`、`eslint.config.js` 的 `FN_ENTRY` glob（照任務單寫法）也會匹配假設存在的 `_shared/index.ts`。
- 缺陷：無。
- 待補驗 AC：本單無。ADR-009 (2) 遠端部署打包依憲章 v5 §0.1 維持「未驗證」，RLS 屬 T-004，前端 `bundle`／`e2e` 屬後續前端單。
