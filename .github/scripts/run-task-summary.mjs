// Parse claude-execution-output.json for a short run-task summary:
// permission-denial count, Duration, and a test-runner excerpt.
// Used by claude-run-task.yml to post a PR or commit comment (C3).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function collectPermissionDenials(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const ev of events) {
    if (ev?.type !== 'result' || !Array.isArray(ev.permission_denials)) continue;
    for (const d of ev.permission_denials) {
      out.push({
        tool: d?.tool_name ?? 'unknown',
        command: d?.tool_input?.command ?? '(no command field)',
      });
    }
  }
  return out;
}

export function collectDuration(events) {
  if (!Array.isArray(events)) return null;
  const result = events.find((ev) => ev?.type === 'result');
  if (!result) return null;
  const ms = result.duration_ms;
  if (typeof ms !== 'number') return null;
  return { durationMs: ms, durationApiMs: result.duration_api_ms ?? null };
}

function formatDuration(ms) {
  if (typeof ms !== 'number') return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

const TEST_HINT = /(?:^|\n)\s*(?:Test Files|Tests|Test Suites|# tests|passing|failing|passed|failed)\b/i;

export function collectTestSummary(events) {
  if (!Array.isArray(events)) return 'not found';
  const chunks = [];
  for (const ev of events) {
    if (ev?.type !== 'user') continue;
    const content = ev?.message?.content ?? ev?.content ?? [];
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type !== 'tool_result') continue;
      const text = typeof b.content === 'string' ? b.content : '';
      if (TEST_HINT.test(text)) {
        chunks.push(text);
      }
    }
  }
  if (chunks.length === 0) return 'not found';
  const last = chunks[chunks.length - 1];
  const lines = last.split(/\r?\n/).filter((l) =>
    /Test Files|Tests\s+\d|Test Suites|# tests|passed|failed|failing|Duration\s+|exit \d+/.test(l),
  );
  const excerpt = (lines.length > 0 ? lines : last.split(/\r?\n/).slice(-8)).join('\n');
  return excerpt.trim() || 'not found';
}

export function hasResultEvent(events) {
  return Array.isArray(events) && events.some((ev) => ev?.type === 'result');
}

export function renderSummary({ task, runUrl, duration, denials, testSummary, resplitReport, resultPresent }) {
  const denialCount = resultPresent ? String(denials.length) : 'unknown';
  const lines = [
    `## run-task summary${task ? ` (${task})` : ''}`,
    '',
    `- Duration: ${formatDuration(duration?.durationMs)}` +
      (duration?.durationApiMs != null ? ` (API ${formatDuration(duration.durationApiMs)})` : ''),
    `- Permission denials: ${denialCount}`,
  ];
  for (const d of denials) {
    lines.push(`  - \`${d.tool}\`: \`${String(d.command).replace(/`/g, '\\`').slice(0, 300)}\``);
  }
  lines.push('', '### Test summary', '', '```', testSummary, '```');
  if (resplitReport) {
    lines.push('', '### Denied-command resplit', '', '```', resplitReport.trim(), '```');
  }
  if (runUrl) lines.push('', `Run: ${runUrl}`);
  lines.push('', '_Generated from `claude-execution-output.json`. Do not hand-edit these numbers._');
  return `${lines.join('\n')}\n`;
}

export function summarizeFile(path, { task, runUrl, resplitReport } = {}) {
  const events = JSON.parse(readFileSync(path, 'utf8'));
  return renderSummary({
    task,
    runUrl,
    duration: collectDuration(events),
    denials: collectPermissionDenials(events),
    testSummary: collectTestSummary(events),
    resplitReport,
    resultPresent: hasResultEvent(events),
  });
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node .github/scripts/run-task-summary.mjs <execution.json>');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(summarizeFile(file, {
    task: process.env.TASK,
    runUrl: process.env.RUN_URL,
    resplitReport: process.env.RESPLIT_REPORT,
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
