// Schemas for the `settings.*` JSON columns: SrsSettingsSchema (T-008) and NewsSettingsSchema (T-049).
import { z } from 'zod';
import { NEWS_CATEGORIES, NewsCategorySchema, PlanDateSchema, ProviderIdSchema, VoiceIdSchema, type NewsCategory } from './ids.ts';
import { DEFAULT_TTS_VOICE } from './tts.ts';

const DaysSchema = z.number().int().min(1).max(365);

/** 間隔複習設定（ARCHITECTURE §4.2）；預設值只寫在這裡，其他程式一律從設定讀。 */
export const SrsSettingsSchema = z
  .object({
    step_days: z.tuple([DaysSchema, DaysSchema, DaysSchema]).default([3, 7, 14]),
    after_last_days: DaysSchema.default(14),
    forgot_days: DaysSchema.default(1),
  })
  .superRefine((s, ctx) => {
    const [first, second, third] = s.step_days;
    if (second <= first) {
      ctx.addIssue({ code: 'custom', path: ['step_days', 1], message: 'step_days must be strictly increasing' });
    }
    if (third <= second) {
      ctx.addIssue({ code: 'custom', path: ['step_days', 2], message: 'step_days must be strictly increasing' });
    }
    if (s.after_last_days < third) {
      ctx.addIssue({
        code: 'custom',
        path: ['after_last_days'],
        message: 'after_last_days must be >= step_days[2]',
      });
    }
    if (s.forgot_days > first) {
      ctx.addIssue({ code: 'custom', path: ['forgot_days'], message: 'forgot_days must be <= step_days[0]' });
    }
  });

export type SrsSettings = z.infer<typeof SrsSettingsSchema>;

/** 每次 parse 都回新的陣列（預設順序＝NEWS_CATEGORIES，不另寫字串）。 */
const defaultRotationOrder = (): [NewsCategory, NewsCategory, NewsCategory] => [
  NEWS_CATEGORIES[0],
  NEWS_CATEGORIES[1],
  NEWS_CATEGORIES[2],
];

/** 每日新聞類別輪替設定（ARCHITECTURE §11.2、ADR-011 決定 6）；預設值只寫在這裡，其他程式一律從設定讀。 */
export const NewsSettingsSchema = z
  .object({
    rotation_order: z
      .tuple([NewsCategorySchema, NewsCategorySchema, NewsCategorySchema])
      .default(defaultRotationOrder),
    anchor_date: PlanDateSchema.prefault('2026-11-22'),
    lookback_hours: z.number().int().min(1).max(168).default(48),
  })
  .superRefine((s, ctx) => {
    if (new Set(s.rotation_order).size !== s.rotation_order.length) {
      ctx.addIssue({ code: 'custom', path: ['rotation_order'], message: 'rotation_order must list each category once' });
    }
  });

export type NewsSettings = z.infer<typeof NewsSettingsSchema>;

/**
 * TTS 設定（ARCHITECTURE §4.15.1、§4.19）：只有 `provider`、`voice`。T-020 的 SettingsSchema 會把它組進去，形狀不變。
 * 預設值只寫在這裡；`voice` 的預設是 `DEFAULT_TTS_VOICE`。
 */
export const TtsSettingsSchema = z.object({
  provider: ProviderIdSchema.default('azure-speech'),
  voice: VoiceIdSchema.default(DEFAULT_TTS_VOICE),
});

export type TtsSettings = z.infer<typeof TtsSettingsSchema>;
