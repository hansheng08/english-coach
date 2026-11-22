# ADR-007：PWA 外殼與錄音格式（NFR-01）
- 狀態：**提議中**（G2）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：NFR-01、NFR-06、AC-04～06、AC-14、AC-17、AC-25

## 背景
主要驗收裝置是 Android＋Chrome；要能加入主畫面；需連網（不做離線）；跟讀要送發音評分（Azure 短音訊 REST 只收 WAV PCM 16 kHz mono 或 OGG Opus，發音評分 ≤ 30 秒）；晚上錄 2～3 分鐘（Groq 接受 webm、wav、ogg 等，免費層單檔 ≤ 25 MB）。

## 選項
| 項目 | 選項 A | 選項 B | 選擇 |
|---|---|---|---|
| SW | `vite-plugin-pwa`（Workbox）產生 | 手寫 SW | A：少寫快取邏輯，主流 |
| 快取策略 | 外殼 precache＋API network-only | 快取 API 回應以支援離線 | A：Q-03 不做離線，避免個資留在快取 |
| 跟讀錄音 | AudioWorklet → 16 kHz WAV（自寫編碼器） | MediaRecorder webm → 伺服器轉檔 | A：Edge Function 沒有 ffmpeg，轉檔不可行；WAV 6～8 秒只有約 200～260 KB |
| 晚上錄音 | MediaRecorder `audio/webm;codecs=opus` | WAV | A：3 分鐘約 0.6 MB（WAV 約 5.8 MB） |
| 即時發音 | `speechSynthesis` | 伺服器 TTS | A（AC-10 的 3 秒） |

## 決定
- manifest：`name`、`short_name`、192／512 px 圖示（含 maskable）、`start_url: "/"`、`display: "standalone"`、`theme_color`；Chrome 108 起安裝不再要求 SW fetch handler（Chrome 官方部落格），但我們仍註冊 SW。
- SW：`registerType: 'prompt'`；precache 外殼；`/functions/v1/*` 與 Supabase REST network-only；TTS 音檔 cache-first（50 個、7 天）；離線時顯示「需要連網」。
- 麥克風：只在使用者按「開始錄音」後呼叫 `getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })`；拒絕時顯示設定說明；中午頁面不載入錄音模組（AC-08）。
- 錄音一律先寫 IndexedDB，上傳成功且處理完成後才刪（AC-25）。

## 後果
- 好處：沒有額外依賴；格式直接符合兩家供應商。
- 代價：要自己寫並測試 WAV 編碼與重新取樣（純函式，放 `apps/web/src/audio`，有單元測試）。
- 未驗證：`noiseSuppression` 對發音評分的影響；部分 Android 機型的 AudioWorklet 取樣率（可能 44.1／48 kHz，需重新取樣）。
