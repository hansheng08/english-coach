// ADR-008 修訂 5 第 18 條的合法範例：adapter 可以 import zod 與同資料夾的檔案。
import { z } from 'zod';
import { adapter } from './adapter';
export const goodZod = [z.string(), adapter];
