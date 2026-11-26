# ADR-001：語言、前端與工具鏈
- 狀態：**已接受**（G2，2026-11-22 18:46 Hansheng 核准）｜日期：2026-11-22｜提出：Architect（ARCH-001）；修訂 1（2026-11-26）：前端型別與 DOM 測試環境
- 相關：PRD NFR-01、NFR-03、NFR-05；ADR-002

## 背景
english-coach 是 Android Chrome 優先的 PWA（NFR-01），所以前端一定是網頁技術。選型準則：型別嚴格、主流穩定且 AI 熟悉度高、CLI 建置／測試／lint 快、能用型別與模組邊界讓錯的程式寫不出來、依賴少且每個有理由、可部署可觀測。

## 選項
| 準則 | A. TypeScript 全端（React＋Vite；後端 TS） | B. 前端 TS＋後端 Go | C. Flutter Web（Dart） |
|---|---|---|---|
| 型別嚴格 | 高（`strict` 全開＋typescript-eslint strict-type-checked） | 高（Go 型別）＋前端 TS | 高 |
| AI 熟悉度 | 最高（React/TS 範例最多） | 高 | 中（Flutter Web＋錄音/Web Audio 範例少） |
| 前後端共用契約 | 可（同一份 zod schema） | 不行（需 OpenAPI 產生程式碼，多一套工具） | 不行 |
| CLI 回饋速度 | Vite／Vitest 秒級 | Go 快，但兩套工具鏈 | 較慢 |
| 免費託管後端 | Supabase Edge Functions（Deno TS）、Cloudflare Workers 都原生支援 | Go 需要容器主機；Cloud Run 需綁帳單、Render 免費方案會休眠（冷啟動破壞時間預算） | 同 B |
| PWA／Web Audio 支援 | 原生 | 原生（前端） | 間接，AudioWorklet 要寫 JS interop |
| 依賴數 | 少（見下） | 多一套語言 | Flutter SDK 本身很大 |

