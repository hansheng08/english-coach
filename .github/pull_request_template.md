## 一句結論


## 關鍵決策（最多 3 點）
-

## 風險
-

## 自動驗證摘要
（workflow 產生，這裡只放連結：run-task 留言（或 commit comment）與 PR 觸發 CI 的 `taskcheck` job summary（測試數、突變結果、權限被拒、變更檔案）。O-009 前的分支寫「O-009 前無自動摘要」。不手貼測試輸出、不手打數字。）

## PR 觸發的 CI run
（本 PR 的 `pull_request` run 連結與 `ci-ok` 結果；`taskcheck`（task-lint／scope-check／ac-coverage）屬於 `ci-ok`。push 觸發的 run 不算。）

## 被略過的 job
（`ci-ok` 摘要「Skipped (not verified)」列出的 job 逐一寫出名稱，被略過的不算驗證過；沒有則寫「無」。）

## QA 驗收留言
（改了產品程式的 PR：QA 驗收留言的連結，留言須寫明對應的 head SHA；引用 PR 觸發的 CI run，不寫本機重跑。免 QA 的 PR 寫「免 QA，見下節」。G3 PR 的留言由 `g3-comment-guard`（commit status，不屬 `ci-ok`）檢查：`TechLead Review` 開頭的留言、或 QA 留言顯示本機重跑 `pnpm check`／`pg_prove` 都會判紅。）

## 免 QA 理由
（只動文件、CI、`.claude/` 設定時，由開 PR 的人填寫並引用憲章 §5「QA 驗收規則」；改了產品程式就刪除本節。）

## 本 PR 範圍外
-
