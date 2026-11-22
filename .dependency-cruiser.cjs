/** ADR-008 的架構規則（第 1～6、10 條）。路徑相對 repo 根目錄；測試用同一份規則掃 tooling/fixtures/arch。 */
module.exports = {
  forbidden: [
    {
      name: 'adr008-01-domain-imports-contracts-only',
      comment: 'ADR-008 #1: packages/domain may only import packages/contracts (and itself)',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { pathNot: '^packages/(domain|contracts)/' },
    },
    {
      name: 'adr008-02-contracts-imports-zod-only',
      comment: 'ADR-008 #2: packages/contracts may only import zod (and itself)',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { pathNot: ['^packages/contracts/', '^zod($|/)', 'node_modules/zod/'] },
    },
    {
      name: 'adr008-03-features-isolated',
      comment: 'ADR-008 #3: a feature must not import another feature',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: { path: '^apps/web/src/features/([^/]+)/', pathNot: '^apps/web/src/features/$1/' },
    },
    {
      name: 'adr008-04-supabase-js-only-in-api',
      comment: 'ADR-008 #4: only apps/web/src/api may import @supabase/supabase-js',
      severity: 'error',
      from: { pathNot: '^apps/web/src/api/' },
      to: { path: ['^@supabase/supabase-js($|/)', 'node_modules/@supabase/supabase-js/'] },
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