## 決定
採用 **A：TypeScript 全端**（G2 依建議核准）。
- 前端：React 19＋Vite＋`vite-plugin-pwa`。CSS 用 Vite 內建 CSS Modules，不加 UI 框架。
- 後端：TypeScript on Supabase Edge Functions（Deno），見 ADR-002。
- 工具：pnpm workspaces、TypeScript 5（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`）、ESLint＋typescript-eslint（strict-type-checked）、dependency-cruiser、Vitest、Playwright。
- 一個指令檢查全部：`pnpm check` = `tsc -b` → `eslint` → `depcruise` → `vitest run`。

### 依賴清單（每個都要有理由；新增依賴要經過 Architect Review）
| 套件 | 用在 | 理由 | 不用它的代價 |
|---|---|---|---|
| `react`、`react-dom` | 前端 | 主流、AI 熟悉度最高 | 自己寫 UI 狀態管理 |
| `react-router` | 前端 | 7 個畫面＋Android 返回鍵要正確 | 自寫路由易錯 |
| `@supabase/supabase-js` | 前端 `api/` | 登入、讀表、上傳 Storage 的官方用戶端 | 自寫 auth token 刷新 |
| `zod` | contracts（前後端） | AI 回傳與 API 邊界的執行期驗證，型別由 schema 推導 | 型別與驗證兩份會不一致 |
| `pdfjs-dist` | 前端 `features/resume` | 在瀏覽器把 PDF 轉文字，才能先去個資再送 AI（NFR-04） | 原檔直接送 AI 會帶出電話、Email |
| `mammoth` | 前端 `features/resume` | DOCX 轉文字，理由同上 | 同上 |
| `vite`、`@vitejs/plugin-react`、`vite-plugin-pwa` | 建置 | 快速建置、產生 SW 與 manifest | 手寫 SW 快取邏輯易出錯 |
| `typescript`、`eslint`、`typescript-eslint`、`dependency-cruiser` | 檢查 | 型別與架構規則 | 錯誤 import 只能靠人審 |
| `vitest`、`@playwright/test` | 測試 | 單元＋E2E（Android 尺寸模擬） | — |
| Supabase CLI | 本機後端、migration、部署 | 官方工具 | — |
- 刻意**不用**：供應商 SDK（Gemini、Groq、Azure 都直接 `fetch` REST，見 ADR-003）、狀態管理庫、UI 元件庫、ORM（SQL migration＋型別產生 `supabase gen types`）。

## 後果
- 好處：前後端一種語言，契約型別共用；AI 寫錯欄位名稱會在編譯期失敗。
- 代價：前端在 Node、後端在 Deno，兩種執行環境；`packages/*` 給 Deno 引用的方式「不確定」（見 ARCHITECTURE §12），第一張開發單先驗證。
- 未採用 B（Go 後端）：找不到能跑容器又不綁卡的免費主機。

## 修訂 1（2026-11-26，Architect；送 G2 PR，Hansheng Merge 即核准）：前端型別與 DOM 測試環境
### 背景
TechLead 在寫 T-018（`apps/web` 骨架）時發現，上面的依賴清單漏了兩樣東西：
- React 的型別套件。React 19 本身不附型別。
- Vitest 跑元件測試用的 DOM 環境。

repo 現況（`main` `8055105`）：
- 根目錄 `package.json` 的 devDependencies 只有 `dependency-cruiser`、`eslint`、`typescript`、`typescript-eslint`、`vitest`（^5.1.1）。`engines.node` 是 `^22.13.0 || ^24.0.0 || >=26.0.0`。
- `vitest.config.ts` 沒有設 `environment`，所以預設是 `node`。`include` 已經包含 `apps/**/*.test.{ts,tsx}`。
- lockfile 裡 `jsdom`、`happy-dom` 只出現在 vitest 的選用 peer，沒有實際安裝。`@testing-library/*` 一個都沒有。
- 所以 `@testing-library/react` 目前**不在**允許清單，要在這裡明寫，T-018 才不用猜。

T-018 需要 DOM 的測試，至少有三個：
- 登入閘門（未登入導到登入頁）。
- `ui/theme.ts`：`localStorage`、`data-theme`、`matchMedia`（ARCHITECTURE §9.1.4，PR #53）。
- mock 模式的「預覽：假資料」標示。

### 選擇 1：React 型別
| 準則 | `@types/react`＋`@types/react-dom`（DefinitelyTyped） | 不裝（寫自己的 `.d.ts`） |
|---|---|---|
| 型別嚴格 | 完整的 JSX、hooks、事件型別，能配合 `strict`＋strict-type-checked | 只能寫 `any` 等級的宣告，違反 CLAUDE.md §6 |
| 主流／AI 熟悉度 | React 官方文件指定的型別來源，範例最多 | 無 |
| 依賴 | `@types/react` 1 個依賴（`csstype`），`@types/react-dom` 0 個（npm registry，2026-11-26） | 0 |
| 相容性 | 19.x 對應 React 19；`@testing-library/react` 16 把兩者列為選用 peer | — |

**決定**：
- `apps/web` 的 devDependencies 加 `@types/react`、`@types/react-dom`。
- 主版本要和 `react` 一致（目前是 19），由 T-018 鎖在 `^19`。

### 選擇 2：Vitest 的 DOM 環境
| 準則 | **A. `jsdom`** | B. `happy-dom` | C. Vitest Browser Mode（`@vitest/browser-playwright`＋真的 Chromium） |
|---|---|---|---|
| 標準符合度 | 高，以符合 WHATWG 規格為目標；缺 layout 和 `matchMedia`（未在 v31 實測） | 中。Vitest 文件說它「缺少部分 API」；有 `matchMedia` | 最高，就是真的瀏覽器 |
| 主流／穩定／AI 熟悉度 | 最高。Testing Library 和大多數 React 測試範例預設用它 | 高，但範例比較少 | 中，Vitest 5 的功能，範例最少 |
| 速度 | 比 B 慢（Vitest 文件說 happy-dom「被認為比較快」；本專案**未驗證**） | 比 A 快（**未驗證**） | 最慢：要啟動瀏覽器，CI 的 `check` job 要先安裝 Chromium（**未驗證**多花多少分鐘） |
| 依賴數 | 18 個直接依賴（npm registry，2026-11-26，v31.0.1） | 7 個 | 3 個，加上 Playwright 瀏覽器 |
| 安全紀錄 | 沒查到重大 advisory（不確定是否完整） | v19 以前有 Critical 等級的 VM 逃逸（GHSA-37j7-fg3j-429f，v20 起預設關閉 JS 執行）。我們的測試不執行不受信任的內容，所以影響小，但是扣分 | 真的瀏覽器沙箱 |
| 與 Vitest／React 19／Testing Library | Vitest 內建 `environment: 'jsdom'`；Testing Library 官方支援 | Vitest 內建；Testing Library 可用 | 要改用 `vitest-browser-react`，等於另一套寫法 |
| Node 版本 | v30 起要 `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` | `>=20` | 跟 Vitest 一樣 |

**決定**：採用 **A. `jsdom`**，只放在 `apps/web` 的 devDependencies。
- 理由：
  - 符合規格的程度最好，AI 寫測試時最熟悉，Testing Library 的預設情境也是它。
  - 速度差距在本專案的測試量下應該不大（**未驗證**）。
  - happy-dom 的優勢是速度和依賴數，但 API 缺口會讓測試在 jsdom 和真瀏覽器之間行為不一，加上過去的安全紀錄，不選它。
  - Browser Mode 留給「需要真的 layout」的情況。那類檢查本專案已經交給 Playwright E2E（憲章 §15.9），不重複。
- 用法：
  - 根目錄的 `vitest.config.ts` 保留預設的 `node` 環境，讓 `packages/*`、`tooling/`、`supabase/` 的測試不載入 DOM。
  - T-018 用 Vitest 的 `projects`，或在 `apps/web` 的測試檔用 `// @vitest-environment jsdom`，只讓 `apps/**` 的測試跑在 jsdom 上。兩種都可以，T-018 選一種並寫進報告。
- `matchMedia`：jsdom 沒有實作（未在 v31 實測），由 `apps/web/test/setup.ts` 放一個可以控制結果的小 stub，主題測試才能切換「系統深色／淺色」。
- **Node 版本**：jsdom v30 起要 Node `^22.22.2 || ^24.15.0 || >=26.0.0`，比根目錄的 `engines` 嚴格。
  - **已決定（幕僚長 2026-11-26 20:24；Hansheng 以 Merge 本 PR 核准）**：T-018 把根目錄的 `engines.node` 收緊成 `^22.22.2 || ^24.15.0 || >=26.0.0`（或和 jsdom 一致的等價寫法），**不鎖舊版 jsdom**。CI 和 box 都是 Node 24，不受影響。
  - CI 用 Node 24 最新版，不受影響。

### 選擇 3：元件測試工具
| 準則 | **`@testing-library/react`＋`@testing-library/dom`** | 只用 `react-dom/client`＋`act` 自己寫 |
|---|---|---|
| 型別嚴格 | 有完整型別 | 有，但輔助函式要自己寫 |
| 主流／AI 熟悉度 | 最高，React 官方文件推薦 | 低，每個測試都要寫 render／cleanup 樣板 |
| 依賴 | `@testing-library/react` 1 個（`@babel/runtime`）；`@testing-library/dom` 8 個（npm registry，2026-11-26） | 0 |
| 相容性 | v16 的 peer：`react`／`react-dom` ^18 或 ^19，`@testing-library/dom` ^10（**v16 起必須自己裝 dom**） | — |
| 好處 | 用角色和名稱找元素（`getByRole`），測試順便檢查無障礙名稱，符合憲章 §15.8～15.9 的方向 | — |

**決定**：
- `apps/web` 的 devDependencies 加 `@testing-library/react`（^16）和 `@testing-library/dom`（^10）。
- Vitest 不開 `globals` 時，Testing Library 不會自動清理畫面，`apps/web/test/setup.ts` 要自己寫 `afterEach(cleanup)`。

### 刻意不加
- `@testing-library/user-event`：目前的互動用 `fireEvent` 就夠。之後需要模擬完整的鍵盤或指標事件時，再走 Architect Review。
- `@testing-library/jest-dom`：用一般的 `expect` 檢查 DOM 屬性就夠，不加全域 matcher 的型別擴充。
- `happy-dom`、`@vitest/browser-*`：理由見選擇 2。
- `@axe-core/playwright`（憲章 §15.9 的 axe 檢查）：屬於 SRE 接 UI 檢查的 O 單，不在本修訂。

### 使用範圍
- 這 5 個套件（`@types/react`、`@types/react-dom`、`jsdom`、`@testing-library/react`、`@testing-library/dom`）都是 `apps/web` 的 **devDependencies**。
- 正式程式（`apps/web/src/**` 的非測試檔）不得 import `jsdom` 或 `@testing-library/*`。
- T-018 在 `.dependency-cruiser.cjs` 加一條規則擋住，路徑例外和 ADR-008 修訂 1 的測試檔定義相同。
- `package.json` 和 lockfile 由 T-018 修改，本修訂不動。

### 依賴清單補充（併入上方「依賴清單」）
| 套件 | 用在 | 理由 | 不用它的代價 |
|---|---|---|---|
| `@types/react`、`@types/react-dom` | 前端（dev） | React 19 不附型別；strict 型別檢查需要 | JSX、hooks 沒有型別，錯誤寫法編譯得過 |
| `jsdom` | 前端測試（dev） | Vitest 的 DOM 環境；規格符合度最高、範例最多 | 元件、主題、登入閘門無法做單元測試 |
| `@testing-library/react`、`@testing-library/dom` | 前端測試（dev） | 用角色和名稱查元素，測試同時檢查無障礙名稱 | 每個測試自己寫 render、清理與查詢 |

### 參考（2026-11-26 讀取）
- Vitest Test Environment：https://vitest.dev/guide/environment.html ；Vitest 5 migration：https://vitest.dev/guide/migration/
- happy-dom advisory：https://github.com/capricorn86/happy-dom/security/advisories/GHSA-37j7-fg3j-429f
- 套件版本、依賴數、`engines`、peer：npm registry（`https://registry.npmjs.org/<套件>`）的 latest 和版本紀錄
