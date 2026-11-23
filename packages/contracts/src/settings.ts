// Schemas for the `settings.*` JSON columns; T-049 adds NewsSettingsSchema to this file.
import { z } from 'zod';

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
