import { describe, expect, it, vi } from 'vitest';
import { registerWith } from './register';
import type { ContainerLike, RegistrationLike, WorkerLike } from './register';

function fakeWorker(state: string) {
  const listeners: (() => void)[] = [];
  const postMessage = vi.fn<(message: unknown) => void>();
  const worker: WorkerLike & { current: string } = {
    current: state,
    get state() {
      return this.current;
    },
    postMessage,
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
  };
  return {
    worker,
    postMessage,
    fire: () => {
      for (const l of listeners) l();
    },
  };
}

function fakeContainer(controller: unknown, reg: RegistrationLike) {
  const changes: (() => void)[] = [];
  const container: ContainerLike = {
    controller,
    register: vi.fn(() => Promise.resolve(reg)),
    addEventListener: (_type, listener) => {
      changes.push(listener);
    },
  };
  return {
    container,
    controllerChange: () => {
      for (const l of changes) l();
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('registerWith', () => {
  it('(AC-T19-7) (TC-9) a waiting worker under an existing controller asks for a refresh; the first install does not', async () => {
    const waiting = fakeWorker('installed').worker;
    const update = { waiting, installing: null, addEventListener: vi.fn() } satisfies RegistrationLike;
    const onNeedRefresh = vi.fn();
    registerWith({ onNeedRefresh }, fakeContainer({}, update).container, vi.fn());
    await flush();
    expect(onNeedRefresh).toHaveBeenCalledTimes(1);

    const first = vi.fn();
    registerWith({ onNeedRefresh: first }, fakeContainer(null, update).container, vi.fn());
    await flush();
    expect(first).not.toHaveBeenCalled();
  });

  it('(AC-T19-7) (TC-9) a worker found later asks for a refresh once it is installed', async () => {
    const found = fakeWorker('installing');
    let updateFound: () => void = () => undefined;
    const reg: RegistrationLike = {
      // 真的 registration 在 worker 裝好後才把它放進 waiting。
      get waiting() {
        return found.worker.current === 'installed' ? found.worker : null;
      },
      installing: found.worker,
      addEventListener: (_type, listener) => {
        updateFound = listener;
      },
    };
    const onNeedRefresh = vi.fn();
    registerWith({ onNeedRefresh }, fakeContainer({}, reg).container, vi.fn());
    await flush();
    updateFound();
    found.fire();
    expect(onNeedRefresh).not.toHaveBeenCalled();
    found.worker.current = 'installed';
    found.fire();
    expect(onNeedRefresh).toHaveBeenCalledTimes(1);
  });

  it('(AC-T19-7) (TC-10) apply posts SKIP_WAITING and reloads once the new worker takes control', async () => {
    const { worker: waiting, postMessage } = fakeWorker('installed');
    const reg: RegistrationLike = { waiting, installing: null, addEventListener: vi.fn() };
    const { container, controllerChange } = fakeContainer({}, reg);
    const reload = vi.fn();
    const apply = registerWith({}, container, reload);
    await flush();
    const done = apply(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    controllerChange();
    controllerChange();
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('(AC-T19-17) (TC-27) apply reloads once when another tab already activated the new version, without posting anything', async () => {
    const { worker, postMessage } = fakeWorker('installed');
    let waiting: WorkerLike | null = worker;
    const reg: RegistrationLike = {
      get waiting() {
        return waiting;
      },
      installing: null,
      addEventListener: vi.fn(),
    };
    const onNeedRefresh = vi.fn();
    const reload = vi.fn();
    const apply = registerWith({ onNeedRefresh }, fakeContainer({}, reg).container, reload);
    await flush();
    expect(onNeedRefresh).toHaveBeenCalledTimes(1);
    waiting = null;
    await apply(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('(AC-T19-3) (TC-4) without service worker support nothing is registered and apply resolves', async () => {
    const apply = registerWith({}, undefined, vi.fn());
    await expect(apply(true)).resolves.toBeUndefined();
  });

  it('(AC-T19-3) (TC-4) a failed registration is swallowed', async () => {
    const container: ContainerLike = { controller: null, register: () => Promise.reject(new Error('blocked')), addEventListener: vi.fn() };
    const onNeedRefresh = vi.fn();
    registerWith({ onNeedRefresh }, container, vi.fn());
    await flush();
    expect(onNeedRefresh).not.toHaveBeenCalled();
  });
});
