// 證明 gitleaks 設定真的抓得到 3 種供應商金鑰。假金鑰在執行時拼出來，原始碼裡沒有完整字串。
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = fileURLToPath(new URL('../../.gitleaks.toml', import.meta.url));
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomFrom(alphabet, length) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const samples = [
  { name: 'gemini', content: `const k = "${['AI', 'za'].join('')}${randomFrom(ALNUM + '_-', 35)}";\n` },
  { name: 'groq', content: `const k = "${['gs', 'k_'].join('')}${randomFrom(ALNUM, 40)}";\n` },
  { name: 'azure', content: `${['AZURE', 'SPEECH', 'KEY'].join('_')}=${randomBytes(16).toString('hex')}\n` },
];

const root = mkdtempSync(join(tmpdir(), 'secret-selftest-'));
let failed = false;
try {
  for (const s of samples) {
    const dir = join(root, s.name);
    mkdirSync(dir);
    writeFileSync(join(dir, 'sample.txt'), s.content);
    const r = spawnSync('gitleaks', ['dir', dir, '--config', CONFIG, '--redact', '--no-banner'], { encoding: 'utf8' });
    if (r.error) {
      console.error(`secret-selftest: cannot run gitleaks: ${r.error.message}`);
      failed = true;
      break;
    }
    const detected = r.status === 1;
    console.log(`${detected ? 'DETECTED' : 'MISSED  '} ${s.name} (gitleaks exit ${r.status})`);
    if (!detected) failed = true;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
