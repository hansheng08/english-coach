-- T-022: seed the 9 news sources of docs/ARCHITECTURE.md §11.1 (v1.6); shared reference data, read-only for users (T-005 grants).
-- include_url_pattern is null for all 9 (§11.1.1 point 1). terms_checked_at = 2026-11-22 where ADR-006 rated the terms; null where they are 「未驗證」.
-- To switch a source off (no code change): update public.news_source set enabled = false where feed_url = '<feed>';
insert into public.news_source (name, feed_url, category, priority, fetch_mode, include_url_pattern, enabled, terms_checked_at) values
  ('The New Stack', 'https://thenewstack.io/ai/feed/', 'ai', 1, 'rss_full', null, true, '2026-11-22'),
  ('SiliconANGLE', 'https://siliconangle.com/category/ai/feed/', 'ai', 2, 'rss_then_page', null, true, '2026-11-22'),
  ('MarkTechPost', 'https://www.marktechpost.com/feed/', 'ai', 3, 'rss_full', null, true, null),
  ('SD Times', 'https://sdtimes.com/feed/', 'software', 1, 'rss_full', null, true, '2026-11-22'),
  ('InfoQ', 'https://feed.infoq.com/', 'software', 2, 'rss_then_page', null, true, null),
  ('The New Stack', 'https://thenewstack.io/feed/', 'software', 3, 'rss_full', null, true, '2026-11-22'),
  ('Semiconductor Engineering', 'https://semiengineering.com/feed/', 'semiconductor', 1, 'rss_full', null, true, '2026-11-22'),
  ('eeNews Europe', 'https://www.eenewseurope.com/en/feed/', 'semiconductor', 2, 'rss_full', null, true, null),
  ('Semiconductor Digest', 'https://www.semiconductor-digest.com/feed/', 'semiconductor', 3, 'rss_full', null, true, '2026-11-22');
