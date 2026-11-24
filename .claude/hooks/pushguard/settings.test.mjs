import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raw = readFileSync(fileURLToPath(new URL('../../settings.json', import.meta.url)), 'utf8');

// 任務單 O-001 實作限制 B 的 deny 規則（逐字）
const REQUIRED_DENY = [
  "Bash(rm -rf *)",
  "Bash(rm -fr *)",
  "Bash(rm -r *)",
  "Bash(sudo *)",
  "Bash(chmod -R *)",
  "Bash(curl *)",
  "Bash(wget *)",
  "Bash(sh)",
  "Bash(sh -s*)",
  "Bash(bash)",
  "Bash(bash -s*)",
  "Bash(iex *)",
  "Bash(Invoke-Expression *)",
  "Bash(env)",
  "Bash(printenv*)",
  "Bash(cat)",
  "Bash(cat *)",
  "Bash(grep)",
  "Bash(grep *)",
  "Bash(head)",
  "Bash(head *)",
  "Bash(ls)",
  "Bash(ls *)",
  "Bash(sed)",
  "Bash(sed *)",
  "Bash(git push)",
  "Bash(git push --force*)",
  "Bash(git push -f*)",
  "Bash(git push * --force*)",
  "Bash(git push * -f)",
  "Bash(git push * -f *)",
  "Bash(git push * +*)",
  "Bash(git push * --force-with-lease*)",
  "Bash(git push * --force-if-includes*)",
  "Bash(git push --mirror*)",
  "Bash(git push * --mirror*)",
  "Bash(git push --all*)",
  "Bash(git push * --all*)",
  "Bash(git push --tags*)",
  "Bash(git push * --tags*)",
  "Bash(git push * --follow-tags*)",
  "Bash(git push --delete*)",
  "Bash(git push * --delete*)",
  "Bash(git push * -d *)",
  "Bash(git push * --prune*)",
  "Bash(git push origin main*)",
  "Bash(git push * main)",
  "Bash(git push * main*)",
  "Bash(git push * master*)",
  "Bash(git push *:main*)",
  "Bash(git push *:master*)",
  "Bash(git push *:refs/*)",
  "Bash(git push * HEAD)",
  "Bash(git -C * push*)",
  "Bash(git -c * push*)",
  "Bash(git --git-dir* push*)",
  "Bash(git --work-tree* push*)",
  "Bash(git merge*)",
  "Bash(gh pr create*)",
  "Bash(gh pr merge*)",
  "Bash(gh pr review*)",
  "Bash(gh api*)",
  "Bash(gh repo *)",
  "Bash(gh release *)",
  "Bash(gh secret *)",
  "Bash(gh variable *)",
  "Bash(gh workflow run*)",
  "Bash(gh auth login*)",
  "Bash(gh auth token*)",
  "Bash(git add -A*)",
  "Bash(git add --all*)",
  "Bash(git add .)",
  "Bash(git add -u*)",
  "Bash(git reset --hard*)",
  "Bash(git reset * --hard*)",
  "Bash(git clean *)",
  "Bash(git checkout -- *)",
  "Bash(git checkout .)",
  "Bash(git restore *)",
  "Bash(git branch -D *)",
  "Bash(git branch -d *)",
  "Bash(git branch --delete *)",
  "Bash(git branch -f *)",
  "Bash(git stash drop*)",
  "Bash(git stash clear*)",
  "Bash(git filter-branch *)",
  "Bash(git filter-repo *)",
  "Bash(git reflog expire *)",
  "Bash(git gc --prune*)",
  "Bash(git config *)",
  "Bash(git commit --no-verify*)",
  "Bash(git commit * --no-verify*)",
  "Bash(supabase link*)",
  "Bash(supabase login*)",
  "Bash(supabase db push*)",
  "Bash(supabase functions deploy*)",
  "Bash(supabase secrets *)",
  "Bash(supabase projects *)",
  "Bash(supabase orgs *)",
  "Bash(npm publish*)",
  "Bash(pnpm publish*)",
  "Read(./.env)",
  "Read(./.env.*)",
  "Read(**/.env)",
  "Read(**/.env.*)",
  "Read(**/*.pem)",
  "Read(**/*.key)",
  "Read(**/secrets/**)",
  "Read(~/.ssh/**)",
  "Read(~/.aws/**)",
  "Read(~/.config/gh/**)",
  "Read(~/.supabase/**)",
  "Read(~/.git-credentials)",
  "Read(~/.netrc)",
];

test('settings.json is valid JSON with $schema', () => {
  const s = JSON.parse(raw);
  assert.equal(s.$schema, 'https://json.schemastore.org/claude-code-settings.json');
});

test('permissions.allow has no git push rule', () => {
  const { permissions } = JSON.parse(raw);
  assert.ok(permissions.allow.length > 0);
  for (const rule of permissions.allow) assert.ok(!rule.startsWith('Bash(git push'), rule);
});

test('permissions.deny contains every required rule', () => {
  const { permissions } = JSON.parse(raw);
  const missing = REQUIRED_DENY.filter((r) => !permissions.deny.includes(r));
  assert.deepEqual(missing, []);
});

test('no rule in allow/ask/deny ends with ":*)"', () => {
  const { permissions } = JSON.parse(raw);
  for (const list of [permissions.allow, permissions.ask, permissions.deny]) {
    for (const rule of list) assert.ok(!rule.endsWith(':*)'), rule);
  }
});

test('PreToolUse runs pushguard in exec form and blocks on failure', () => {
  const { hooks } = JSON.parse(raw);
  const entry = hooks.PreToolUse.find((e) => e.matcher === 'Bash|PowerShell');
  assert.ok(entry, 'matcher Bash|PowerShell not found');
  const hook = entry.hooks.find(
    (h) => h.type === 'command' && h.command === 'node' &&
      Array.isArray(h.args) && h.args.length === 1 &&
      h.args[0] === '${CLAUDE_PROJECT_DIR}/.claude/hooks/pushguard/index.mjs' &&
      h.onFailure === 'block',
  );
  assert.ok(hook, 'pushguard hook (node + args + onFailure block) not found');
});
