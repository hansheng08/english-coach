export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
/** E 一律寫明（不設預設值，避免 result.ts 依賴 errors.ts 造成循環）：一般寫 Result<T, AppError>；供應商介面用 Result<T, ProviderError>（ProviderError 是 AppError 的子集合，可以直接往上傳）。 */
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

export function map<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(f(r.error));
}

export function andThen<T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? f(r.value) : r;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

/** 把多個 Result 合成一個：全部成功回 ok(陣列)，否則回第一個 err。 */
export function all<T, E>(rs: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of rs) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}

/** 只給 I/O 模組（providers、db、news、api）包住會丟例外的呼叫；onThrow 必須把 unknown 轉成具體錯誤。 */
export function tryCatch<T, E>(f: () => T, onThrow: (cause: unknown) => E): Result<T, E> {
  try {
    return ok(f());
  } catch (cause) {
    return err(onThrow(cause));
  }
}

export async function tryCatchAsync<T, E>(
  f: () => Promise<T>,
  onThrow: (cause: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await f());
  } catch (cause) {
    return err(onThrow(cause));
  }
}

// 刻意不提供：unwrap()、expect()（會丟例外）。測試請用 @english-coach/contracts/testing 的 expectOk／expectErr。
