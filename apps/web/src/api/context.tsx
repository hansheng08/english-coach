import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ApiRuntime } from './client';

const ApiContext = createContext<ApiRuntime | null>(null);

export function ApiProvider({ runtime, children }: { readonly runtime: ApiRuntime; readonly children: ReactNode }) {
  return <ApiContext.Provider value={runtime}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiRuntime {
  const runtime = useContext(ApiContext);
  if (runtime === null) throw new Error('useApi must be used inside <ApiProvider>');
  return runtime;
}
