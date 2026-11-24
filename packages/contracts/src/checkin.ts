// T-006: slot check-in events (ARCHITECTURE v1.5 §4.8.3, Q-30). The step list lives only here; SQL checks the format only.
import { z } from 'zod';
import { PlanDateSchema } from './ids.ts';

export const SLOTS = ['morning', 'noon', 'evening'] as const;
export const SlotSchema = z.enum(SLOTS);
export type Slot = z.infer<typeof SlotSchema>;
export const CHECKIN_STATUSES = ['opened', 'completed', 'skipped'] as const;
export const CheckinStatusSchema = z.enum(CHECKIN_STATUSES);
export type CheckinStatus = z.infer<typeof CheckinStatusSchema>;
/** 時段被打開時用的保留步驟值（只能配 status = 'opened'）。 */
export const SLOT_OPEN_STEP = 'slot' as const;
/** 各時段的步驟（初版，對應 AC-04～06、AC-07～08、AC-14～18；T-026／T-047 要改就改這裡，不用 migration）。 */
export const SLOT_STEPS = {
  morning: ['reading', 'shadowing'],
  noon: ['cards'],
  evening: ['first_answer', 'rewrite_shadow', 'no_script'],
} as const satisfies Record<Slot, readonly string[]>;
export type SlotStep = (typeof SLOT_STEPS)[Slot][number];
/** POST /checkins 的請求。 */
export const CheckinEventSchema = z
  .object({ planDate: PlanDateSchema, slot: SlotSchema, step: z.string(), status: CheckinStatusSchema })
  .superRefine((v, ctx) => {
    const steps: readonly string[] = SLOT_STEPS[v.slot];
    const valid = v.status === 'opened' ? v.step === SLOT_OPEN_STEP : steps.includes(v.step);
    if (!valid) ctx.addIssue({ code: 'custom', path: ['step'], message: 'step does not match slot/status' });
  });
export type CheckinEvent = z.infer<typeof CheckinEventSchema>;
/** 從表讀出的一列（camelCase）。 */
export const CheckinRecordSchema = z.object({
  planDate: PlanDateSchema,
  slot: SlotSchema,
  step: z.string(),
  status: CheckinStatusSchema,
  recordedAt: z.iso.datetime({ offset: true }),
});
export type CheckinRecord = z.infer<typeof CheckinRecordSchema>;
