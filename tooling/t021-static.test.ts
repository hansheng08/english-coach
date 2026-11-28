import { describe, expect, it } from 'vitest';
import migration from '../supabase/migrations/20261129000201_t021_tts_bucket.sql?raw';

describe('T-021 tts bucket migration (ARCHITECTURE §4.12.1)', () => {
  const sql = migration.replace(/--.*$/gm, '');

  it('(AC-T21-10) (TC-12) creates the private tts bucket with a 2 MB limit', () => {
    expect(sql).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit\)\s+values \('tts', 'tts', false, 2097152\)/);
  });

  it('(AC-T21-10) (TC-12) has the select and insert policies on the own folder', () => {
    expect(sql).toMatch(/create policy tts_select_own on storage\.objects\s+for select to authenticated/);
    expect(sql).toMatch(/create policy tts_insert_own on storage\.objects\s+for insert to authenticated/);
    const folder = /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g;
    expect(sql.match(folder)).toHaveLength(2);
    expect(sql.match(/bucket_id = 'tts'/g)).toHaveLength(2);
  });

  it('(AC-T21-10) (TC-12) has no update or delete policy', () => {
    expect(sql).not.toMatch(/for update/i);
    expect(sql).not.toMatch(/for delete/i);
    expect(sql).not.toMatch(/for all/i);
  });
});
