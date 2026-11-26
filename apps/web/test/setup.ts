import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// 可控制結果的 matchMedia stub：setMedia('(prefers-color-scheme: dark)', true) 後會通知 change 監聽。
const state = new Map<string, boolean>();
const instances = new Map<string, Set<FakeMql>>();

class FakeMql extends EventTarget implements MediaQueryList {
  readonly media: string;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;

  constructor(media: string) {
    super();
    this.media = media;
  }

  get matches(): boolean {
    return state.get(this.media) ?? false;
  }

  addListener(): void {}

  removeListener(): void {}
}

export function setMedia(query: string, matches: boolean): void {
  state.set(query, matches);
  for (const mql of instances.get(query) ?? []) {
    mql.dispatchEvent(Object.assign(new Event('change'), { matches, media: query }));
  }
}

export function resetMedia(): void {
  state.clear();
  instances.clear();
}

function matchMedia(query: string): MediaQueryList {
  const mql = new FakeMql(query);
  const bag = instances.get(query) ?? new Set<FakeMql>();
  bag.add(mql);
  instances.set(query, bag);
  return mql;
}

beforeEach(() => {
  resetMedia();
  window.matchMedia = matchMedia;
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(cleanup);
