// Per-host body containers for `rss_then_page` article pages (ARCHITECTURE §11.1.1 point 4).
import { htmlParagraphs, joinParagraphs } from './html.ts';

/** host → class token of the element that holds the article body. Only <p> inside it count. */
export const PAGE_RULES: Readonly<Record<string, string>> = {
  'siliconangle.com': 'single-post-content',
  'www.infoq.com': 'article__content',
};

/** Body text of an article page, or null (`extract_failed`): no rule for the host, or no <p> inside the container. Never falls back to the whole page. */
export function extractPageBody(html: string, host: string): string | null {
  const container = PAGE_RULES[host];
  if (container === undefined) return null;
  const paragraphs = htmlParagraphs(html, container);
  return paragraphs.length === 0 ? null : joinParagraphs(paragraphs);
}
