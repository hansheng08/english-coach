import { ChunkTextSchema } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { detectChunkHits, scoreChunkHits } from './chunk-hit.ts';
import type { ChunkHit } from './chunk-hit.ts';
import * as domain from './index.ts';
import { IRREGULAR_VERB_FORMS } from './irregular-verbs.ts';

function first(transcript: string, target: string): ChunkHit {
  const hit = detectChunkHits(transcript, [target])[0];
  if (hit === undefined) throw new Error('no hit');
  return hit;
}
const level = (transcript: string, target: string): string => first(transcript, target).level;

describe('detectChunkHits normalization', () => {
  it('(AC-T13-3) (TC-5) ignores case and edge punctuation', () => {
    expect(level('We need to TAKE OWNERSHIP, of it.', 'take ownership of')).toBe('full');
  });

  it('(AC-T13-3) (TC-6) treats hyphen as a space in both directions', () => {
    expect(level('we got buy in', 'buy-in')).toBe('full');
    expect(level('we got buy-in', 'buy in')).toBe('full');
  });

  it('(AC-T13-3) (TC-7) matches curly-quote possessives', () => {
    expect(level('make up Tom’s mind', "make up one's mind")).toBe('full');
  });

  it('(AC-T13-4) (TC-8) requires whole words', () => {
    expect(level('I left my umbrella', 'um')).toBe('none');
  });
});

describe('detectChunkHits word forms', () => {
  it('(AC-T13-5) (TC-9) matches every regular inflection', () => {
    const pairs: [string, string][] = [
      ['push', 'pushes'],
      ['fix', 'fixes'],
      ['prioritize', 'prioritized'],
      ['prioritize', 'prioritizing'],
      ['apply', 'applies'],
      ['apply', 'applied'],
      ['ship', 'shipped'],
      ['ship', 'shipping'],
      ['align', 'aligns'],
      ['align', 'aligned'],
      ['align', 'aligning'],
    ];
    for (const [target, said] of pairs) expect(level(`we ${said} it`, target)).toBe('full');
  });

  it('(AC-T13-5) (TC-10) does not match derived words outside the rules', () => {
    expect(level('the shipment arrived', 'ship')).toBe('none');
    expect(level('that is pushy', 'push')).toBe('none');
  });

  it('(AC-T13-6) (TC-11) matches irregular forms', () => {
    expect(level('she took it', 'take')).toBe('full');
    expect(level('it was taken', 'take')).toBe('full');
    expect(level('it was fine', 'be')).toBe('full');
    expect(level('he led it', 'lead')).toBe('full');
  });

  it('(AC-T13-6) (TC-12) has at least 90 irregular verbs including the required list', () => {
    expect(IRREGULAR_VERB_FORMS.size).toBeGreaterThanOrEqual(90);
    const required = [
      'be', 'have', 'do', 'go', 'take', 'make', 'get', 'give', 'come', 'see', 'know', 'think', 'say', 'tell', 'find',
      'bring', 'buy', 'build', 'write', 'run', 'lead', 'keep', 'hold', 'set', 'put', 'break', 'choose', 'drive',
      'speak', 'understand', 'begin', 'fall', 'feel', 'grow', 'leave', 'lose', 'meet', 'pay', 'send', 'spend',
      'stand', 'teach', 'win',
    ];
    for (const v of required) expect(IRREGULAR_VERB_FORMS.has(v)).toBe(true);
    expect(IRREGULAR_VERB_FORMS.get('be')).toHaveLength(7);
  });
});

describe('detectChunkHits placeholders', () => {
  it('(AC-T13-7) (TC-13) trailing placeholder takes at least one word', () => {
    expect(level('we need to get buy-in from the whole team', 'get buy-in from sb')).toBe('full');
  });

  it('(AC-T13-7) (TC-14) placeholder spans 4 words', () => {
    expect(level('get the whole product team on board', 'get sb on board')).toBe('full');
  });

  it('(AC-T13-7) (TC-15) placeholder spanning 5 words is partial', () => {
    expect(level('get the whole new product team on board', 'get sb on board')).toBe('partial');
  });

  it('(AC-T13-7) (TC-16) trailing placeholder without a word is partial', () => {
    expect(level('we need to get buy-in from', 'get buy-in from sb')).toBe('partial');
  });

  it('(AC-T13-7) (TC-17) possessive placeholder matches one possessive word only', () => {
    const t = "make up one's mind";
    expect(level('make up her mind', t)).toBe('full');
    expect(level("make up Tom's mind", t)).toBe('full');
    expect(level("make up the manager's mind", t)).toBe('partial');
  });
});

