declare const brand: unique symbol;

/** 品牌型別：結構相同但不能互相指定。只能由建立函式或 zod `.brand()` 產生。 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
