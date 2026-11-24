import { err, ok, tryCatch, type AppError, type Result } from '@english-coach/contracts';
import { z } from 'zod';

export type EnvGetter = (name: string) => string | undefined;
export type SupabaseEnv = { readonly url: string; readonly publishableKey: string };
export type KeyPresence = {
  readonly hasSupabaseUrl: boolean;
  readonly hasPublishable: boolean;
  readonly hasSecret: boolean;
  readonly onlyLegacyKeys: boolean;
};

const has = (get: EnvGetter, name: string): boolean => {
  const v = get(name);
  return typeof v === 'string' && v.length > 0;
};

/** 只判斷名稱有沒有值（ADR-010）：不解析、不保存任何值。 */
export function keyPresence(get: EnvGetter): KeyPresence {
  const hasSupabaseUrl = has(get, 'SUPABASE_URL');
  const hasPublishable = has(get, 'SUPABASE_PUBLISHABLE_KEYS') || has(get, 'SUPABASE_PUBLISHABLE_KEY');
  const hasSecret = has(get, 'SUPABASE_SECRET_KEYS') || has(get, 'SUPABASE_SECRET_KEY');
  const onlyLegacyKeys =
    !hasPublishable && !hasSecret && (has(get, 'SUPABASE_ANON_KEY') || has(get, 'SUPABASE_SERVICE_ROLE_KEY'));
  return { hasSupabaseUrl, hasPublishable, hasSecret, onlyLegacyKeys };
}

export function formatAdr010EnvLine(p: KeyPresence): string {
  return `adr010-env has_supabase_url=${String(p.hasSupabaseUrl)} has_publishable=${String(p.hasPublishable)} has_secret=${String(p.hasSecret)} only_legacy_keys=${String(p.onlyLegacyKeys)}`;
}

const PublishableKeysSchema = z.object({ default: z.string().min(1) });

function publishableKeyOf(get: EnvGetter): string | undefined {
  const raw = get('SUPABASE_PUBLISHABLE_KEYS');
  if (raw !== undefined && raw.length > 0) {
    const json = tryCatch(
      (): unknown => JSON.parse(raw),
      () => null,
    );
    if (json.ok) {
      const parsed = PublishableKeysSchema.safeParse(json.value);
      if (parsed.success) return parsed.data.default;
    }
  }
  const single = get('SUPABASE_PUBLISHABLE_KEY');
  return single !== undefined && single.length > 0 ? single : undefined;
}

/** 錯誤訊息只有變數名稱，不含任何值。不讀 SUPABASE_SECRET_KEYS（只給 daily-prep、purge-audio）。 */
export function loadSupabaseEnv(get: EnvGetter): Result<SupabaseEnv, AppError> {
  const url = get('SUPABASE_URL');
  if (url === undefined || url.length === 0) return err({ kind: 'internal', message: 'missing env SUPABASE_URL' });
  const publishableKey = publishableKeyOf(get);
  if (publishableKey === undefined) {
    return err({
      kind: 'internal',
      message: 'missing env SUPABASE_PUBLISHABLE_KEYS (default) or SUPABASE_PUBLISHABLE_KEY',
    });
  }
  return ok({ url, publishableKey });
}

export function loadAllowedOrigins(get: EnvGetter): readonly string[] {
  const raw = get('APP_ALLOWED_ORIGINS');
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