describe('detectChunkHits partial threshold', () => {
  const t = 'take ownership of results';

  it('(AC-T13-8) (TC-18) accepts a 6-word range', () => {
    expect(level('we take on a lot more ownership', t)).toBe('partial');
  });

  it('(AC-T13-8) (TC-19) rejects a 7-word range', () => {
    expect(level('we take on a whole lot more ownership', t)).toBe('none');
  });

  it('(AC-T13-8) (TC-20) needs at least half of the words', () => {
    expect(level('we take a break', t)).toBe('none');
    expect(level('I will make it', "make up one's mind")).toBe('none');
  });

  it('(AC-T13-8) (TC-21) single-word and empty targets never score partial', () => {
    expect(level('we use a lever', 'leverage')).toBe('none');
    expect(level('we are leveraging it', 'leverage')).toBe('full');
    expect(level('we are leveraging it', 'sb')).toBe('none');
    expect(level('we are leveraging it', '')).toBe('none');
  });
});

describe('scoring', () => {
  it('(AC-T13-9) (TC-22) scores full hits in target order', () => {
    const hits = detectChunkHits('we need to get buy-in from the whole team and take full ownership', [
      'take ownership of results',
      'get buy-in from sb',
      "make up one's mind",
    ]);
    expect(hits.map((h) => h.level)).toEqual(['partial', 'full', 'none']);
    expect(scoreChunkHits(hits)).toBe(1);
  });

  it('(AC-T13-9) (TC-23) partial adds no points', () => {
    const hits: ChunkHit[] = [
      { target: 'a', level: 'full', matchedText: 'a' },
      { target: 'b', level: 'partial', matchedText: 'b' },
      { target: 'c', level: 'none', matchedText: null },
    ];
    expect(scoreChunkHits(hits)).toBe(1);
    expect(scoreChunkHits([])).toBe(0);
  });

  it('(AC-T13-9) (TC-24) handles empty input and duplicates', () => {
    const empty = detectChunkHits('', ['take ownership', 'get buy-in']);
    expect(empty.map((h) => h.level)).toEqual(['none', 'none']);
    expect(empty.map((h) => h.matchedText)).toEqual([null, null]);
    expect(detectChunkHits('we take ownership', [])).toEqual([]);
    const dup = detectChunkHits('we take ownership', ['take ownership', 'take ownership']);
    expect(dup[0]).toEqual(dup[1]);
    expect(dup[0]?.level).toBe('full');
  });
});

describe('matchedText', () => {
  it('(AC-T13-10) (TC-25) full match text uses the leftmost shortest range', () => {
    expect(first('we need to get buy-in from the whole team', 'get buy-in from sb').matchedText).toBe('get buy in from the');
    expect(first('get the whole product team on board', 'get sb on board').matchedText).toBe(
      'get the whole product team on board',
    );
    expect(
      first('We took ownership of it, then we take ownership of more.', 'take ownership of').matchedText,
    ).toBe('took ownership of');
  });

  it('(AC-T13-10) (TC-26) partial match text spans first to last matched word', () => {
    expect(first('we take on a lot more ownership', 'take ownership of results').matchedText).toBe(
      'take on a lot more ownership',
    );
  });
});

describe('package exports', () => {
  it('(AC-T13-11) (TC-27) exposes the public names', () => {
    expect(typeof domain.detectChunkHits).toBe('function');
    expect(typeof domain.scoreChunkHits).toBe('function');
    expect(ChunkTextSchema.safeParse('take ownership').success).toBe(true);
    const hit: domain.ChunkHit = { target: 'x', level: 'none' satisfies domain.ChunkHitLevel, matchedText: null };
    expect(hit.level).toBe('none');
  });
});
