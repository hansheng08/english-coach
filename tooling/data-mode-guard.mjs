import { fileURLToPath } from 'node:url';

const MODES = ['mock', 'supabase'];
const REQUIRED_FOR_SUPABASE = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];

const has = (env, key) => Object.prototype.hasOwnProperty.call(env, key);
const blank = (v) => typeof v !== 'string' || v.trim() === '';

export function assertDataModeEnv(env) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    return { ok: false, reason: 'env is not an object' };
  }
  if (!has(env, 'VITE_DATA_MODE')) {
    return { ok: false, reason: 'VITE_DATA_MODE is not set (no default)' };
  }
  const mode = env.VITE_DATA_MODE;
  if (typeof mode !== 'string' || !MODES.includes(mode)) {
    return { ok: false, reason: 'VITE_DATA_MODE must be exactly "mock" or "supabase"' };
  }
  const supabaseKeys = Object.keys(env).filter((k) => k.startsWith('VITE_SUPABASE_'));
  if (mode === 'mock') {
    if (supabaseKeys.length > 0) {
      return { ok: false, reason: `mock mode must not define: ${supabaseKeys.join(', ')}` };
    }
    return { ok: true, mode: 'mock' };
  }
  const missing = REQUIRED_FOR_SUPABASE.filter((k) => !has(env, k) || blank(env[k]));
  if (missing.length > 0) {
    return { ok: false, reason: `supabase mode requires non-empty: ${missing.join(', ')}` };
  }
  return { ok: true, mode: 'supabase' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = assertDataModeEnv(process.env);
  if (!r.ok) {
    process.stderr.write(`data-mode-guard: ${r.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(`data-mode-guard: OK (${r.mode})\n`);
}
