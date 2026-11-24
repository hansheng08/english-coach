import type { NewsCategory, NewsSettings, PlanDate } from '@english-coach/contracts';
import { daysBetween } from './taipei-date.ts';

export type RotationOrder = NewsSettings['rotation_order'];

/** rotation_order 往後數 offset 格（可為負數），三格一圈。 */
function stepFrom(order: RotationOrder, offset: number): NewsCategory {
  const i = ((offset % 3) + 3) % 3;
  if (i === 0) return order[0];
  if (i === 1) return order[1];
  return order[2];
}

/** 今天輪到的類別：rotation_order[(planDate − anchor_date 的天數) mod 3]；只看日期，錨點日之前也對（ARCHITECTURE §11.2）。 */
export function plannedCategory(
  planDate: PlanDate,
  settings: Pick<NewsSettings, 'rotation_order' | 'anchor_date'>,
): NewsCategory {
  return stepFrom(settings.rotation_order, daysBetween(settings.anchor_date, planDate));
}

/** 從 planned 開始依 rotation_order 往後繞一圈的 3 個類別（§11.2 備援第 2 步）。rotationOrder 必須已通過 NewsSettingsSchema。 */
export function categoryTryOrder(planned: NewsCategory, rotationOrder: RotationOrder): readonly NewsCategory[] {
  const start = rotationOrder.indexOf(planned);
  return [stepFrom(rotationOrder, start), stepFrom(rotationOrder, start + 1), stepFrom(rotationOrder, start + 2)];
}

export type NewsCategoryDecision = {
  readonly planned: NewsCategory;
  readonly actual: NewsCategory | null;
  readonly skipped: readonly NewsCategory[];
  readonly useFallbackArticle: boolean;
};

/** 依 categoryTryOrder 找第一個有新聞的類別；前面沒有的依序記入 skipped；三類都沒有 → 改用舊文章（§11.2 備援第 3 步）。 */
export function decideNewsCategory(
  planned: NewsCategory,
  rotationOrder: RotationOrder,
  hasNews: ReadonlySet<NewsCategory>,
): NewsCategoryDecision {
  const skipped: NewsCategory[] = [];
  for (const c of categoryTryOrder(planned, rotationOrder)) {
    if (hasNews.has(c)) return { planned, actual: c, skipped, useFallbackArticle: false };
    skipped.push(c);
  }
  return { planned, actual: null, skipped, useFallbackArticle: true };
}
