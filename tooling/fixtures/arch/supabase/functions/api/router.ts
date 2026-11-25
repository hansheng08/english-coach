// ADR-008 修訂 5 第 19 條的違規範例：只有 providers/wiring.ts 可以 import config/provider-keys.ts。
import { providerKeys } from '../_shared/config/provider-keys';
export const router = providerKeys;
