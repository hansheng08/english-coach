// ADR-008 修訂 5 第 18 條的違規範例：adapter 不得 import config（金鑰由工廠參數傳入）。
import { z } from 'zod';
import { env } from '../../config/env';
export const client = [z.string(), env];
