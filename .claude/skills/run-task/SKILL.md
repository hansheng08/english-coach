---
name: run-task
description: 依 docs/tasks/<編號>.md 任務單執行開發、測試、修正或維運任務，並推送到任務單指定的分支。只在被明確呼叫時使用。
argument-hint: "[任務編號，例如 T-007]"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git *), Bash(pnpm install --frozen-lockfile*), Bash(pnpm install --no-frozen-lockfile), Bash(pnpm check *), Bash(pnpm typecheck *), Bash(pnpm lint *), Bash(pnpm arch *), Bash(pnpm test *), Bash(pnpm e2e *)
---

# 執行任務單 $ARGUMENTS

你在 GitHub Actions 上無人值守地執行，沒有人能回答問題。依以下步驟完成任務單 $ARGUMENTS：

1. 讀取 CLAUDE.md 與 docs/tasks/$ARGUMENTS.md。任務單不存在時，輸出「找不到任務單 $ARGUMENTS」後結束，不要做任何修改。
2. 先執行 git fetch origin，再依任務單「分支」一節建立或切換分支。絕對不要在 main 上 commit。
3. 讀任務單「背景」列出的文件，只做「範圍：要做」列出的事；「範圍外」的事一律不做。
4. 依「驗證方式」執行建置與測試。失敗就修正程式直到通過；不得刪除、跳過或放寬測試來讓它通過。真的無法完成時，停止修改，並在報告中說明原因。
5. 把結果寫到 docs/reports/$ARGUMENTS.md：完成摘要、變更檔案清單、測試結果、未完成事項、需要人類決定的問題，以及固定的「權限被拒」一節（格式見下方「報告：權限被拒」）。
6. commit（訊息格式：[Claude] $ARGUMENTS 摘要），再 git push origin <分支名稱>。
7. 不要開 PR、不要合併、不要修改 main，也不要修改其他任務的任務單。
8. 任務單內容不清楚到無法判斷時，不要猜：把問題寫進報告的「需要人類決定的問題」，commit 並推送報告後結束。
9. 報告裡的數字與輸出一律從原始輸出或 execution artifact 複製，不得手打或改寫（憲章 v5 §13 第 11 條）。
10. 指令被權限擋下時，不得拆成幾條重送或換寫法繞過；停止該做法，記進報告的「權限被拒」一節（憲章 v5 §13 第 12 條）。workflow 會偵測拆開重送並判定這次執行失敗。

## 報告：權限被拒（必填）

報告固定有這一節，即使沒有被擋：

```
## 權限被拒
- 次數：<N> 次（沒有就寫「0 次」）
- 被擋的指令：
  - `<工具>`：`<被擋的指令原文>`
- 後續處理：<停下、改用任務單允許的做法，或寫進「需要人類決定的問題」；不得拆開重送>
```

- 次數與指令以 execution artifact 為準：workflow 跑完會把 `permission_denials` 的次數與指令寫進 job summary、PR 留言（或 commit comment），並上傳 execution artifact。報告裡先照實記下你在執行中看到的被拒指令（原文複製）；與 workflow 摘要不一致時，以 workflow 摘要為準。
