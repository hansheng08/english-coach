---
name: run-task
description: 依 docs/tasks/<編號>.md 任務單執行開發、測試、修正或維運任務，並推送到任務單指定的分支。只在被明確呼叫時使用。
argument-hint: "[任務編號，例如 T-007]"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(pnpm install *), Bash(pnpm check *), Bash(pnpm typecheck *), Bash(pnpm lint *), Bash(pnpm arch *), Bash(pnpm test *), Bash(pnpm e2e *)
---

# 執行任務單 $ARGUMENTS

你在 GitHub Actions 上無人值守地執行，沒有人能回答問題。依以下步驟完成任務單 $ARGUMENTS：

1. 讀取 CLAUDE.md 與 docs/tasks/$ARGUMENTS.md。任務單不存在時，輸出「找不到任務單 $ARGUMENTS」後結束，不要做任何修改。
2. 先執行 git fetch origin，再依任務單「分支」一節建立或切換分支。絕對不要在 main 上 commit。
3. 讀任務單「背景」列出的文件，只做「範圍：要做」列出的事；「範圍外」的事一律不做。
4. 依「驗證方式」執行建置與測試。失敗就修正程式直到通過；不得刪除、跳過或放寬測試來讓它通過。真的無法完成時，停止修改，並在報告中說明原因。
5. 把結果寫到 docs/reports/$ARGUMENTS.md：完成摘要、變更檔案清單、測試結果、未完成事項、需要人類決定的問題。
6. commit（訊息格式：[Claude] $ARGUMENTS 摘要），再 git push origin <分支名稱>。
7. 不要開 PR、不要合併、不要修改 main，也不要修改其他任務的任務單。
8. 任務單內容不清楚到無法判斷時，不要猜：把問題寫進報告的「需要人類決定的問題」，commit 並推送報告後結束。
