import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'fs';
import { it } from 'vitest';
import { good } from './good';
it('x', () => [good, readFileSync, join, fileURLToPath, readdirSync]);
