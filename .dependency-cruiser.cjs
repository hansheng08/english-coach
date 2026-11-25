/** ADR-008（含修訂 1、2）的架構規則。路徑相對 repo 根目錄；測試用同一份規則掃 tooling/fixtures/arch。 */

// 測試程式（ADR-008 修訂 2 決定 3；ESLint 共用同一個定義，.test.tsx 也是測試）
const TEST = '(^|/)test/|\\.test\\.tsx?$|\\.test-d\\.ts$';
// 各套件內的測試程式（regex 沒有「且」，所以逐一寫出；避免巢狀量詞，否則 dependency-cruiser 判定為不安全 regex）
const testOf = (dir) => `^${dir}/test/|^${dir}/.*/test/|^${dir}/.*\\.test\\.tsx?$|^${dir}/.*\\.test-d\\.ts$`;
// vitest（含 @vitest/*）：解析後在 node_modules 裡，或無法解析時只剩裸名稱
const VITEST = '^(@?vitest)($|/)|^@vitest/|node_modules/(vitest|@vitest)/';
const ZOD = '^zod($|/)|node_modules/zod/';

module.exports = {
  forbidden: [
    {
      name: 'adr008-01-domain-imports-contracts-only',
      comment: 'ADR-008 #1: packages/domain (production code) may only import packages/contracts (and itself)',
      severity: 'error',
      from: { path: '^packages/domain/', pathNot: TEST },
      to: { pathNot: '^packages/(domain|contracts)/' },
    },
    {
      name: 'adr008-01t-domain-tests-imports',
      comment: 'ADR-008 #1t (rev 1): domain tests may only import domain, contracts and vitest',
      severity: 'error',
      from: { path: testOf('packages/domain') },
      to: { pathNot: ['^packages/(domain|contracts)/', VITEST] },
    },
    {
      name: 'adr008-02-contracts-imports-zod-only',
      comment: 'ADR-008 #2: packages/contracts (production code) may only import zod (and itself)',
      severity: 'error',
      from: { path: '^packages/contracts/', pathNot: TEST },
      to: { pathNot: ['^packages/contracts/', ZOD] },
    },
    {
      name: 'adr008-02t-contracts-tests-imports',
      comment: 'ADR-008 #2t (rev 1): contracts tests may only import contracts and vitest',
      severity: 'error',
      from: { path: testOf('packages/contracts') },
      to: { pathNot: ['^packages/contracts/', VITEST] },
    },
    {
      name: 'adr008-03-features-isolated',
      comment: 'ADR-008 #3: a feature must not import another feature',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: { path: '^apps/web/src/features/([^/]+)/', pathNot: '^apps/web/src/features/$1/' },
    },
    {
      name: 'adr008-04-supabase-only-in-api-and-db',
      comment: 'ADR-008 #4 (rev 1): @supabase/* only in apps/web/src/api and supabase/functions/_shared/db',
      severity: 'error',
      from: { pathNot: '^(apps/web/src/api|supabase/functions/_shared/db)/' },
      to: { path: ['^(npm:|jsr:)?@supabase/', 'node_modules/@supabase/'] },
    },
    {
      name: 'adr008-05-endpoints-via-registry',
      comment: 'ADR-008 #5: edge function endpoints reach provider adapters only through providers/registry.ts',
      severity: 'error',
      from: { path: '^supabase/functions/(?!_shared/)[^/]+/' },
      to: { path: '^supabase/functions/_shared/providers/[^/]+/' },
    },
    {
      name: 'adr008-06-paid-config-only-registry',
      comment: 'ADR-008 #6: only providers/registry.ts may import config/paid.ts',
      severity: 'error',
      from: { pathNot: '^supabase/functions/_shared/providers/registry\\.ts$' },
      to: { path: '^supabase/functions/_shared/config/paid\\.ts$' },
    },
    {
      name: 'adr008-10-no-circular',
      comment: 'ADR-008 #10: no circular dependencies',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'adr008-11-no-test-code-in-production',
      comment: 'ADR-008 #11 (rev 1): production code must not import test code',
      severity: 'error',
      from: { pathNot: TEST },
      to: { path: TEST, pathNot: 'node_modules/' },
    },
    {
      name: 'arch31-db-no-providers',
      comment: 'ARCHITECTURE §3.1: supabase/functions/_shared/db must not import provider modules (adapters or registry)',
      severity: 'error',
      from: { path: '^supabase/functions/_shared/db/' },
      to: { path: '^supabase/functions/_shared/providers/' },
    },
    {
      name: 'adr008-18-adapter-imports-contracts-zod-only',
      comment:
        'ADR-008 #18 (rev 5): an adapter folder (providers/<adapter>/, production code) may only import contracts, zod and its own folder (no config, db, news, domain, registry/wiring, other adapters)',
      severity: 'error',
      from: { path: '^supabase/functions/_shared/providers/([^/]+)/', pathNot: TEST },
      to: {
        path: [
          '^supabase/functions/_shared/(config|db|news)/',
          '^packages/domain/',
          '^supabase/functions/_shared/providers/[^/]+\\.ts$',
          '^supabase/functions/_shared/providers/[^/]+/',
        ],
        pathNot: '^supabase/functions/_shared/providers/$1/',
      },
    },
    {
      name: 'adr008-19-provider-keys-only-wiring',
      comment: 'ADR-008 #19 (rev 5): only providers/wiring.ts (and tests) may import config/provider-keys.ts',
      severity: 'error',
      from: { pathNot: ['^supabase/functions/_shared/providers/wiring\\.ts$', TEST] },
      to: { path: '^supabase/functions/_shared/config/provider-keys\\.ts$' },
    },
  ],
  options: {
    // 目錄不存在也不會讓指令失敗：掃描根目錄 "."，只用 exclude 排除非產品程式。
    exclude: {
      path: '^(tooling|docs|dist|coverage|\\.claude|\\.github|\\.git)/|^[^/]+\\.(c|m)?(js|ts)$',
    },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
  },
};
