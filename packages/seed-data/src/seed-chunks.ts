import { SeedBatchSchema, SeedChunkSchema, err, ok } from '@english-coach/contracts';
import type { Result, SeedBatch, ValidationError, ValidationIssue } from '@english-coach/contracts';
import { detectChunkHits, normalizeWords } from '@english-coach/domain';

/** ARCHITECTURE §4.10 資料規則的編號；`shape` 表示輸入的形狀根本不合。 */
type Rule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'shape';

const RULE_TEXT: Record<Rule, string> = {
  R1: 'chunk must be 2 to 6 words in the ARCHITECTURE §4.7 format',
  R2: 'meaning_zh must be 1 to 30 characters with a Han character, no outer whitespace and no control characters',
  R3: 'example_en must be 5 to 25 words with no outer whitespace, no "/" and no line breaks',
  R4: 'example_en must contain the chunk',
  R5: 'tags must be 0 to 3 unique values from SEED_TAGS',
  R6: 'duplicate chunk after normalization',
  R7: 'items must have exactly SEED_BATCH_SIZE entries',
  R8: 'batch must be an integer from 1 to 6 with a matching batch-<n>.json file name, used by one file only',
  shape: 'input has the wrong shape',
};

type Found = { readonly rule: Rule; readonly path: string; readonly detail: string | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ITEM_FIELD_RULE: Record<string, Rule> = { chunk: 'R1', meaning_zh: 'R2', example_en: 'R3', tags: 'R5' };

/** zod 的 issue 依欄位對應回規則編號（R1、R2、R3、R5、R7、R8），形狀不合回 `shape`。 */
function ruleOfPath(path: readonly PropertyKey[], code: string): Rule {
  const [head, index, field] = path;
  if (head === undefined) return 'shape';
  if (head === 'batch') return 'R8';
  if (head !== 'items') return 'shape';
  if (index === undefined) return code === 'invalid_type' ? 'shape' : 'R7';
  if (field === undefined) return 'shape';
  return typeof field === 'string' ? (ITEM_FIELD_RULE[field] ?? 'shape') : 'shape';
}

/** `chunk` 的正規化（§4.7）：連字號換空白、`normalizeWords`、用一個空白接回。 */
function chunkKey(chunk: string): string {
  return normalizeWords(chunk.replace(/-/g, ' ')).join(' ');
}

const FILE_NAME = /^batch-([1-9][0-9]*)\.json$/;

function basename(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? '';
}

function rawItems(data: unknown): readonly unknown[] {
  const items: unknown = isRecord(data) ? data['items'] : undefined;
  return Array.isArray(items) ? items : [];
}

/** issue 的 path 只留到欄位層級：`items.<i>.<field>`、`items`、`batch`。 */
function fieldPath(path: readonly PropertyKey[]): string {
  const depth = path[0] === 'items' ? 3 : 1;
  return path.slice(0, depth).map(String).join('.');
}

/** R4、R6：只看 `chunk` 通過 R1 的項目；R4 另外要 `example_en` 是字串。 */
function crossChecks(data: unknown, others: readonly SeedBatch[]): Found[] {
  const found: Found[] = [];
  const chunkSchema = SeedChunkSchema.shape.chunk;
  const seen = new Map<string, string>();
  for (const other of others) {
    other.items.forEach((item, i) => {
      const key = chunkKey(item.chunk);
      if (!seen.has(key)) seen.set(key, `batch ${String(other.batch)} item ${String(i)}`);
    });
  }
  rawItems(data).forEach((item, j) => {
    if (!isRecord(item)) return;
    const parsed = chunkSchema.safeParse(item['chunk']);
    if (!parsed.success) return;
    const chunk = parsed.data;
    const example = item['example_en'];
    if (typeof example === 'string' && detectChunkHits(example, [chunk])[0]?.level !== 'full') {
      found.push({ rule: 'R4', path: `items.${String(j)}.example_en`, detail: null });
    }
    const key = chunkKey(chunk);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, `this batch item ${String(j)}`);
    else found.push({ rule: 'R6', path: `items.${String(j)}.chunk`, detail: `same as ${first}` });
  });
  return found;
}

/** R8 的檔名與跨批檢查（`batch` 本身的範圍由 schema 檢查）。 */
function batchChecks(input: { readonly fileName: string; readonly data: unknown }, others: readonly SeedBatch[]): Found[] {
  const found: Found[] = [];
  const batch = isRecord(input.data) ? input.data['batch'] : undefined;
  const match = FILE_NAME.exec(basename(input.fileName));
  if (match === null || (typeof batch === 'number' && Number(match[1]) !== batch)) {
    found.push({ rule: 'R8', path: 'fileName', detail: `file name ${basename(input.fileName)} does not match batch` });
  }
  if (typeof batch === 'number' && others.some((o) => o.batch === batch)) {
    found.push({ rule: 'R8', path: 'batch', detail: `batch ${String(batch)} already exists in another file` });
  }
  return found;
}

/**
 * ARCHITECTURE §4.10：種子庫一批的資料規則 R1～R8。`fileName` 只取 basename。
 * 全部 issue 一次回傳；同一規則在同一個 path 只回一條。
 */
export function checkSeedBatch(
  input: { readonly fileName: string; readonly data: unknown },
  others: readonly SeedBatch[],
): Result<SeedBatch, ValidationError> {
  const parsed = SeedBatchSchema.safeParse(input.data);
  const found: Found[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({ rule: ruleOfPath(issue.path, issue.code), path: fieldPath(issue.path), detail: null }));
  found.push(...batchChecks(input, others), ...crossChecks(input.data, others));

  const issues: ValidationIssue[] = [];
  const keys = new Set<string>();
  for (const f of found) {
    const key = `${f.rule}|${f.path}`;
    if (keys.has(key)) continue;
    keys.add(key);
    issues.push({ path: f.path, message: `${f.rule} ${f.detail ?? RULE_TEXT[f.rule]}` });
  }
  const first = issues[0];
  if (first !== undefined) return err({ kind: 'validation', issues, message: first.message });
  if (!parsed.success) {
    const message = `shape ${RULE_TEXT.shape}`;
    return err({ kind: 'validation', issues: [{ path: '', message }], message });
  }
  return ok(parsed.data);
}

function sqlText(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** ARCHITECTURE §4.10 的 migration 格式；決定性輸出，結尾一個換行。只做格式化，不驗證。 */
export function renderSeedMigration(batch: SeedBatch): string {
  const n = String(batch.batch);
  const header = `-- T-050 seed_chunk batch ${n} (generated format: packages/seed-data/src/seed-chunks.ts renderSeedMigration; source supabase/seed-chunks/batch-${n}.json).`;
  const insert = 'insert into public.seed_chunk (chunk, meaning_zh, example_en, tags, batch) values';
  const last = batch.items.length - 1;
  const rows = batch.items.map((item, i) => {
    const tags = item.tags.length === 0 ? "'{}'::text[]" : `array[${item.tags.map(sqlText).join(', ')}]::text[]`;
    const end = i === last ? ';' : ',';
    return `  (${sqlText(item.chunk)}, ${sqlText(item.meaning_zh)}, ${sqlText(item.example_en)}, ${tags}, ${n})${end}`;
  });
  return `${[header, insert, ...rows].join('\n')}\n`;
}
