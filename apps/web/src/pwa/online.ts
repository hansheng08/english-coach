/** 先用目前的 navigator.onLine 呼叫一次，之後跟著 online／offline；回傳取消訂閱的函式（NFR-06）。 */
export function subscribeOnlineStatus(onChange: (online: boolean) => void, target: Window = window): () => void {
  const goOnline = () => {
    onChange(true);
  };
  const goOffline = () => {
    onChange(false);
  };
  onChange(target.navigator.onLine);
  target.addEventListener('online', goOnline);
  target.addEventListener('offline', goOffline);
  return () => {
    target.removeEventListener('online', goOnline);
    target.removeEventListener('offline', goOffline);
  };
}
