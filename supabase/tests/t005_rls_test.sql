-- T-005 pgTAP: schema, grants and RLS for news_source / news_article / resume / question / daily_plan.
-- Run by the CI db job (`supabase test db`, which enables pgtap in schema extensions); each file is one transaction.
begin;
select plan(69);

-- Fixtures (inserted by the migration owner; RLS does not apply to the table owner).
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 't005-user-a@example.com'),
  ('b0000000-0000-4000-8000-000000000002', 't005-user-b@example.com');
delete from public.news_source; -- T-022 seeds 9 sources; this file uses only its own 2 (rolled back)
insert into public.news_source (id, name, feed_url, category, priority, fetch_mode) values
  ('e0000000-0000-4000-8000-000000000051', 'Example AI', 'https://news.example.com/ai/feed/', 'ai', 1, 'rss_full'),
  ('e0000000-0000-4000-8000-000000000052', 'Example Software', 'https://news.example.com/software/feed/', 'software', 1, 'rss_then_page');
insert into public.news_article (id, user_id, source_id, category, original_url, original_sha256, title, published_at, rewritten_text, chunks, sentences) values
  ('a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000051', 'ai', 'https://news.example.com/ai/1', repeat('a', 64), 'A article', '2026-11-24 05:00+08', 'Rewritten A.', '[{},{},{},{},{}]', '[]'),
  ('b0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000052', 'software', 'https://news.example.com/software/2', repeat('b', 64), 'B article', '2026-11-24 05:00+08', 'Rewritten B.', '[{},{},{},{},{}]', '[]');
