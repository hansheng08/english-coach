import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = join(here, '..', '.claude', 'hooks', 'pushguard', 'index.mjs');

const runHook = (command) =>
  spawnSync(process.execPath, [INDEX], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: '.' }),
    encoding: 'utf8',
  });

describe('pushguard messages cite charter v6', () => {
  it('(AC-O14-6) (TC-20) denies with "charter v6 §13 rule #12" and never v5', () => {
    for (const command of ['head -5 README.md', 'git push origin task/O-901:main']) {
      const r = runHook(command);
      expect(r.status, command).toBe(0);
      const out = JSON.parse(r.stdout).hookSpecificOutput;
      expect(out.permissionDecision, command).toBe('deny');
      expect(out.permissionDecisionReason, command).toContain('charter v6 §13 rule #12');
      expect(out.permissionDecisionReason, command).not.toContain('charter v5');
    }
  });
});
