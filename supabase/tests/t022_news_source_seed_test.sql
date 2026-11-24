-- T-022 pgTAP: the seeded news sources equal docs/ARCHITECTURE.md §11.1 (v1.6).
-- Run by the CI db job (`supabase test db`); one rolled-back transaction.
begin;
select plan(3);

select results_eq(
  $$select category, priority::int, name, feed_url, fetch_mode, include_url_pattern, enabled, terms_checked_at::text from public.news_source order by category, priority$$,
  $$values
    ('ai', 1, 'The New Stack', 'https://thenewstack.io/ai/feed/', 'rss_full', null::text, true, '2026-11-22'),
    ('ai', 2, 'SiliconANGLE', 'https://siliconangle.com/category/ai/feed/', 'rss_then_page', null, true, '2026-11-22'),
    ('ai', 3, 'MarkTechPost', 'https://www.marktechpost.com/feed/', 'rss_full', null, true, null),
    ('semiconductor', 1, 'Semiconductor Engineering', 'https://semiengineering.com/feed/', 'rss_full', null, true, '2026-11-22'),
    ('semiconductor', 2, 'eeNews Europe', 'https://www.eenewseurope.com/en/feed/', 'rss_full', null, true, null),
    ('semiconductor', 3, 'Semiconductor Digest', 'https://www.semiconductor-digest.com/feed/', 'rss_full', null, true, '2026-11-22'),
    ('software', 1, 'SD Times', 'https://sdtimes.com/feed/', 'rss_full', null, true, '2026-11-22'),
    ('software', 2, 'InfoQ', 'https://feed.infoq.com/', 'rss_then_page', null, true, null),
    ('software', 3, 'The New Stack', 'https://thenewstack.io/feed/', 'rss_full', null, true, '2026-11-22')$$,
  '(AC-T22-8) news_source has exactly the 9 sources of ARCHITECTURE §11.1'
);
select is((select count(*)::int from public.news_source where include_url_pattern is not null), 0, '(AC-T22-8) include_url_pattern is null for every source');
set local role authenticated;
select results_eq('select count(*)::int from public.news_source', array[9], '(AC-T22-8) signed-in users can read the 9 sources');
reset role;

select * from finish();
rollback;
