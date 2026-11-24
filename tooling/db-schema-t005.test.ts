// T-005: static checks on migration 2 and its pgTAP file. The CI db job runs them for real
// (`supabase db reset` + `supabase test db`, AC-T5-8); these tests let run-task catch mistakes without Docker.
import { describe, expect, it } from 'vitest';
import migration from '../supabase/migrations/20261124150000_t005_news_plan_resume_question.sql?raw';
import pgtap from '../supabase/tests/t005_rls_test.sql?raw';

const TABLES = ['news_source', 'news_article', 'resume', 'question', 'daily_plan'] as const;
const TABLE_LIST = TABLES.map((t) => `public.${t}`).join(', ');

const migrationLines: string[] = migration.split('\n').map((l) => l.trim());

/** Trimmed lines between `create table public.<name> (` and the closing `);`. */
function tableLines(name: string): string[] {
  const start = migrationLines.indexOf(`create table public.${name} (`);
  if (start < 0) return [];
  const end = migrationLines.indexOf(');', start);
  return end < 0 ? [] : migrationLines.slice(start + 1, end);
}

const linesStartingWith = (prefix: string): string[] => migrationLines.filter((l) => l.startsWith(prefix));

const CATEGORY_CHECK = "check (category in ('ai', 'software', 'semiconductor'))";

