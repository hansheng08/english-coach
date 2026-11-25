import { ChunkTextSchema } from '@english-coach/contracts';
import { describe, expect, it } from 'vitest';
import { detectChunkHits, scoreChunkHits } from './chunk-hit.ts';
import type { ChunkHit } from './chunk-hit.ts';
import { IRREGULAR_VERB_FORMS } from './irregular-verbs.ts';

// QA probes for T-013 (docs/tasks/T-013.md v2.0, ARCHITECTURE §4.7). Behaviour follows the ticket's 「介面」.
function hit(transcript: string, target: string): ChunkHit {
  const h = detectChunkHits(transcript, [target])[0];
  if (h === undefined) throw new Error('no hit');
  return h;
}
const lv = (transcript: string, target: string): string => hit(transcript, target).level;
const mt = (transcript: string, target: string): string | null => hit(transcript, target).matchedText;

describe('T-013 QA normalization order', () => {
  it('(QA-1) curly quotes become straight quotes before normalizeWords, so a curly quote mark is kept like a straight one', () => {
    // Ticket order: ‘’ → ' first, then normalizeWords keeps edge "'" (T-010 definition).
    expect(lv('‘take ownership of’ now', 'take ownership of')).toBe('none');
    expect(lv("'take ownership of' now", 'take ownership of')).toBe('none');
    expect(lv('make up the team’s mind', "make up one's mind")).toBe('partial');
    expect(mt('make up THE BOSS’S mind', "make up one's mind")).toBe('make up');
    expect(mt('make up Tom’s mind!', "make up one's mind")).toBe("make up tom's mind");
  });

  it('(QA-2) hyphens become spaces before normalizeWords splits words', () => {
    expect(lv('we got buy-(in) today', 'buy in')).toBe('full');
    expect(mt('we got buy-(in) today', 'buy in')).toBe('buy in');
    expect(lv('take ownership-of', 'take ownership of')).toBe('full');
    expect(lv('we got buy—in', 'buy-in')).toBe('none');
  });

  it('(QA-3) targets are normalized the same way as the transcript', () => {
    expect(lv('make up Tom’s mind', 'make up one’s mind')).toBe('full');
    expect(lv('we Take Ownership', 'TAKE ownership')).toBe('full');
    expect(lv('we got buy in', 'Buy-In')).toBe('full');
  });
});

describe('T-013 QA full matches', () => {
  it('(QA-4) full takes the leftmost start among several candidates', () => {
    expect(mt('get a on board get b c on board', 'get sb on board')).toBe('get a on board');
    expect(mt('I think we have it to do', 'sb to do')).toBe('think we have it to do');
  });

  it('(QA-5) each placeholder takes the fewest words that work', () => {
    expect(mt('get the team on board team on board', 'get sb on board')).toBe('get the team on board');
    expect(mt('get on board on board', 'get sb on board')).toBe('get on board on board');
    expect(mt('get buy-in from a b c d', 'get buy-in from sb')).toBe('get buy in from a');
    expect(mt('get buy-in from him', 'get buy-in from sb')).toBe('get buy in from him');
  });

  it('(QA-6) every gap placeholder spans 1 to 4 words', () => {
    for (const p of ['sb', 'someone', 'somebody', 'sth', 'something']) {
      expect(lv('tell a b c d now', `tell ${p} now`)).toBe('full');
      expect(lv('tell a b c d e now', `tell ${p} now`)).toBe('partial');
      expect(lv('tell now', `tell ${p} now`)).toBe('partial');
    }
  });

  it('(QA-7) possessive placeholders take exactly one possessive word', () => {
    for (const p of ["one's", "sb's", "someone's"]) {
      for (const w of ['my', 'your', 'his', 'her', 'its', 'our', 'their', "jane's", "it's"]) {
        expect(lv(`make up ${w} mind`, `make up ${p} mind`)).toBe('full');
      }
      expect(lv('make up the mind', `make up ${p} mind`)).toBe('partial');
      expect(lv('make up mind', `make up ${p} mind`)).toBe('partial');
      expect(lv("make up his jane's mind", `make up ${p} mind`)).toBe('partial');
      expect(lv('make up this mind', `make up ${p} mind`)).toBe('partial');
      expect(lv('make up hers mind', `make up ${p} mind`)).toBe('partial');
    }
  });

  it('(QA-8) single-word chunk with a possessive placeholder is full or none, never partial', () => {
    expect(lv('it is my call', "one's call")).toBe('full');
    expect(lv('it is the call', "one's call")).toBe('none');
    expect(lv('call it', 'sb call')).toBe('none');
    expect(lv('it is the call', 'sb call')).toBe('full');
  });
});

