# ADR-005：AI 生卡的 3 秒上限（AC-03、AC-10）
- 狀態：**提議中**（G2；AC-10 是否放寬見 OPEN_QUESTIONS Q-14）｜日期：2026-11-22｜提出：Architect（ARCH-001）

## 背景
- AC-03：點語塊或反白後按「＋」，3 秒內建立含原句的 Collected 字卡（並顯示中文意思）。
- AC-10：輸入單字、英文短句或中文意思，3 秒內產生核心 chunk、1 句外商工程例句、≥ 2 個同義替換、可播放發音。
- 限制：只用 Gemini 免費層；手機（Android Chrome）→ Supabase Edge Function（東京）→ Gemini API。

## 公開數據（2026-11-22 讀取）
| 項目 | 數值 | 來源 |
|---|---|---|
| `gemini-3.5-flash-lite` 免費層 | 15 RPM、250K TPM、500 RPD；Google 不保證容量 | AI Studio 讀值（第三方整理）、官方 rate-limits 頁 |
| 輸出速度 | 約 314 tokens/s（Artificial Analysis，Google API） | artificialanalysis.ai |
| 第一個答案 token | 約 4.6～4.7 s（Artificial Analysis 的長題目工作量） | artificialanalysis.ai |
| OpenRouter 即時第一個 token | Google AI Studio 0.65～0.89 s、Vertex 0.39～1.25 s（偶見 6.86 s） | benchleader.com（轉載 OpenRouter，2026-11-21） |
| 思考等級 | 3.5 Flash-Lite 預設 `minimal` | ai.google.dev thinking 文件 |

## 估算（全部未驗證）
| 段落 | p50 | p95 |
|---|---|---|
| 手機 4G → 東京 Edge Function | 0.1 s | 0.3 s |
| Edge Function 冷啟動 | 0 s | 0.5 s |
| Gemini TTFT（短 prompt、minimal） | 0.7 s | 1.5～7 s |
| 生成約 150 tokens（JSON：chunk、例句、2～3 同義） | 0.6 s | 1.3 s |
| 回傳＋畫面 | 0.1 s | 0.2 s |
| **合計** | **約 1.5 s** | **約 3.8～9 s** |

## 選項
| 選項 | AC-03 | AC-10 | 代價 |
|---|---|---|---|
| A. 等完整 JSON 一次回傳 | 依賴 AI，p95 超標 | p95 超標 | 最簡單 |
| B. **AI 移出關鍵路徑＋串流＋預取**（建議） | 建卡不等 AI；預標語塊中文備料時算好 | 3 秒內先出 chunk，其餘串流補上 | 前端要處理部分結果；預取多耗 RPD |
| C. 改用付費層或 Live API | 可能較快 | 可能較快 | 違反免費原則（不採用） |
| D. 本機小模型（瀏覽器內） | — | 品質不足、手機效能不確定 | 不採用 |

## 決定
採用 **B**：
1. **AC-03**：`POST /cards` 只寫 chunk＋原句（不呼叫 AI），p95 目標 ≤ 1 s；例句、同義詞、TTS 由 `/cards/:id/enrich` 背景補。5 個預標語塊的中文在 05:00 備料時算好，點下去 0 次網路。只有「反白任意詞句看中文」要即時呼叫 AI。
2. **AC-10**：`/cards/generate` 用 Gemini `streamGenerateContent`，輸出 NDJSON，順序固定為 chunk → 中文 → 例句 → 同義替換；chunk 一出現就顯示並可用 `speechSynthesis` 播放（不需網路）。
3. **預取**：輸入停止 600 ms 後先送請求（同一輸入只送一次）；按「確認」時多半已完成。可在設定關閉。
4. **逾時**：8 s 沒完成回 `timeout`，保留輸入，可重試（不自動換供應商，ADR-003）。
5. **量測**：每次呼叫寫 `provider_call.latency_ms`，設定頁顯示近 7 天 p50／p95。

## 結論與建議
- AC-03：依此設計**可以達成**（未驗證）。
- AC-10：免費層**無法可靠**在 3 秒內完成整張卡。建議 PRD 改為：「**3 秒內顯示核心 chunk 並可播放發音；8 秒內（p95）補齊例句與 ≥ 2 個同義替換**」。8 秒的理由：p95 估算上緣約 9 s 但其中 7 s 的 TTFT 是偶發極端值；8 s 同時是逾時值，超過就讓使用者重試，比無限等待好。若 G2 後要更精確的數字，建議開 A-001 PoC：在 Android Chrome 實測 50 次，取 p95 再定。
