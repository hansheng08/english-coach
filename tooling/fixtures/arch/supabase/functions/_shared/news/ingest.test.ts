// ADR-008 rev 6 #20 legal example: a news test file may import a fake provider's test helper.
import { fakeProvider } from '../providers/test/fake-provider';
export const used = fakeProvider;