describe('T-013 QA partial matches', () => {
  const t = 'take ownership of results';

  it('(QA-9) partial takes the leftmost qualifying range, not the shortest one overall', () => {
    expect(mt('take a b c ownership then take ownership', t)).toBe('take a b c ownership');
    expect(lv('take a b c ownership then take ownership', t)).toBe('partial');
  });

  it('(QA-10) partial takes the shortest range from that start', () => {
    expect(mt('ownership of results take', t)).toBe('ownership of');
    expect(mt('so of results', t)).toBe('of results');
    expect(mt('take x ownership y of', t)).toBe('take x ownership');
  });

  it('(QA-11) partial counts words in order only', () => {
    expect(lv('results of ownership take', t)).toBe('none');
    expect(lv('we take take take it', t)).toBe('none');
    expect(lv('so ownership ownership', t)).toBe('none');
    expect(lv('board on', 'get sb on board')).toBe('none');
    expect(lv('on x board', 'get sb on board')).toBe('partial');
  });

  it('(QA-12) partial needs ceil(n/2) words for odd and even n', () => {
    // n = 5 → need 3 within 7 words
    const five = 'take full ownership of the results';
    expect(lv('take a b ownership c d of', five)).toBe('partial');
    expect(lv('take a b c d e ownership', five)).toBe('none');
    // n = 2 → need 1 within 4 words
    expect(lv('we take it', 'take ownership')).toBe('partial');
    expect(mt('we take it', 'take ownership')).toBe('take');
  });
});

describe('T-013 QA word forms', () => {
  it('(QA-13) consonant+y only for ies/ied; doubling only after a consonant', () => {
    expect(lv('we plaied', 'play')).toBe('none');
    expect(lv('we plays', 'play')).toBe('full');
    expect(lv('we gooing', 'go')).toBe('none');
    expect(lv('we making it', 'make')).toBe('full');
    expect(lv('we makeing it', 'make')).toBe('full');
    expect(lv('we makd it', 'make')).toBe('none');
  });

  it('(QA-14) irregular table has the required base forms and every be form', () => {
    for (const f of ['am', 'is', 'are', 'was', 'were', 'been', 'being']) expect(lv(`it ${f} fine`, 'be')).toBe('full');
    for (const [base, forms] of IRREGULAR_VERB_FORMS) {
      expect(new Set(forms).size).toBe(forms.length);
      for (const f of forms) expect(lv(`we ${f} it`, base)).toBe('full');
    }
    expect(lv('we go there', 'went')).toBe('none');
  });
});

describe('T-013 QA schema and purity', () => {
  it('(QA-15) ChunkTextSchema edge cases', () => {
    for (const v of ['A', "sb's call", 'x', 'Get Buy-In']) expect(ChunkTextSchema.safeParse(v).success).toBe(true);
    for (const v of ["'", 'a1', 'a\nb', 'a\u00a0b', 'a\u3000b', 'take, ownership', 'a.b', ' ', "''", '-a1']) {
      expect(ChunkTextSchema.safeParse(v).success).toBe(false);
    }
    expect(ChunkTextSchema.safeParse(42).success).toBe(false);
  });

  it('(QA-16) does not mutate inputs and scores only full hits', () => {
    const targets = Object.freeze(['take ownership of results', 'get buy-in from sb', 'leverage', 'take ownership of results']);
    const hits = detectChunkHits('we need to get buy-in from them and take full ownership', targets);
    expect(targets).toEqual(['take ownership of results', 'get buy-in from sb', 'leverage', 'take ownership of results']);
    expect(hits.map((h) => h.target)).toEqual([...targets]);
    expect(hits.map((h) => h.level)).toEqual(['partial', 'full', 'none', 'partial']);
    expect(scoreChunkHits(hits)).toBe(1);
    expect(scoreChunkHits([...hits, ...hits])).toBe(2);
    expect(detectChunkHits('   ', ['leverage'])).toEqual([{ target: 'leverage', level: 'none', matchedText: null }]);
  });
});
