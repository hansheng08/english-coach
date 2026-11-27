import { useEffect, useState } from 'react';
import { subscribeOnlineStatus } from './online';
import { watchForUpdate } from './update';
import type { RegisterSW } from './update';

/** 目前是否有網路（navigator.onLine，之後跟著 online／offline）。 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => window.navigator.onLine);
  useEffect(() => subscribeOnlineStatus(setOnline), []);
  return online;
}

/** 有新版時回傳 apply，否則 null。register 只在掛載時註冊一次。 */
export function useUpdateApply(register?: RegisterSW): (() => Promise<void>) | null {
  const [apply, setApply] = useState<(() => Promise<void>) | null>(null);
  useEffect(() => {
    watchForUpdate((next) => {
      setApply(() => next);
    }, register);
  }, [register]);
  return apply;
}
