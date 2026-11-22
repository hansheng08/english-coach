# ADR-006：每日新聞來源、類別輪替與取得方式（Q-11、Q-16）
- 狀態：**已接受**（G2，2026-11-22 18:46 Hansheng 核准；來源依 Q-16 的新決定重新提名）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：AC-01、AC-02、Q-11、Q-16；ARCHITECTURE §11
- v0.1 提名的 IEEE Spectrum、NIST News（以及 GitHub Blog）已依 Q-16 撤下（G2 決定不用學術／機構來源）。

## 背景
- Q-16（G2 決定）：新聞分成 **AI、軟體工程、半導體產業** 三類，每天輪到一類；當天該類沒有新聞就換下一類。來源用一般新聞媒體與科技新聞媒體，不用學術來源；每類 1 個主要、1～2 個備用；**條款明文禁止 AI 使用的來源一律排除**。
- AC-02：AI 改寫成 250～300 字、附原文連結、不轉貼全文。所以來源最好在 RSS 裡就有全文（否則要抓原文頁面，條款風險更高），而且正文要 ≥ 250 字才不會讓 AI 「補寫」出原文沒有的內容。

## 檢查方法（2026-11-22 18:50～18:56 台北時間）
1. feed：`curl -L` 實際抓取，記 HTTP 狀態、則數、前 5 則的正文字數。
2. robots.txt：Python `urllib.robotparser`，以一般讀取器身分檢查 feed 網址與文章路徑。
3. 條款：讀官方條款頁，搜尋 artificial intelligence、machine learning、text and data mining、scrape、derivative、non-commercial 等字眼。讀不到或找不到條款頁就標「未驗證」。

## 候選比較
風險標記：**低**＝明文允許；**中**＝只授權個人／非商業使用，沒有 AI 條款，沒有明文允許改寫；**中高**＝另明文禁止重製或衍生作品，或必須抓原文頁面；**未驗證**＝條款讀不到；**排除**＝條款明文禁止 AI 使用，或 robots.txt 禁止。

| 類別 | 來源 | feed（HTTP、則數、正文字數） | robots | 條款重點（來源） | 風險 | 結論 |
|---|---|---|---|---|---|---|
| AI | **The New Stack（AI 分類）** | `https://thenewstack.io/ai/feed/`：200、26 則、全文約 600～1,350 字 | 允許 | 2017-11-01 版條款沒有 AI 條款；授權「為非商業目的下載部分素材」，並寫明尊重他人對其素材的 fair use（https://thenewstack.io/terms-of-use/） | 中 | **主要** |
| AI | SiliconANGLE（AI 分類） | `https://siliconangle.com/category/ai/feed/`：200、30 則、摘要約 75 字 | 允許 | 可為個人用途瀏覽或列印；不得重新發布、重製、複製、轉散布；沒有 AI 條款（https://siliconangle.com/terms-of-use/） | 中高（要抓原文頁面） | 備用 1 |
| AI | MarkTechPost | `https://www.marktechpost.com/feed/`：200、10 則、全文約 730～2,970 字 | 允許 | 條款頁（https://www.marktechpost.com/terms-of-use/）目前是佔位文字；同公司 aitoolsclub.com 條款禁止未經授權重製或轉散布 | 未驗證 | 備用 2 |
| AI | Ars Technica、Wired | RSS 200（Ars 全文約 200 字以上；Wired 約 22 字） | — | Condé Nast 使用者協議：非商業使用「不包括」未經書面同意用於 LLM、生成式 AI 的開發、訓練、微調或 grounding（含 RAG）（https://www.condenast.com/user-agreement） | — | **排除** |
| AI | The Verge | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml`：200、10 則、約 110 字 | 允許 | 首頁連到 PMC 條款：禁止用 AI 系統或工具存取、複製內容，禁止用內容訓練或 grounding AI（https://www.pmc.com/terms-of-use/）；Vox Media 條款（https://www.voxmedia.com/legal/terms-of-use）沒有 AI 條款但禁止抓取程式。適用哪份**不確定** | — | **排除**（保守） |
| AI | MIT Technology Review | RSS 全文 | — | 禁止用內容建立、訓練、改善 AI 系統（https://www.technologyreview.com/terms-of-service/） | — | **排除** |
| AI | The Register（AI/ML） | `https://www.theregister.com/software/ai_ml/headlines.atom`：200、50 則、全文 | **不允許**（robots.txt 預設拒絕所有未列名的程式；AI 用途要授權） | 只限個人、非商業使用；未經書面授權不得複製（https://www.theregister.com/Profile/terms_and_conditions_of_use） | — | **排除** |
| AI | TechCrunch | `https://techcrunch.com/category/artificial-intelligence/feed/`：200、20 則、約 15～32 字 | — | RSS 太短；Yahoo 的 RSS 條款規定內容「不得修改」，是否適用 TechCrunch **不確定** | — | 排除 |
| 軟體工程 | **SD Times** | `https://sdtimes.com/feed/`：200、10 則、全文約 340～1,100 字 | 允許 | 「禁止未經授權重製 D2 Emerge 網站上的任何內容」；沒找到 AI 條款（https://sdtimes.com/privacy-policy/ 內的 Terms of Use） | 中 | **主要** |
| 軟體工程 | InfoQ | `https://feed.infoq.com/`：200、15 則、摘要約 30～65 字 | **不確定**（robots.txt 對腳本回 406） | 條款頁（https://www.infoq.com/terms-and-conditions/）內容由程式載入，讀不到 | 未驗證（要抓原文頁面） | 備用 1 |
| 軟體工程 | The New Stack（全站，排除 AI 分類） | `https://thenewstack.io/feed/`：200、26 則、全文約 630～1,300 字 | 允許 | 同 AI 主要來源 | 中 | 備用 2 |
| 軟體工程 | GeekWire | `https://www.geekwire.com/feed/`：200、35 則、全文 | 允許 | 明文禁止「任何形式的 data extraction 或 data mining」（https://www.geekwire.com/termsofuse/） | — | 排除（等同禁止自動處理） |
| 軟體工程 | DevClass、InfoWorld | DevClass RSS 幾乎無正文；InfoWorld robots 不允許 feed | — | — | — | 排除 |
| 半導體產業 | **Semiconductor Engineering** | `https://semiengineering.com/feed/`：200、10 則、全文約 740～2,900 字 | 允許 | 只授權個人、非商業瀏覽；不得複製網站任何部分；可為個人用途下載或列印一份並附版權聲明；沒有 AI 條款（https://semiengineering.com/terms-of-service/） | 中 | **主要** |
| 半導體產業 | eeNews Europe | `https://www.eenewseurope.com/en/feed/`：200、10 則、約 420～470 字 | 允許 | 沒找到條款頁（出版者 European Business Press SA） | 未驗證 | 備用 1 |
| 半導體產業 | Semiconductor Digest | `https://www.semiconductor-digest.com/feed/`：200、100 則、約 330～850 字 | 允許 | 只限個人使用；不得修改、製作衍生作品；沒有 AI 條款（https://www.semiconductor-digest.com/terms-conditions/） | 中高 | 備用 2 |
| 半導體產業 | Tom's Hardware（半導體） | `https://www.tomshardware.com/feeds/tag/semiconductors`：200、50 則、全文 | — | Future 條款禁止為任何目的做 text/data mining 或抓取（含 AI）；內容授權條款禁止用於 AI，含摘要（https://futureplc.com/terms-and-conditions-uk/、https://www.futurecontenthub.com/terms-and-conditions/） | — | **排除** |
| 半導體產業 | EE Times、EE Times Asia | EE Times RSS 約 35 字；EE Times Asia 全文 | 允許 | AspenCore 條款禁止未經授權複製與自動抓取（https://aspencore.com/terms-of-use/，經搜尋摘要，未讀原文） | — | 排除 |

