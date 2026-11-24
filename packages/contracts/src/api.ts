import { z } from 'zod';
import { ApiErrorBodySchema } from './errors.ts';
import { CardIdSchema, LlmModelIdSchema } from './ids.ts';

/** /cards/generate 回給前端的 NDJSON，每行一個事件（跨網路，有 zod）。順序：chunk → example → synonyms → done；中途失敗送 error 後結束。 */
export const CardStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chunk'), chunk: z.string().min(1), meaningZh: z.string() }),
  z.object({ type: z.literal('example'), en: z.string(), zh: z.string() }),
  z.object({ type: z.literal('synonyms'), items: z.array(z.string()).min(2) }),
  z.object({ type: z.literal('done'), cardId: CardIdSchema, meta: z.object({ llmModel: LlmModelIdSchema }) }),
  z.object({ type: z.literal('error'), error: ApiErrorBodySchema.shape.error }),
]);
export type CardStreamEvent = z.infer<typeof CardStreamEventSchema>;

/** GET /health 的回應（ADR-010 決定 2 第 4 點）。 */
export const HealthResponseSchema = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
