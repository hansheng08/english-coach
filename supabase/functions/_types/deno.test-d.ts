// ADR-010 決定 3：只宣告 Deno.env.get 與 Deno.serve，其他 Deno API 必須編譯失敗。
export type EnvGet = typeof Deno.env.get;
export type Serve = typeof Deno.serve;
// @ts-expect-error Deno.readTextFile 未宣告（ADR-010 決定 3）
export type ReadTextFile = typeof Deno.readTextFile;
// @ts-expect-error Deno.exit 未宣告（ADR-010 決定 3）
export type Exit = typeof Deno.exit;
