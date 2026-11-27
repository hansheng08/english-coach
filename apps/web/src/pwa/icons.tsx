import type { ReactNode } from 'react';

function Svg({ size, children }: { readonly size: number; readonly children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** 斷線圖示（wifi 加斜線）。 */
export function OfflineIcon({ size = 18 }: { readonly size?: number }) {
  return (
    <Svg size={size}>
      <path d="M2 8.8a15 15 0 0 1 4-2.4M22 8.8a15 15 0 0 0-9-3.7M5 12.9a10 10 0 0 1 3.5-2M19 12.9a10 10 0 0 0-3-2M8.5 16.4a5 5 0 0 1 7 0M12 20h.01" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

/** 更新圖示（重新整理箭頭）。 */
export function UpdateIcon() {
  return (
    <Svg size={20}>
      <path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" />
    </Svg>
  );
}
