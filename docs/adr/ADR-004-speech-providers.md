# ADR-004：STT、發音評分與 TTS 的預設供應商
- 狀態：**已接受**（G2，2026-11-22 18:46 Hansheng 核准）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：AC-04～06、AC-10、AC-14、AC-15、AC-17、AC-20、Q-05

## 背景
- 跟讀（AC-06）：≤ 5 秒內要有逐字正確率、語速比、發音分數（發音只顯示不擋關）。
- 晚上作答（AC-14、AC-15）：2～3 分鐘錄音，30 秒內逐字稿；要算停頓（> 2 秒）、贅詞、每分鐘字數，所以需要**逐字時間戳記**，而且**不能把贅詞自動刪掉**。
- TTS：新聞句、改寫回答要「原音」播放與計次（AC-04、AC-05、AC-17），手動新增字卡要可播放（AC-10）。

## 選項（免費額度皆於 2026-11-22 查證，來源見 ARCHITECTURE §17）
| 供應商 | 免費額度 | 逐字時間戳記 | 發音評分 | 適合 | 疑慮 |
|---|---|---|---|---|---|
| Groq `whisper-large-v3-turbo` | 20 RPM、2,000 RPD、7,200 音訊秒/時、28,800 音訊秒/天；不需信用卡 | 有（`verbose_json`＋`word`） | 無 | 晚上長錄音 | Whisper 常把 um/uh 等贅詞省略（未驗證，可用 prompt 改善）；資料使用條款未驗證 |
| Gemini `gemini-3.5-transcribe` | 免費層免費；RPD 未公布（看 AI Studio） | 有（官方說明支援 word-level timestamps） | 無 | STT 備選 | 免費層內容會用於改善產品；額度不透明 |
| Azure Speech F0（STT＋Pronunciation Assessment） | 每月 5 小時即時 STT（發音評分與 STT 同價、共用額度）；Neural TTS 每月 50 萬字元 | 有 | **有**（準確度、流暢度、完整度） | 跟讀發音評分、預產生 TTS | 註冊 Azure 帳號可能要信用卡驗證（未驗證）；短音訊 REST 只收 WAV 16 kHz 或 OGG Opus，≤ 30 秒（發音評分） |
| 瀏覽器 Web Speech API（辨識） | 免費 | 無 | 無 | — | 不能同時拿到錄音檔、不能換供應商、結果不穩定；不採用 |
| 瀏覽器 `speechSynthesis`（TTS） | 免費、本機 | — | — | 即時發音（AC-10） | Android 上的聲音品質依系統引擎（未驗證） |
| Gemini `gemini-3.8-flash-lite-tts` | 免費層免費；RPD 未公布 | — | — | TTS 備選 | 額度不透明 |

## 決定
| 能力 | 預設 | 備選（手動切換） |
|---|---|---|
| 跟讀辨識＋發音評分（AC-06） | **Azure Pronunciation Assessment（F0）**，scripted 模式，參考文字＝原句，一次呼叫同時拿到辨識文字與分數 | 「不評分」模式：改用 Groq 只算正確率與語速，發音分數顯示「無」 |
| 晚上 STT（AC-14、AC-17、AC-20） | **Groq Whisper turbo**，`prompt` 放含 um/uh 的範例以保留贅詞 | Gemini Transcribe、Azure STT |
| 預產生 TTS（AC-04、AC-05、AC-17） | **Azure Neural TTS（F0）**，備料時產生並存 Storage | Gemini Flash-Lite TTS |
| 即時 TTS（AC-10） | **瀏覽器 `speechSynthesis`** | `/tts`（伺服器） |
- 跟讀正確率與語速比在 `domain/shadowing` 計算：正確率＝辨識詞與原句詞的對齊（Levenshtein 詞級）比例；語速比＝原音長度 ÷ 使用者有聲長度（用時間戳記去掉頭尾靜音）。發音分數只顯示。
- 停頓、贅詞、每分鐘字數在 `domain/speech-metrics` 依時間戳記計算，不交給 LLM，結果可重現。

## 後果
- 好處：三家都有不需付費的額度，且分工後各自用量遠低於上限（ARCHITECTURE §10）；任一家失敗只影響一個能力。
- 代價：Hansheng 要開 Groq 與 Azure 帳號（Q-20）；前端要寫 WAV 編碼器（約 100 行，不加依賴）。
- 未驗證、建議 PoC 量測：Whisper 保留贅詞的程度（影響 AC-15 與 M3）、Azure 短音訊 REST 的實際延遲（影響 AC-06 ≤ 5 秒）。
