# ADR-015：語音供應商連線契約（Azure Speech、Groq Whisper）
- 狀態：**已接受**（Architect，2026-11-27；送 G2 PR「[G2] 產品單契約缺口補齊（語音、種子庫、複習、音檔清除）」，Hansheng Merge 即核准；PR 內「待 Hansheng 決定」的項目以 Merge 時的決定為準）｜日期：2026-11-27｜提出：Architect
- 相關：PRD AC-06、AC-14、AC-15、NFR-03；ARCHITECTURE §5.0.4、§5.0.5、§5.0.7、§5.3、§5.4、§5.5～§5.7、§8；ADR-003、ADR-004、ADR-008（修訂 5）、ADR-012；TASKS T-016、T-017、A-002
- 官方文件都在 2026-11-27 讀取。

## 背景
T-016（Groq Whisper 逐字稿）和 T-017（Azure Speech 發音評估＋TTS）要寫單，但兩家都還沒有實測樣本。Gemini 的前例（T-015、ADR-012）是「照官方文件實作、測試標未驗證、之後用 PoC 補實測」。
- **Azure Speech**：微軟的語音雲服務；這裡用它的「短音訊 REST」（一次送一段 ≤ 30 秒的錄音、一次拿結果）做發音評估，用 TTS REST 把文字念成音檔。
- **Groq**：提供 Whisper 語音辨識模型的雲服務，API 和 OpenAI 的格式相同。

## 決定 1：不開 PoC，照文件實作
T-016、T-017 照 §5.5～§5.7 實作；契約測試用「照官方文件範例做的樣本」給假 `fetch` 回放，測試名稱標「未驗證」。實測（Azure 為 **A-004**、Groq 為 **A-002**）都改成**之後的驗證**，不是任何單的前提（憲章 §9「未驗證的假設不能當前提」）。A-003 已用在 Gemini，所以 Azure 編 A-004。

## 決定 2：金鑰放標頭
Azure 用 `Ocp-Apim-Subscription-Key: <AZURE_SPEECH_KEY>`（官方 auth 表寫短音訊和 TTS 都接受），不先換 token（換 token 多一次往返，token 只有 10 分鐘）。Groq 用 `Authorization: Bearer <GROQ_API_KEY>`。金鑰都不放網址，錯誤訊息一律換成 `[redacted]`。TTS 頁的標頭表把 `Authorization` 列為必要，和 auth 表不一致：**不確定**，A-004 確認；不行就改成先換 token，只動 adapter 內部。

## 決定 3：發音評估欄位對應
`score0to100 = NBest[0].PronScore`（夾在 0～100）、`recognizedText = Display`（**不確定**是否該用 `Lexical`）、字的時間用 `Offset`／`Duration`（100 奈秒單位）換成毫秒、`confidence` 一律 `null`（官方樣本裡發音評估的字層信心是 0.0，沒有意義）。請求用 `HundredMark`、`Word`、`Comprehensive`、`EnableMiscue: false`。

## 決定 4：沒聽到聲音回 ok、分數 0
`RecognitionStatus` 是 `NoMatch`、`InitialSilenceTimeout`、`BabbleTimeout` 時回 `ok`（分數 0、文字空、字表空），由 domain 的門檻判定「未通過、可重錄」（AC-06）；不當成供應商錯誤，避免畫面顯示「服務暫時無法使用」。`Error` → `unavailable`。

## 決定 5：TTS 格式
`audio-24khz-48kbitrate-mono-mp3`（`audio/mpeg`），`durationMs` 用位元率估算（**未驗證**，誤差預計幾十毫秒）；誤差超過 5% 時改用 `riff-24khz-16bit-mono-pcm`。只接受 `azure:` 開頭的 `VoiceId`。SSML 文字要跳脫 XML 特殊字元並去掉控制字元。

## 決定 6：回應形狀
沿用 contracts 既有的 `PronunciationResult`、`Transcript`、`TtsResult`，**不改 contracts、不加錯誤種類**。Groq 一律要 `verbose_json`；有文字卻沒有字的時間戳記（又要求了）→ `invalid_response`。

## 決定 7：付費不在範圍
只建 `azure-speech`（F0 免費層）；`azure-speech-paid` 不建 adapter（ADR-003 不自動改付費）。F0 的即時辨識只允許 1 個同時請求，所以跟讀（T-030）不可以平行送。

## 決定 8：錯誤對應保守
表見 §5.6、§5.7。原則：看不出原因的 4xx 一律 `unavailable`（可重試，不誤導成「金鑰壞了」）；401／403 → `auth`；Azure 403 內容含 "quota"（只有社群來源）與 Groq 每日額度的 429 → `quota_exhausted`；其他 429 → `rate_limited`。兩家都不回 `region_blocked`（文件沒有對應狀態）。

## 決定 9：Groq 與 A-002 脫鉤
T-016 不等 A-002。A-002 改成「之後驗證」：Whisper 會不會保留贅詞（`EVENING_STT_PROMPT` 的效果）、`verbose_json` 有沒有 `duration`（Groq 文件沒寫）、429 的實際內容格式。結果不同時只改 adapter 或 prompt，不改 contracts。

## 後果
- 好處：主線單不用等 Hansheng 的真金鑰；介面先固定。
- 代價：欄位名稱或錯誤格式和文件不同時，要回頭改 adapter（測試會在 A-004／A-002 跑真樣本時抓出）。

## 參考（2026-11-27 讀取）
- Azure 短音訊 REST：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short ；快速入門（區域網址）：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-speech-to-text
- Azure TTS REST：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech
- Azure 配額：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits ；定價：https://azure.microsoft.com/en-us/pricing/details/speech/
- Azure F0 月額度用完回 403（社群問答，非官方規格）：https://learn.microsoft.com/en-us/answers/questions/634325/ 、https://learn.microsoft.com/en-us/answers/questions/1608921/
- Groq STT：https://console.groq.com/docs/speech-to-text ；API reference：https://console.groq.com/docs/api-reference ；速率限制：https://console.groq.com/docs/rate-limits ；錯誤碼：https://console.groq.com/docs/errors
