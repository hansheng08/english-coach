import { describe, expect, it, vi } from 'vitest';
import { SW_URL, registerWith } from './register';
import type { ContainerLike, RegistrationLike, WorkerLike } from './register';
import { watchForUpdate } from './update';
import type { RegisterSW } from './update';

// QA probes for T-019 AC-T19-3、AC-T19-7（ARCHITECTURE §9、pwa.md §3.3）：舊快取已在控制頁面時的新版偵測與套用。
type Fake = WorkerLike & { current: string; fire: () => void };

function worker(state: string): { w: Fake; post: ReturnType<typeof vi.fn<(message: unknown) => void>> } {
  const listeners: (() => void)[] = [];
  const post = vi.fn<(message: unknown) => void>();
  const w: Fake = {
    current: state,
    get state() {
      return this.current;
    },
    postMessage: post,
    addEventListener: (_type: 'statechange', listener: () => void) => {
      listeners.push(listener);
    },
    fire: () => {
      for (const l of listeners) l();
    },
  };
  return { w, post };
}

function registration(waiting: WorkerLike | null) {
  const found: (() => void)[] = [];
  const reg: RegistrationLike & { installing: WorkerLike | null; waiting: WorkerLike | null } = {
    waiting,
    installing: null,
    addEventListener: (_type: 'updatefound', listener: () => void) => {
      found.push(listener);
    },
  };
  return {
    reg,
    updateFound: (next: WorkerLike) => {
      reg.installing = next;
      for (const l of found) l();
    },
  };
}

function container(controller: unknown, reg: RegistrationLike) {
  const changes: (() => void)[] = [];
  const register = vi.fn<ContainerLike['register']>(() => Promise.resolve(reg));
  const c: ContainerLike = {
    controller,
    register,
    addEventListener: (_type: 'controllerchange', listener: () => void) => {
      changes.push(listener);
    },
  };
  return {
    c,
    register,
    controllerChange: () => {
      for (const l of changes) l();
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('T-019 QA service worker update', () => {
  it('(QA-1) registers /sw.js at scope / exactly once', async () => {
    const { reg } = registration(null);
    const { c, register } = container({}, reg);
    registerWith({}, c, vi.fn());
    await flush();
    expect(SW_URL).toBe('/sw.js');
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('(QA-2) a new worker that is still installing, redundant or activating does not ask; installed under a controller asks once', async () => {
    const { reg, updateFound } = registration(null);
    const { c } = container({}, reg);
    const onNeedRefresh = vi.fn();
    registerWith({ onNeedRefresh }, c, vi.fn());
    await flush();
    const { w: next } = worker('installing');
    updateFound(next);
    reg.waiting = worker('installed').w; // an older worker may still be waiting while the new one installs
    next.fire();
    next.current = 'redundant';
    next.fire();
    expect(onNeedRefresh).not.toHaveBeenCalled();
    next.current = 'installed';
    reg.waiting = next;
    next.fire();
    expect(onNeedRefresh).toHaveBeenCalledTimes(1);
  });

  it('(QA-3) an update found during the very first install (no controller) never asks', async () => {
    const { reg, updateFound } = registration(null);
    const { c } = container(null, reg);
    const onNeedRefresh = vi.fn();
    registerWith({ onNeedRefresh }, c, vi.fn());
    await flush();
    const { w: next } = worker('installed');
    reg.waiting = next;
    updateFound(next);
    next.fire();
    expect(onNeedRefresh).not.toHaveBeenCalled();
  });

  it('(QA-4) apply sends SKIP_WAITING to the waiting worker only, and reloads once even if controllerchange fires twice', async () => {
    const { w: waiting, post } = worker('installed');
    const { reg } = registration(waiting);
    const { c, controllerChange } = container({}, reg);
    const reload = vi.fn();
    const apply = registerWith({}, c, reload);
    await flush();
    const done = apply();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    controllerChange();
    controllerChange();
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('(QA-5) nothing reloads by itself: no controllerchange listener and no reload before apply', async () => {
    const { w: waiting, post } = worker('installed');
    const { reg } = registration(waiting);
    const { c, controllerChange } = container({}, reg);
    const reload = vi.fn();
    const onNeedRefresh = vi.fn();
    registerWith({ onNeedRefresh }, c, reload);
    await flush();
    expect(onNeedRefresh).toHaveBeenCalledTimes(1);
    controllerChange();
    expect(reload).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('(QA-6) watchForUpdate hands over an apply that calls updateSW(true), once per notice, and registers once', async () => {
    let notify: (() => void) | undefined;
    const updateSW = vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve());
    const register = vi.fn<RegisterSW>((options) => {
      notify = options.onNeedRefresh;
      return updateSW;
    });
    const applies: (() => Promise<void>)[] = [];
    watchForUpdate((apply) => applies.push(apply), register);
    expect(register).toHaveBeenCalledTimes(1);
    expect(applies).toHaveLength(0);
    notify?.();
    notify?.();
    expect(applies).toHaveLength(2);
    expect(updateSW).not.toHaveBeenCalled();
    await applies[0]?.();
    expect(updateSW).toHaveBeenCalledTimes(1);
    expect(updateSW).toHaveBeenCalledWith(true);
  });
});
