// Shared types for _shared/news (ARCHITECTURE §4 news_source, §11.1.1, §11.2).
import type { AppError, NewsCategory } from '@english-coach/contracts';

/** One row of public.news_source, already read by the caller through _shared/db (T-025). */
export type NewsSource = {
  readonly id: string;
  readonly name: string;
  readonly feedUrl: string;
  readonly category: NewsCategory;
  readonly priority: 1 | 2 | 3;
  readonly fetchMode: 'rss_full' | 'rss_then_page';
  readonly includeUrlPattern: string | null;
  readonly enabled: boolean;
};

/** An article that passed every free filter. `body` lives only in memory and is never written to the database (CLAUDE.md §5 #7). */
export type Candidate = {
  readonly sourceId: string;
  readonly category: NewsCategory;
  readonly url: string;
  readonly title: string;
  readonly publishedAt: Date;
  readonly body: string;
  readonly sha256: string;
  readonly wordCount: number;
};

export type NewsUnavailable = Extract<AppError, { kind: 'news_unavailable' }>;

/** `message` is a short English reason code for developers only (no article text). */
export const unavailable = (category: NewsCategory, message: string): NewsUnavailable => ({
  kind: 'news_unavailable',
  category,
  message,
});
