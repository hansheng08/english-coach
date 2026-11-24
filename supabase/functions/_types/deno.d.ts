// 只宣告本專案允許使用的 Deno API；要用其他 Deno API，先改這個檔案（Architect Review）。
declare namespace Deno {
  interface Env { get(key: string): string | undefined }
  const env: Env;
  function serve(handler: (request: Request) => Response | Promise<Response>): { readonly finished: Promise<void> };
}