insert into public.resume (user_id, storage_path, redacted_text) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001/resume.pdf', 'Resume A'),
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002/resume.pdf', 'Resume B');
insert into public.question (id, user_id, resume_id, source, category, text, cited_experience) values
  ('a0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'resume', 'technical', 'A question', 'A experience'),
  ('b0000000-0000-4000-8000-0000000000d2', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'resume', 'intro', 'B question', 'B experience'),
  ('e0000000-0000-4000-8000-0000000000d3', null, null, 'bank', 'behavioral', 'Bank question', null);
insert into public.daily_plan (user_id, plan_date, planned_category, actual_category, article_id, tonight_question_id, status) values
  ('b0000000-0000-4000-8000-000000000002', '2026-11-24', 'semiconductor', 'software', 'b0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000d2', 'ready');

-- AC-T5-1: columns and keys
select columns_are('public', 'news_source', array['id', 'name', 'feed_url', 'category', 'priority', 'fetch_mode', 'include_url_pattern', 'enabled', 'terms_checked_at', 'created_at'], '(AC-T5-1) news_source columns');
select columns_are('public', 'resume', array['user_id', 'storage_path', 'redacted_text', 'uploaded_at'], '(AC-T5-1) resume columns');
select columns_are('public', 'question', array['id', 'user_id', 'resume_id', 'source', 'category', 'text', 'cited_experience', 'retired', 'created_at'], '(AC-T5-1) question columns');
select columns_are('public', 'daily_plan', array['user_id', 'plan_date', 'planned_category', 'actual_category', 'category_skipped', 'article_id', 'is_fallback_article', 'shadow_items', 'card_ids', 'tonight_question_id', 'status', 'error', 'created_at', 'claimed_at', 'noon_items', 'failure', 'seed_remaining'], '(AC-T5-1) daily_plan columns');
select col_is_pk('public', 'daily_plan', array['user_id', 'plan_date'], '(AC-T5-1) daily_plan primary key is (user_id, plan_date)');
select col_type_is('public', 'daily_plan', 'card_ids', 'uuid[]', '(AC-T5-1) daily_plan.card_ids is uuid[]');
select col_is_null('public', 'question', 'user_id', '(AC-T5-1) question.user_id is nullable (bank questions)');
select fk_ok('public', 'daily_plan', array['article_id', 'user_id'], 'public', 'news_article', array['id', 'user_id'], '(AC-T5-1) daily_plan (article_id, user_id) references news_article (id, user_id)');
select fk_ok('public', 'daily_plan', 'tonight_question_id', 'public', 'question', 'id', '(AC-T5-1) daily_plan.tonight_question_id references question.id');
select fk_ok('public', 'question', 'resume_id', 'public', 'resume', 'user_id', '(AC-T5-1) question.resume_id references resume.user_id');

-- AC-T5-4: no original full text; dedup by URL and SHA-256
select columns_are('public', 'news_article', array['id', 'user_id', 'source_id', 'category', 'original_url', 'original_sha256', 'title', 'published_at', 'rewritten_text', 'chunks', 'sentences', 'read_at', 'created_at'], '(AC-T5-4) news_article has no original full-text column');
select col_is_unique('public', 'news_article', 'original_sha256', '(AC-T5-4) news_article.original_sha256 is unique');

-- AC-T5-2: RLS enabled and table privileges
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('news_source', 'news_article', 'resume', 'question', 'daily_plan') and c.relkind = 'r' and c.relrowsecurity), 5, '(AC-T5-2) RLS is enabled on all 5 tables');
select table_privs_are('public', 'news_source', 'anon', array[]::text[], '(AC-T5-2) anon has no privileges on news_source');
select table_privs_are('public', 'news_article', 'anon', array[]::text[], '(AC-T5-2) anon has no privileges on news_article');
select table_privs_are('public', 'resume', 'anon', array[]::text[], '(AC-T5-2) anon has no privileges on resume');
select table_privs_are('public', 'question', 'anon', array[]::text[], '(AC-T5-2) anon has no privileges on question');
select table_privs_are('public', 'daily_plan', 'anon', array[]::text[], '(AC-T5-2) anon has no privileges on daily_plan');
select table_privs_are('public', 'news_source', 'authenticated', array['SELECT'], '(AC-T5-2) authenticated: news_source SELECT only');
select table_privs_are('public', 'news_article', 'authenticated', array['SELECT', 'INSERT'], '(AC-T5-2) authenticated: news_article SELECT/INSERT (+ UPDATE of read_at)');
select table_privs_are('public', 'resume', 'authenticated', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'], '(AC-T5-2) authenticated: resume SELECT/INSERT/UPDATE/DELETE');
select table_privs_are('public', 'question', 'authenticated', array['SELECT', 'INSERT'], '(AC-T5-2) authenticated: question SELECT/INSERT (+ UPDATE of retired)');
select table_privs_are('public', 'daily_plan', 'authenticated', array['SELECT', 'INSERT', 'UPDATE'], '(AC-T5-2) authenticated: daily_plan SELECT/INSERT/UPDATE only');

-- AC-T5-2: anon is refused at the privilege level
set local role anon;
select throws_ok('select count(*) from public.news_source', '42501', null, '(AC-T5-2) anon cannot read news_source');
select throws_ok('select count(*) from public.daily_plan', '42501', null, '(AC-T5-2) anon cannot read daily_plan');
reset role;

-- Signed in as user A
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- AC-T5-3: owner isolation, including cross-user inserts on every user table
select results_eq('select id from public.news_article', $$values ('a0000000-0000-4000-8000-0000000000a1'::uuid)$$, '(AC-T5-3) A reads only own news_article');
select results_eq('select user_id from public.resume', $$values ('a0000000-0000-4000-8000-000000000001'::uuid)$$, '(AC-T5-3) A reads only own resume');
select results_eq('select id from public.question order by id', $$values ('a0000000-0000-4000-8000-0000000000d1'::uuid), ('e0000000-0000-4000-8000-0000000000d3'::uuid)$$, '(AC-T5-3) A reads own and bank questions only');
select is_empty('select plan_date from public.daily_plan', '(AC-T5-3) A cannot read B daily_plan');
select throws_ok($$insert into public.news_article (user_id, source_id, category, original_url, original_sha256, title, published_at, rewritten_text, chunks, sentences) values ('b0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000051', 'ai', 'https://news.example.com/ai/3', repeat('c', 64), 'x', now(), 'x', '[{},{},{},{},{}]', '[]')$$, '42501', null, '(AC-T5-3) A cannot insert a news_article for B');
select throws_ok($$insert into public.resume (user_id, storage_path, redacted_text) values ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002/x.pdf', 'x')$$, '42501', null, '(AC-T5-3) A cannot insert a resume for B');
select throws_ok($$insert into public.question (user_id, resume_id, source, category, text, cited_experience) values ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'resume', 'intro', 'x', 'x')$$, '42501', null, '(AC-T5-3) A cannot insert a question for B');
select throws_ok($$insert into public.question (source, category, text) values ('bank', 'intro', 'x')$$, '42501', null, '(AC-T5-3) A cannot insert a bank question');
select throws_ok($$insert into public.daily_plan (user_id, plan_date, planned_category) values ('b0000000-0000-4000-8000-000000000002', '2026-11-25', 'ai')$$, '42501', null, '(AC-T5-3) A cannot insert a daily_plan for B');
select results_eq($$with u as (update public.resume set redacted_text = 'x' where user_id = 'b0000000-0000-4000-8000-000000000002' returning 1) select count(*)::int from u$$, array[0], '(AC-T5-3) A cannot update B resume');
select results_eq($$with d as (delete from public.resume where user_id = 'b0000000-0000-4000-8000-000000000002' returning 1) select count(*)::int from d$$, array[0], '(AC-T5-3) A cannot delete B resume');
select results_eq($$with u as (update public.question set retired = true where id = 'e0000000-0000-4000-8000-0000000000d3' returning 1) select count(*)::int from u$$, array[0], '(AC-T5-3) A cannot retire a bank question');
select throws_ok('delete from public.question', '42501', null, '(AC-T5-3) A cannot delete questions');
select throws_ok('delete from public.daily_plan', '42501', null, '(AC-T5-3) A cannot delete daily_plan');

-- AC-T5-4: dedup and read_at
select lives_ok($$update public.news_article set read_at = now() where id = 'a0000000-0000-4000-8000-0000000000a1'$$, '(AC-T5-4) A can mark own article as read');
select throws_ok($$update public.news_article set title = 'x' where id = 'a0000000-0000-4000-8000-0000000000a1'$$, '42501', null, '(AC-T5-4) A cannot change article content (only read_at)');
select throws_ok($$insert into public.news_article (user_id, source_id, category, original_url, original_sha256, title, published_at, rewritten_text, chunks, sentences) values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000051', 'ai', 'https://news.example.com/ai/1', repeat('d', 64), 'x', now(), 'x', '[{},{},{},{},{}]', '[]')$$, '23505', null, '(AC-T5-4) the same original_url cannot be stored twice');
select throws_ok($$insert into public.news_article (user_id, source_id, category, original_url, original_sha256, title, published_at, rewritten_text, chunks, sentences) values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000051', 'ai', 'https://news.example.com/ai/4', repeat('a', 64), 'x', now(), 'x', '[{},{},{},{},{}]', '[]')$$, '23505', null, '(AC-T5-4) the same original SHA-256 cannot be stored twice');
select throws_ok($$insert into public.news_article (user_id, source_id, category, original_url, original_sha256, title, published_at, rewritten_text, chunks, sentences) values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000051', 'ai', 'https://news.example.com/ai/5', repeat('e', 64), 'x', now(), 'x', '[{},{},{},{}]', '[]')$$, '23514', null, '(AC-T5-4) news_article.chunks must hold exactly 5 items');

-- AC-T5-5: news_source is read-only for users
select results_eq('select count(*)::int from public.news_source', array[2], '(AC-T5-5) authenticated can read news_source');
select throws_ok($$insert into public.news_source (name, feed_url, category, priority, fetch_mode) values ('x', 'https://news.example.com/x', 'ai', 2, 'rss_full')$$, '42501', null, '(AC-T5-5) authenticated cannot insert news_source');
select throws_ok('update public.news_source set enabled = false', '42501', null, '(AC-T5-5) authenticated cannot update news_source');

-- AC-T5-6: daily_plan rules
select lives_ok($$insert into public.daily_plan (user_id, plan_date, planned_category) values ('a0000000-0000-4000-8000-000000000001', '2026-11-24', 'semiconductor')$$, '(AC-T5-6) A can create own pending plan');
select throws_ok($$insert into public.daily_plan (user_id, plan_date, planned_category) values ('a0000000-0000-4000-8000-000000000001', '2026-11-24', 'ai')$$, '23505', null, '(AC-T5-6) one plan per user and plan_date');
select throws_ok($$update public.daily_plan set status = 'ready', actual_category = 'ai' where plan_date = '2026-11-24'$$, '23514', null, '(AC-T5-6) a ready plan needs an article');
select throws_ok($$update public.daily_plan set status = 'failed' where plan_date = '2026-11-24'$$, '23514', null, '(AC-T5-6) a failed plan needs an error');
select throws_ok($$update public.daily_plan set category_skipped = '{ai,sports}' where plan_date = '2026-11-24'$$, '23514', null, '(AC-T5-6) category_skipped only holds the 3 news categories');
select throws_ok($$update public.daily_plan set card_ids = array_fill('a0000000-0000-4000-8000-0000000000c1'::uuid, array[26]) where plan_date = '2026-11-24'$$, '23514', null, '(AC-T5-6) card_ids holds at most 25 cards');
select throws_ok($$update public.daily_plan set article_id = 'b0000000-0000-4000-8000-0000000000a2' where plan_date = '2026-11-24'$$, '23503', null, '(AC-T5-6) A plan cannot use B article');
select throws_ok($$update public.daily_plan set tonight_question_id = 'b0000000-0000-4000-8000-0000000000d2' where plan_date = '2026-11-24'$$, '23503', null, '(AC-T5-6) A plan cannot use B question');
select lives_ok($$update public.daily_plan set status = 'ready', actual_category = 'ai', category_skipped = '{semiconductor,software}', article_id = 'a0000000-0000-4000-8000-0000000000a1', tonight_question_id = 'e0000000-0000-4000-8000-0000000000d3' where plan_date = '2026-11-24'$$, '(AC-T5-6) A plan can be ready with own article and a bank question');

-- AC-T5-7: resume replace / delete and question retirement
select lives_ok($$update public.resume set storage_path = 'a0000000-0000-4000-8000-000000000001/resume-v2.pdf', redacted_text = 'Resume A v2' where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '(AC-T5-7) A can replace own resume');
select throws_ok($$update public.resume set storage_path = 'b0000000-0000-4000-8000-000000000002/resume.pdf' where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '23514', null, '(AC-T5-7) resume.storage_path must be under the owner folder');
select throws_ok($$insert into public.question (user_id, resume_id, source, category, text, cited_experience) values ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'resume', 'intro', 'x', 'x')$$, '23514', null, '(AC-T5-7) a question cannot cite another user resume');
select throws_ok($$insert into public.question (user_id, resume_id, source, category, text) values ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'resume', 'intro', 'x')$$, '23514', null, '(AC-T5-7) a resume question must cite an experience');
select throws_ok('delete from public.resume', '23514', null, '(AC-T5-7) a resume cannot be deleted before its questions are retired');
select lives_ok('update public.question set retired = true where resume_id is not null', '(AC-T5-7) A can retire own resume questions');
select lives_ok('delete from public.resume', '(AC-T5-7) A can delete own resume after retiring its questions');
select results_eq($$select resume_id is null and retired from public.question where id = 'a0000000-0000-4000-8000-0000000000d1'$$, array[true], '(AC-T5-7) deleting the resume keeps its questions with resume_id null and retired');
reset role;

-- AC-T5-2: service_role (secret key; daily-prep / purge-audio only) bypasses RLS
set local role service_role;
select results_eq('select count(distinct user_id)::int from public.daily_plan', array[2], '(AC-T5-2) service_role sees every user''s plans');
select throws_ok($$update public.daily_plan set tonight_question_id = 'b0000000-0000-4000-8000-0000000000d2' where user_id = 'a0000000-0000-4000-8000-000000000001'$$, '23503', null, '(AC-T5-6) even with the secret key a plan cannot use another user question');
reset role;

-- AC-T5-5 / AC-T5-7: domain checks (checked as the migration owner, like a seed-import migration)
select throws_ok($$insert into public.news_source (name, feed_url, category, priority, fetch_mode) values ('x', 'https://news.example.com/p4', 'ai', 4, 'rss_full')$$, '23514', null, '(AC-T5-5) news_source.priority must be 1..3');
select throws_ok($$insert into public.news_source (name, feed_url, category, priority, fetch_mode) values ('x', 'https://news.example.com/dup', 'ai', 1, 'rss_full')$$, '23505', null, '(AC-T5-5) one source per category and priority');
select throws_ok($$insert into public.question (user_id, source, category, text) values ('a0000000-0000-4000-8000-000000000001', 'bank', 'intro', 'x')$$, '23514', null, '(AC-T5-7) a bank question has no owner');

select * from finish();
rollback;
