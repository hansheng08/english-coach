// @vitest-environment jsdom
import { err, ok, StoragePathSchema } from '@english-coach/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createAudioPlayer, type PlayerState, type PlaySource } from './player';

const A: PlaySource = { kind: 'text', text: 'First sentence.' };
const B: PlaySource = { kind: 'path', path: StoragePathSchema.parse(`00000000-0000-4000-8000-0000000000aa/${'c'.repeat(64)}.mp3`) };
const urlOf = (source: PlaySource): string => (source.kind === 'text' ? 'https://audio.test/a.mp3' : 'https://audio.test/b.mp3');

function setup(resolveImpl?: Parameters<typeof createAudioPlayer>[0]['resolve']) {
  const audio = document.createElement('audio');
  const played: string[] = [];
  const play = vi.spyOn(audio, 'play').mockImplementation(() => {
    played.push(audio.src);
    return Promise.resolve();
  });
  const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
  const createAudio = vi.fn(() => audio);
  const resolve = vi.fn(resolveImpl ?? ((source: PlaySource) => Promise.resolve(ok({ url: urlOf(source), durationMs: null }))));
  const player = createAudioPlayer({ resolve, createAudio });
  const states: PlayerState[] = [];
  player.subscribe((s) => states.push(s));
  const ended = (): void => {
    audio.dispatchEvent(new Event('ended'));
  };
  const untilPlayed = (count: number) =>
    vi.waitFor(() => {
      expect(played).toHaveLength(count);
    });
  return { audio, player, states, played, play, pause, createAudio, resolve, ended, untilPlayed };
}

describe('createAudioPlayer play (AC-T21-11)', () => {
  it('(AC-T21-11) (TC-14) goes idle → loading → playing (index 0..total-1) → idle and returns ok("ended")', async () => {
    const t = setup();
    const done = t.player.play(A, { repeat: 2 });
    await t.untilPlayed(1);
    expect(t.player.getState()).toEqual({ kind: 'playing', source: A, repeat: { index: 0, total: 2 } });
    t.ended();
    await t.untilPlayed(2);
    t.ended();
    expect(await done).toEqual(ok('ended'));
    expect(t.states.map((s) => s.kind)).toEqual(['loading', 'playing', 'playing', 'idle']);
    expect(t.states[2]).toEqual({ kind: 'playing', source: A, repeat: { index: 1, total: 2 } });
    expect(t.player.getState()).toEqual({ kind: 'idle' });
    expect(t.resolve).toHaveBeenCalledTimes(1);
  });

  it('(AC-T21-11) (TC-14) a single play without options plays once', async () => {
    const t = setup();
    const done = t.player.play(A);
    await t.untilPlayed(1);
    expect(t.player.getState()).toMatchObject({ kind: 'playing', repeat: { index: 0, total: 1 } });
    t.ended();
    expect(await done).toEqual(ok('ended'));
  });
});

describe('createAudioPlayer interruption and queue (AC-T21-11)', () => {
  it('(AC-T21-11) (TC-15) a new play stops the old one (ok("stopped")) and only one <audio> exists', async () => {
    const t = setup();
    const first = t.player.play(A);
    await t.untilPlayed(1);
    const second = t.player.play(B);
    expect(await first).toEqual(ok('stopped'));
    await t.untilPlayed(2);
    expect(t.pause).toHaveBeenCalled();
    expect(t.createAudio).toHaveBeenCalledTimes(1);
    expect(t.player.getState()).toMatchObject({ kind: 'playing', source: B });
    t.ended();
    expect(await second).toEqual(ok('ended'));
  });

  it('(AC-T21-11) (TC-15) several sources play in order: b starts only after a ended', async () => {
    const t = setup();
    const done = t.player.play([A, B]);
    await t.untilPlayed(1);
    expect(t.played).toEqual(['https://audio.test/a.mp3']);
    t.ended();
    await t.untilPlayed(2);
    expect(t.played).toEqual(['https://audio.test/a.mp3', 'https://audio.test/b.mp3']);
    t.ended();
    expect(await done).toEqual(ok('ended'));
    expect(t.player.getState()).toEqual({ kind: 'idle' });
  });

  it('(AC-T21-11) (TC-15) stop() while playing goes idle, pauses, and the play resolves ok("stopped")', async () => {
    const t = setup();
    const done = t.player.play(A);
    await t.untilPlayed(1);
    t.player.stop();
    expect(t.player.getState()).toEqual({ kind: 'idle' });
    expect(t.pause).toHaveBeenCalled();
    expect(await done).toEqual(ok('stopped'));
  });
});

describe('createAudioPlayer errors and subscription (AC-T21-11)', () => {
  it('(AC-T21-11) (TC-16) a failing resolve gives the error state with the error and an err result', async () => {
    const error = { kind: 'timeout', message: 'too slow', retryable: true } as const;
    const t = setup(() => Promise.resolve(err(error)));
    expect(await t.player.play(A)).toEqual(err(error));
    expect(t.player.getState()).toEqual({ kind: 'error', source: A, error });
    expect(t.play).not.toHaveBeenCalled();
  });

  it('(AC-T21-11) (TC-16) an <audio> error event gives the error state and an err result; the next play works again', async () => {
    const t = setup();
    const failed = t.player.play(A);
    await t.untilPlayed(1);
    t.audio.dispatchEvent(new Event('error'));
    const r = await failed;
    expect(r.ok).toBe(false);
    expect(t.player.getState()).toMatchObject({ kind: 'error', source: A });
    const retry = t.player.play(A);
    await t.untilPlayed(2);
    t.ended();
    expect(await retry).toEqual(ok('ended'));
  });

  it('(AC-T21-11) (TC-16) after unsubscribing the listener gets no more states', async () => {
    const t = setup();
    const listener = vi.fn();
    const off = t.player.subscribe(listener);
    off();
    const done = t.player.play(A);
    await t.untilPlayed(1);
    t.ended();
    await done;
    expect(listener).not.toHaveBeenCalled();
    expect(t.states.length).toBeGreaterThan(0);
  });
});
