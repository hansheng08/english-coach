import type { EnvGetter } from './env.ts';

/** 唯一碰 Deno.env 的地方（ADR-008 #7）。只在被呼叫時讀，import 時不讀（ADR-010 決定 3 第 4 點）。 */
export const denoEnv: EnvGetter = (name) => Deno.env.get(name);
