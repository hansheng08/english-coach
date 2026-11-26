import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { LoadedApi } from './client.ts';

const ApiContext = createContext<LoadedApi | null>(null);

export function ApiProvider({ value, children }: { readonly value: LoadedApi; readonly children: ReactNode }) {
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): LoadedApi {
  const value = useContext(ApiContext);
  if (value === null) throw new Error('useApi must be used inside <ApiProvider>');
  return value;
}
