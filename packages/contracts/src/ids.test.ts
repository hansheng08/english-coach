import { describe, expect, it } from 'vitest';
import {
  AnswerIdSchema,
  ArticleIdSchema,
  CardIdSchema,
  NewsCategorySchema,
  NtdSchema,
  PlanDateSchema,
  ProviderIdSchema,
  QuestionIdSchema,
  StoragePathSchema,
  UserIdSchema,
  addNtd,
  subNtdFloor0,
} from './ids.ts';
import { expectOk } from '../test/index.ts';
import { err, ok } from './result.ts';

const UUID = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f7a8b9c';

describe('ID schemas', () => {
  const schemas = {
    UserIdSchema,
    CardIdSchema,
    AnswerIdSchema,
    QuestionIdSchema,
    ArticleIdSchema,
  };
  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} accepts a UUID`, () => {
      expect(schema.safeParse(UUID).success).toBe(true);
    });
    it(`${name} rejects a non-UUID`, () => {
      expect(schema.safeParse('not-a-uuid').success).toBe(false);
      expect(schema.safeParse('').success).toBe(false);
      expect(schema.safeParse(123).success).toBe(false);
    });
  }
});

describe('PlanDateSchema', () => {
  it('accepts a valid date', () => {
    expect(PlanDateSchema.safeParse('2026-11-23').success).toBe(true);
  });
  for (const bad of ['2026-13-01', '2026-1-5', '2026-02-30', '20261123', '']) {
    it(`rejects "${bad}"`, () => {
      expect(PlanDateSchema.safeParse(bad).success).toBe(false);
    });
  }
});

describe('StoragePathSchema', () => {
  it('accepts <user_id>/<path>', () => {
    expect(StoragePathSchema.safeParse(`${UUID}/resume/cv.pdf`).success).toBe(true);
  });
  it('rejects a path without the user_id prefix', () => {
    expect(StoragePathSchema.safeParse('resume/cv.pdf').success).toBe(false);
    expect(StoragePathSchema.safeParse(UUID).success).toBe(false);
    expect(StoragePathSchema.safeParse(`${UUID}/`).success).toBe(false);
  });
});

describe('NtdSchema', () => {
  it('accepts non-negative integers', () => {
    expect(NtdSchema.safeParse(0).success).toBe(true);
    expect(NtdSchema.safeParse(300).success).toBe(true);
  });
  for (const bad of [-1, 1.5, Number.NaN, '5']) {
    it(`rejects ${String(bad)}`, () => {
      expect(NtdSchema.safeParse(bad).success).toBe(false);
    });
  }
});

describe('addNtd / subNtdFloor0', () => {
  const n = (v: number) => expectOk(NtdSchema.safeParse(v).success ? ok(NtdSchema.parse(v)) : err('bad'));
  it('adds', () => {
    expect(addNtd(n(100), n(50))).toBe(150);
  });
  it('subtracts', () => {
    expect(subNtdFloor0(n(100), n(40))).toBe(60);
  });
  it('floors at 0 when the result would be negative', () => {
    expect(subNtdFloor0(n(10), n(40))).toBe(0);
  });
});

describe('literal unions', () => {
  it('NewsCategorySchema and ProviderIdSchema accept members and reject others', () => {
    expect(NewsCategorySchema.safeParse('ai').success).toBe(true);
    expect(NewsCategorySchema.safeParse('sports').success).toBe(false);
    expect(ProviderIdSchema.safeParse('gemini-paid').success).toBe(true);
    expect(ProviderIdSchema.safeParse('openai').success).toBe(false);
  });
});
