// Detect whether a later Bash tool call retries a fragment of a previously
// denied command (the T-012 pattern in run 45205560119: a chained
// `git add && git commit && git status; git push … 2>&1` was denied by
// pushguard, then `git push -u origin task/T-012` ran successfully).
//
// Usage:
//   node .github/scripts/detect-resplit.mjs <execution.json>
// Exit 1 if a resplit bypass is found.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Split a shell command into statements on &&, ||, ;, |, and newlines, ignoring operators inside quotes. */
export function splitStatements(command) {
  const raw = String(command ?? '');
  const parts = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote === "'") {
      cur += c;
      if (c === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      cur += c;
      if (c === '\\' && i + 1 < raw.length) cur += raw[++i];
      else if (c === '"') quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '\\' && i + 1 < raw.length) {
      cur += c + raw[++i];
      continue;
    }
    if (c === '&' && raw[i + 1] === '&') {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === '|' && raw[i + 1] === '|') {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === ';' || c === '|' || c === '\n') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Drop redirections and trailing noise so `git push -u origin b 2>&1` matches `git push -u origin b`. */
export function normalizeStatement(s) {
  return String(s)
    .replace(/(?:>>?|2>>?|<)\s*\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function statementsOf(command) {
  return splitStatements(command).map(normalizeStatement).filter(Boolean);
}

const WATCHED_FILE_TOOLS = new Set(['cat', 'grep', 'head', 'ls', 'sed']);

/** Fragments that count as a bypass if retried after a compound denial.
 *  Incidental allowed statements (git status, git add, echo) are not flagged
 *  so Claude is not pushed into a catch-22 with pushguard (TechLead O-004 B / suggestion).
 *  An exact retry of the whole denied command is always a resplit.
 */
export function isWatchedResplitStatement(statement) {
  const words = normalizeStatement(statement).split(' ').filter(Boolean);
  if (words.length === 0) return false;
  if (words[0] === 'git' && words[1] === 'push') return true;
  if (WATCHED_FILE_TOOLS.has(words[0])) return true;
  return false;
}

/**
 * A later command is a resplit if it is an exact (normalized) retry of a
 * denied command, or a watched statement fragment of a denied compound
 * (git push, or cat/grep/head/ls/sed).
 */
export function isResplitFragment(deniedCommand, laterCommand) {
  const later = normalizeStatement(laterCommand);
  if (!later) return false;
  const deniedWhole = normalizeStatement(deniedCommand);
  if (later === deniedWhole) return true; // exact retry of the whole command
  const stmts = statementsOf(deniedCommand);
  if (stmts.length <= 1) {
    // Single-statement denial: only flag an exact (normalized) retry.
    return later === stmts[0];
  }
  return stmts.includes(later) && isWatchedResplitStatement(later);
}

export function extractDeniedCommands(events) {
  const denied = [];
  if (!Array.isArray(events)) return denied;
  for (const ev of events) {
    if (ev?.type === 'result' && Array.isArray(ev.permission_denials)) {
      for (const d of ev.permission_denials) {
        const cmd = d?.tool_input?.command;
        if (typeof cmd === 'string' && cmd.length > 0) {
          denied.push({ command: cmd, toolUseId: d.tool_use_id ?? null, source: 'permission_denials' });
        }
      }
    }
  }
  return denied;
}

export function extractBashCommandsInOrder(events) {
  const out = [];
  if (!Array.isArray(events)) return out;
  for (const ev of events) {
    if (ev?.type !== 'assistant') continue;
    const content = ev?.message?.content ?? ev?.content ?? [];
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use' && b?.name === 'Bash') {
        const cmd = b?.input?.command;
        if (typeof cmd === 'string') out.push({ command: cmd, id: b.id ?? null });
      }
    }
  }
  return out;
}

export function findResplits(events) {
  const denied = extractDeniedCommands(events);
  const calls = extractBashCommandsInOrder(events);
  const hits = [];
  for (const d of denied) {
    let seenDeniedCall = d.toolUseId == null;
    for (const c of calls) {
      if (!seenDeniedCall) {
        if (c.id === d.toolUseId) seenDeniedCall = true;
        continue;
      }
      if (isResplitFragment(d.command, c.command)) {
        hits.push({ denied: d.command, later: c.command, laterId: c.id });
      }
    }
  }
  return hits;
}

export function formatReport(hits) {
  if (hits.length === 0) return 'detect-resplit: no bypass found\n';
  const lines = [
    'ERROR: detect-resplit: a later Bash call retried a fragment of a denied command.',
    'Denied commands must not be split and resent (charter v6 §13 rule #12: do not work around a permission denial).',
  ];
  for (const h of hits) {
    lines.push(`- denied: ${h.denied}`);
    lines.push(`  later:  ${h.later}`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node .github/scripts/detect-resplit.mjs <execution.json>');
    process.exitCode = 1;
    return;
  }
  let events;
  try {
    events = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`detect-resplit: cannot read ${file}: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }
  const hits = findResplits(events);
  process.stdout.write(formatReport(hits));
  process.exitCode = hits.length > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