const ASSERTION =
  /^select (columns_are|col_is_pk|col_type_is|col_is_null|col_is_unique|fk_ok|is|table_privs_are|throws_ok|results_eq|is_empty|lives_ok)\(/;

describe('migration 2 schema (T-005)', () => {
  it('(AC-T5-1) news_source and news_article columns match ARCHITECTURE §4 and ADR-006', () => {
    expect({ newsSource: tableLines('news_source'), newsArticle: tableLines('news_article') }).toEqual({
      newsSource: [
        'id uuid primary key default gen_random_uuid(),',
        'name text not null,',
        'feed_url text not null constraint news_source_feed_url_key unique,',
        `category text not null constraint news_source_category_check ${CATEGORY_CHECK},`,
        'priority smallint not null constraint news_source_priority_check check (priority between 1 and 3),',
        "fetch_mode text not null constraint news_source_fetch_mode_check check (fetch_mode in ('rss_full', 'rss_then_page')),",
        'include_url_pattern text,',
        'enabled boolean not null default true,',
        'terms_checked_at date,',
        'created_at timestamptz not null default now(),',
        'constraint news_source_category_priority_key unique (category, priority)',
      ],
      newsArticle: [
        'id uuid primary key default gen_random_uuid(),',
        'user_id uuid not null references auth.users (id) on delete cascade,',
        'source_id uuid not null references public.news_source (id) on delete restrict,',
        `category text not null constraint news_article_category_check ${CATEGORY_CHECK},`,
        'original_url text not null constraint news_article_original_url_key unique,',
        "original_sha256 text not null constraint news_article_original_sha256_key unique constraint news_article_original_sha256_check check (original_sha256 ~ '^[0-9a-f]{64}$'),",
        'title text not null,',
        'published_at timestamptz not null,',
        'rewritten_text text not null,',
        "chunks jsonb not null constraint news_article_chunks_check check (case when jsonb_typeof(chunks) = 'array' then jsonb_array_length(chunks) = 5 else false end),",
        "sentences jsonb not null constraint news_article_sentences_check check (jsonb_typeof(sentences) = 'array'),",
        'read_at timestamptz,',
        'created_at timestamptz not null default now(),',
        'constraint news_article_id_user_id_key unique (id, user_id)',
      ],
    });
  });

  it('(AC-T5-1) resume, question and daily_plan keys match ARCHITECTURE §4', () => {
    const plan = tableLines('daily_plan');
    expect({
      resumePk: tableLines('resume').includes('user_id uuid primary key references auth.users (id) on delete cascade,'),
      questionOwner: tableLines('question').includes('user_id uuid references auth.users (id) on delete cascade,'),
      planPk: plan.includes('constraint daily_plan_pkey primary key (user_id, plan_date),'),
      planCards: plan.includes(
        "card_ids uuid[] not null default '{}' constraint daily_plan_card_ids_check check (cardinality(card_ids) <= 25),",
      ),
      planStatus: plan.includes(
        "status text not null default 'pending' constraint daily_plan_status_check check (status in ('pending', 'ready', 'failed')),",
      ),
    }).toEqual({ resumePk: true, questionOwner: true, planPk: true, planCards: true, planStatus: true });
  });

  it('(AC-T5-1) every table exists exactly once, in dependency order', () => {
    const starts = TABLES.map((t) => migrationLines.indexOf(`create table public.${t} (`));
    expect({
      counts: TABLES.map((t) => linesStartingWith(`create table public.${t} (`).length),
      ordered: starts.every((s, i) => s >= 0 && (i === 0 || s > (starts[i - 1] ?? -1))),
    }).toEqual({ counts: [1, 1, 1, 1, 1], ordered: true });
  });
});

describe('migration 2 RLS and privileges (T-005)', () => {
  it('(AC-T5-2) RLS is enabled on every table and nothing is security definer', () => {
    expect({
      rls: TABLES.map((t) => migrationLines.filter((l) => l === `alter table public.${t} enable row level security;`).length),
      securityDefiner: migration.toLowerCase().includes('security definer'),
      forceRls: migration.toLowerCase().includes('force row level security'),
    }).toEqual({ rls: [1, 1, 1, 1, 1], securityDefiner: false, forceRls: false });
  });

  it('(AC-T5-2) grants and revokes are exactly the T-005 matrix', () => {
    expect([...linesStartingWith('grant '), ...linesStartingWith('revoke ')].sort()).toEqual(
      [
        'grant select on table public.news_source to authenticated;',
        'grant select, insert on table public.news_article to authenticated;',
        'grant update (read_at) on table public.news_article to authenticated;',
        'grant select, insert, update, delete on table public.resume to authenticated;',
        'grant select, insert on table public.question to authenticated;',
        'grant update (retired) on table public.question to authenticated;',
        'grant select, insert, update on table public.daily_plan to authenticated;',
        `grant all on table ${TABLE_LIST} to service_role;`,
        'revoke all on function public.daily_plan_question_guard() from public, anon, authenticated;',
        `revoke all on table ${TABLE_LIST} from anon;`,
        `revoke all on table ${TABLE_LIST} from authenticated;`,
      ].sort(),
    );
  });

  it('(AC-T5-3) policies are owner-only for user tables, read-only for news_source and bank questions', () => {
    const own = 'user_id = (select auth.uid())';
    expect(linesStartingWith('create policy ')).toEqual([
      'create policy news_source_select_authenticated on public.news_source for select to authenticated using (true);',
      `create policy news_article_select_own on public.news_article for select to authenticated using (${own});`,
      `create policy news_article_insert_own on public.news_article for insert to authenticated with check (${own});`,
      `create policy news_article_update_own on public.news_article for update to authenticated using (${own}) with check (${own});`,
      `create policy resume_select_own on public.resume for select to authenticated using (${own});`,
      `create policy resume_insert_own on public.resume for insert to authenticated with check (${own});`,
      `create policy resume_update_own on public.resume for update to authenticated using (${own}) with check (${own});`,
      `create policy resume_delete_own on public.resume for delete to authenticated using (${own});`,
      `create policy question_select_own_or_bank on public.question for select to authenticated using (${own} or user_id is null);`,
      `create policy question_insert_own on public.question for insert to authenticated with check (${own});`,
      `create policy question_update_own on public.question for update to authenticated using (${own}) with check (${own});`,
      `create policy daily_plan_select_own on public.daily_plan for select to authenticated using (${own});`,
      `create policy daily_plan_insert_own on public.daily_plan for insert to authenticated with check (${own});`,
      `create policy daily_plan_update_own on public.daily_plan for update to authenticated using (${own}) with check (${own});`,
    ]);
  });
});

describe('migration 2 news, plan, resume and question rules (T-005)', () => {
  it('(AC-T5-4) news_article stores no original full text, only its SHA-256 (CLAUDE.md §5 #7)', () => {
    const article = tableLines('news_article');
    expect({
      fullTextColumns: article.filter((l) => /^(original_text|original_body|full_text|body|content|raw_text|html)\b/.test(l)),
      columnCount: article.filter((l) => !l.startsWith('constraint ')).length,
      sha256: article.some((l) => l.startsWith('original_sha256 text not null constraint news_article_original_sha256_key unique')),
    }).toEqual({ fullTextColumns: [], columnCount: 13, sha256: true });
  });

  it('(AC-T5-5) news categories are the 3 contract literals and rotation defaults are not in SQL (CLAUDE.md §5 #11)', () => {
    expect({
      categoryChecks: migrationLines.filter((l) => l.includes(CATEGORY_CHECK)).length,
      rotationKeys: ['rotation_order', 'anchor_date', 'lookback_hours', 'step_days', 'after_last_days', 'forgot_days'].filter(
        (k) => migration.includes(k),
      ),
    }).toEqual({ categoryChecks: 2, rotationKeys: [] });
  });

  it('(AC-T5-6) daily_plan status, article owner and tonight question owner are enforced', () => {
    const plan = tableLines('daily_plan');
    const start = plan.indexOf('constraint daily_plan_status_consistency_check check (');
    expect({
      status: plan.slice(start, start + 5),
      articleOwner: plan.includes(
        'constraint daily_plan_article_owner_fkey foreign key (article_id, user_id) references public.news_article (id, user_id) on delete restrict,',
      ),
      questionGuard: migrationLines.includes(
        'where q.id = new.tonight_question_id and (q.user_id is null or q.user_id = new.user_id)',
      ),
      trigger: migrationLines.includes(
        'create trigger daily_plan_question_guard before insert or update of tonight_question_id, user_id on public.daily_plan',
      ),
    }).toEqual({
      status: [
        'constraint daily_plan_status_consistency_check check (',
        "(status = 'pending' and error is null)",
        "or (status = 'ready' and article_id is not null and actual_category is not null and error is null)",
        "or (status = 'failed' and error is not null)",
        ')',
      ],
      articleOwner: true,
      questionGuard: true,
      trigger: true,
    });
  });

  it('(AC-T5-7) deleting a resume keeps its questions, which must be retired first', () => {
    const question = tableLines('question');
    expect({
      resumeFk: question.includes('resume_id uuid references public.resume (user_id) on delete set null,'),
      resumeOwner: question.includes('constraint question_resume_owner_check check (resume_id is null or resume_id = user_id),'),
      retired: question.includes("constraint question_retired_check check (source = 'bank' or resume_id is not null or retired)"),
      storagePath: tableLines('resume').includes(
        "storage_path text not null constraint resume_storage_path_check check (starts_with(storage_path, user_id::text || '/')),",
      ),
    }).toEqual({ resumeFk: true, resumeOwner: true, retired: true, storagePath: true });
  });
});

describe('pgTAP file structure (T-005)', () => {
  const lines = pgtap.split('\n');
  const assertions = lines.filter((l) => ASSERTION.test(l));

  it('(AC-T5-8) plan(N) equals the number of assertions and the file is one rolled-back transaction', () => {
    const plan = /^select plan\((\d+)\);$/m.exec(pgtap);
    expect({
      begin: lines.filter((l) => l === 'begin;').length,
      plan: plan === null ? -1 : Number(plan[1]),
      ending: pgtap.endsWith('select * from finish();\nrollback;\n'),
    }).toEqual({ begin: 1, plan: assertions.length, ending: true });
  });

  it('(AC-T5-8) every assertion names its AC and AC-T5-1..7 are all covered', () => {
    const acs = assertions.map((l) => /'\((AC-T5-\d)\) /.exec(l)?.[1] ?? 'missing');
    expect({
      missing: acs.filter((a) => a === 'missing').length,
      covered: [...new Set(acs)].sort(),
      roles: ['anon', 'authenticated', 'service_role'].map((r) => lines.filter((l) => l === `set local role ${r};`).length),
      resets: lines.filter((l) => l === 'reset role;').length,
    }).toEqual({
      missing: 0,
      covered: ['AC-T5-1', 'AC-T5-2', 'AC-T5-3', 'AC-T5-4', 'AC-T5-5', 'AC-T5-6', 'AC-T5-7'],
      roles: [1, 1, 1],
      resets: 3,
    });
  });
});
