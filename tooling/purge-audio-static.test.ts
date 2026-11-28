import { describe, expect, it } from 'vitest';
import config from '../supabase/config.toml?raw';
import migration from '../supabase/migrations/20261128100000_t046_audio_bucket_purge_cron.sql?raw';
import pgtapPurge from '../supabase/tests/t046_audio_purge_test.sql?raw';
import pgtapRpc from '../supabase/tests/t046_orphan_audio_rpc_test.sql?raw';

describe('purge-audio static checks (T-046)', () => {
  it('(AC-T46-8) (TC-19) config.toml has [functions.purge-audio] and keeps [functions.api]', () => {
    expect(config).toContain(
      '[functions.purge-audio]\nverify_jwt = false\nimport_map = "./functions/deno.json"',
    );
    expect(config).toContain('[functions.api]\nverify_jwt = false\nimport_map = "./functions/deno.json"');
  });

  it('(AC-T46-9) (TC-20) migration: bucket, policies, extensions and cron job', () => {
    expect(migration).toMatch(/insert into storage\.buckets[\s\S]*?values \('audio', 'audio', false, 5242880\)/);
    expect(migration).toMatch(/create policy audio_select_own on storage\.objects\s+for select to authenticated/);
    expect(migration).toMatch(/create policy audio_insert_own on storage\.objects\s+for insert to authenticated/);
    expect(migration.match(/storage\.foldername\(name\)/g)?.length).toBe(2);
    expect(migration).not.toMatch(/for update/i);
    expect(migration).not.toMatch(/for delete/i);
    expect(migration).toContain('create extension if not exists pg_cron;');
    expect(migration).toContain('create extension if not exists pg_net with schema extensions;');
    expect(migration).toContain("cron.schedule('purge-audio-daily', '30 19 * * *'");
    expect(migration).toContain('/functions/v1/purge-audio');
    expect(migration).toContain('timeout_milliseconds := 60000');
    expect(migration).not.toContain('vault.create_secret');
  });

  it('(AC-T46-18) (TC-38) migration: orphan RPCs, privileges and partial indexes', () => {
    expect(migration).toMatch(
      /create function public\.list_orphan_audio_objects\(\s*p_cutoff timestamptz,\s*p_limit integer,\s*p_after_created_at timestamptz default null,\s*p_after_name text default null\s*\)/,
    );
    expect(migration).toContain('create function public.audio_paths_in_use(p_paths text[])');
    expect(migration).toContain("using errcode = '22023'");
    expect(migration.match(/security definer/g)?.length).toBe(2);
    expect(migration.match(/set search_path = ''/g)?.length).toBe(2);
    expect(migration).toContain(
      'revoke all on function public.list_orphan_audio_objects(timestamptz, integer, timestamptz, text) from public, anon, authenticated;',
    );
    expect(migration).toContain('revoke all on function public.audio_paths_in_use(text[]) from public, anon, authenticated;');
    const grants = migration.match(/grant execute on function [^;]*;/g) ?? [];
    expect(grants).toHaveLength(2);
    for (const g of grants) expect(g).toMatch(/ to service_role;$/);
    expect(migration).toMatch(/create index shadow_attempt_audio_path_idx\s+on public\.shadow_attempt \(audio_path\)\s+where audio_path is not null;/);
    expect(migration).toMatch(/create index evening_answer_audio_path_idx\s+on public\.evening_answer \(audio_path\)\s+where audio_path is not null;/);
  });

  it('(AC-T46-10) (AC-T46-18) (TC-21) (TC-39) the two pgTAP files exist and keep their own scope', () => {
    expect(pgtapPurge).toContain('purge-audio-daily');
    expect(pgtapPurge).not.toContain('list_orphan_audio_objects');
    expect(pgtapRpc).toContain('function_privs_are');
    expect(pgtapRpc).toContain("'22023'");
  });
});
