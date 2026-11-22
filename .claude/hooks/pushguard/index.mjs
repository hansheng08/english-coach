// PreToolUse hook：讀 stdin 的 JSON，輸出 allow／deny 或不表示意見。只用 Node.js 內建模組。
import { readFileSync } from 'node:fs';
import { evaluate, fallbackDecision, getCurrentBranch } from './guard.mjs';

function emit(result) {
  if (result === null) return;
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason,
    },
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

try {
  const text = readFileSync(0, 'utf8');
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    emit(fallbackDecision(text));
    process.exitCode = 0;
    payload = undefined;
  }
  if (payload !== undefined) {
    const tool = payload?.tool_name;
    if (tool === 'Bash' || tool === 'PowerShell') {
      const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
      const command = payload?.tool_input?.command;
      if (typeof command !== 'string') {
        emit({ decision: 'deny', reason: 'pushguard: tool_input.command is missing or not a string' });
      } else {
        emit(evaluate({ command, getBranch: () => getCurrentBranch(cwd) }));
      }
    }
    process.exitCode = 0;
  }
} catch (err) {
  process.stderr.write(`pushguard: internal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
}
