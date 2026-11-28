// @vitest-environment jsdom
import { err, ok, StoragePathSchema } from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createAudioPlayer, type PlayerDeps, type PlayerState, type PlaySource } from './player';

// QA probes for T-021 createAudioPlayer (AC-T21-11). Fake <audio>; no fixed waits.
const A: PlaySource = { kind: 'text', text: 'qa one' };
const B: PlaySource = { kind: 'text', text: 'qa two' };
const P: PlaySource = { kind: 'path', path: StoragePathSchema.parse(`00000000-0000-4000-8000-000000000021/${'d'.repeat(64)}.mp3`) };
const url = (s: PlaySource): string => `https://audio.test/${s.kind === 'text' ? s.text.replace(' ', '-') : 'p'}.mp3`;

function setup(opts: { resolve?: PlayerDeps['resolve']; rejectPlay?: boolean } = {}) {
  const audio = document.createElement('audio');
  const played: string[] = [];
  vi.spyOn(audio, 'play').mockImplementation(() => {
    played.push(audio.src);
    return opts.rejectPlay === true ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
  });
  const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
  const createAudio = vi.fn(() => audio);
  const resolve = vi.fn(opts.resolve ?? ((s: PlaySource) => Promise.resolve(ok({ url: url(s), durationMs: null }))));
  const player = createAudioPlayer({ resolve, createAudio });
  const states: PlayerState[] = [];
  const unsubscribe = player.subscribe((s) => states.push(s));
  const fire = (type: 'ended' | 'error'): void => {
    audio.dispatchEvent(new Event(type));
  };
  const untilPlayed = (n: number) =>
    vi.waitFor(() => {
      expect(played).toHaveLength(n);
    });
  return { audio, played, pause, createAudio, resolve, player, states, unsubscribe, fire, untilPlayed };
}

describe('T-021 QA audio player', () => {
  it('(QA-35) (AC-T21-11) a new play while the first is still resolving returns stopped and never plays the first url', async () => {
    let release: (v: Awaited<ReturnType<PlayerDeps['resolve']>>) => void = () => undefined;
    const slow = new Promise<Awaited<ReturnType<PlayerDeps['resolve']>>>((r) => {
      release = r;
    });
    const t = setup({ resolve: (s) => (s === A ? slow : Promise.resolve(ok({ url: url(s), durationMs: null }))) });
    const first = t.player.play(A);
    const second = t.player.play(B);
    release(ok({ url: url(A), durationMs: 10 }));
    expect(await first).toEqual(ok('stopped'));
    await t.untilPlayed(1);
    expect(t.played).toEqual([url(B)]);
    expect(t.player.getState()).toMatchObject({ kind: 'playing', source: B });
    t.fire('ended');
    expect(await second).toEqual(ok('ended'));
    expect(t.player.getState()).toEqual({ kind: 'idle' });
  });

  it('(QA-36) (AC-T21-11) one <audio> element is reused across plays, and a new play pauses the old one first', async () => {
    const t = setup();
    const first = t.player.play(A);
    await t.untilPlayed(1);
    const second = t.player.play(P);
    expect(t.pause).toHaveBeenCalled();
    expect(await first).toEqual(ok('stopped'));
    await t.untilPlayed(2);
    t.fire('ended');
    expect(await second).toEqual(ok('ended'));
    expect(t.createAudio).toHaveBeenCalledTimes(1);
    expect(t.played).toEqual([url(A), url(P)]);
  });

  it('(QA-37) (AC-T21-11) repeat 3 with two sources plays a,a,a,b,b,b with index 0..2 each, resolving each source once', async () => {
    const t = setup();
    const done = t.player.play([A, B], { repeat: 3 });
    for (let i = 1; i <= 6; i++) {
      await t.untilPlayed(i);
      t.fire('ended');
    }
    expect(await done).toEqual(ok('ended'));
    expect(t.played).toEqual([url(A), url(A), url(A), url(B), url(B), url(B)]);
    expect(t.resolve).toHaveBeenCalledTimes(2);
    const repeats = t.states.flatMap((s) => (s.kind === 'playing' ? [s.repeat] : []));
    expect(repeats).toEqual([
      { index: 0, total: 3 },
      { index: 1, total: 3 },
      { index: 2, total: 3 },
      { index: 0, total: 3 },
      { index: 1, total: 3 },
      { index: 2, total: 3 },
    ]);
  });

  it('(QA-38) (AC-T21-11) stop() mid-play goes idle, the play returns stopped, and a late ended event changes nothing', async () => {
    const t = setup();
    const done = t.player.play(A, { repeat: 2 });
    await t.untilPlayed(1);
    t.player.stop();
    expect(t.player.getState()).toEqual({ kind: 'idle' });
    expect(await done).toEqual(ok('stopped'));
    const count = t.states.length;
    t.fire('ended');
    t.fire('error');
    expect(t.states).toHaveLength(count);
    expect(t.played).toHaveLength(1);
  });

  it('(QA-39) (AC-T21-11) a rejected audio.play() (autoplay blocked) and a resolve error both end in the error state with err; the next play still works', async () => {
    const blocked = setup({ rejectPlay: true });
    const r = await blocked.player.play(A);
    expect(r.ok).toBe(false);
    expect(blocked.player.getState()).toMatchObject({ kind: 'error', source: A });

    const failing = setup({ resolve: () => Promise.resolve(err({ kind: 'rate_limited', message: 'slow down', retryable: true, retryAfterSec: 5 })) });
    const e = await failing.player.play(P);
    expect(e).toEqual(err({ kind: 'rate_limited', message: 'slow down', retryable: true, retryAfterSec: 5 }));
    expect(failing.player.getState()).toEqual({ kind: 'error', source: P, error: { kind: 'rate_limited', message: 'slow down', retryable: true, retryAfterSec: 5 } });
    expect(failing.played).toEqual([]);

    const t = setup();
    const first = t.player.play(A);
    await t.untilPlayed(1);
    t.fire('error');
    expect((await first).ok).toBe(false);
    const again = t.player.play(B);
    await t.untilPlayed(2);
    t.fire('ended');
    expect(await again).toEqual(ok('ended'));
  });

  it('(QA-40) (AC-T21-11) after unsubscribe the listener gets nothing; a throwing resolve becomes an error state, not an exception', async () => {
    const t = setup({ resolve: () => Promise.reject(new Error('offline')) });
    t.unsubscribe();
    const r = await t.player.play(A);
    expect(r.ok).toBe(false);
    expect(t.states).toEqual([]);
    expect(t.player.getState().kind).toBe('error');
  });
  it('(QA-47) (AC-T21-11) after the last repeat ends the player is idle again and the last emitted state is idle', async () => {
    const t = setup();
    const done = t.player.play(A, { repeat: 2 });
    for (let i = 1; i <= 2; i++) {
      await t.untilPlayed(i);
      t.fire('ended');
    }
    expect(await done).toEqual(ok('ended'));
    expect(t.player.getState()).toEqual({ kind: 'idle' });
    expect(t.states.at(-1)).toEqual({ kind: 'idle' });
    expect(t.states.map((s) => s.kind)).toEqual(['loading', 'playing', 'playing', 'idle']);
  });
});