## 決定
| 類別 | 主要（priority 1） | 備用 1（priority 2） | 備用 2（priority 3） |
|---|---|---|---|
| AI | The New Stack AI 分類（中） | SiliconANGLE AI（中高） | MarkTechPost（未驗證） |
| 軟體工程 | SD Times（中） | InfoQ（未驗證） | The New Stack 全站，排除 AI 分類（中） |
| 半導體產業 | Semiconductor Engineering（中） | eeNews Europe（未驗證） | Semiconductor Digest（中高） |
- 備用來源預設**啟用**，依 priority 依序嘗試（輪替規則要有備援才不會常常跳類別）。Hansheng 可在 `news_source.enabled` 關掉風險較高的來源（例如「中高」與「未驗證」）。
- 輪替與跳類別規則見 ARCHITECTURE §11.2：當天類別＝`rotation_order[(plan_date − anchor_date) mod 3]`；該類所有來源都沒有合格文章 → 下一類；三類都沒有 → 最近一篇未讀的舊文章並註明（AC-01）。

## 取得與處理流程（`supabase/functions/_shared/news`）
1. 05:00 備料時，只抓當天需要的類別（不夠才抓下一類）；每個來源每天最多抓 1 次 RSS，帶 `If-Modified-Since`／`ETag`；User-Agent 寫明 `english-coach personal reader`；先查 robots.txt，不允許就跳過該來源。
2. `rss_full`：直接用 RSS 內的正文。`rss_then_page`：只抓該篇的官方頁面（不爬其他頁面）。
3. 篩選：`lookback_hours`（預設 48）內發布、URL 與原文 SHA-256 都沒用過、正文 ≥ 250 字、符合 `include_url_pattern`、LLM 在改寫時回傳 `category_match=true`。
4. Gemini 改寫成 250～300 字＋5 個語塊＋中文＋「/」斷句。**原文只在記憶體中**，資料庫只存改寫、標題、來源、類別、原文連結、雜湊。
5. 頁面顯示「今天的類別」、「改寫自：<來源>」與原文連結。

## 後果
- 好處：三類都有全文 RSS 的主要來源，不需要抓網頁；每類有 2 個備用，加上跨類別備援，「當天沒有新聞」只會在三類九個來源都沒有時發生。
- 風險：
  - 三個主要來源都是「中」：條款只授權個人、非商業使用，把全文交給 AI 改寫是否在允許範圍內**不確定**（這不是法律意見）。降低風險的做法：單一使用者、不公開、不存原文、附原文連結。
  - 「未驗證」的 3 個備用來源（MarkTechPost、InfoQ、eeNews Europe），啟用前建議 Hansheng 自己看過條款，或先關掉。
  - Gemini 免費層會把輸入用於改善 Google 產品（Q-15 已接受），對「禁止用於改善 AI」的來源有衝突，所以這類來源已全部排除；條款日後若改版加入 AI 禁止，需要停用該來源（`terms_checked_at` 記錄最後檢查日，建議每季重查一次）。
