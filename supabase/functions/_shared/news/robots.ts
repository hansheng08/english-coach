// robots.txt per RFC 9309 (ARCHITECTURE §11.1.1 point 4). Pure functions.

export const ROBOTS_PRODUCT_TOKEN = 'english-coach';

export type RobotsRules = { readonly allow: readonly string[]; readonly disallow: readonly string[] };
export const ALLOW_ALL: RobotsRules = { allow: [], disallow: [] };
export const DISALLOW_ALL: RobotsRules = { allow: [], disallow: ['/'] };

type Group = { agents: string[]; allow: string[]; disallow: string[] };

/** Rules of the groups whose user-agent equals our product token (case-insensitive), else of the `*` groups. */
export function parseRobots(txt: string, token: string = ROBOTS_PRODUCT_TOKEN): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let inAgents = false;
  for (const rawLine of txt.split(/\r\n|\r|\n/)) {
    const line = (rawLine.split('#')[0] ?? '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (current === null || !inAgents) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      inAgents = true;
    } else if (key === 'allow' || key === 'disallow') {
      inAgents = false;
      if (current === null || value === '') continue;
      (key === 'allow' ? current.allow : current.disallow).push(value);
    }
  }
  const own = groups.filter((g) => g.agents.includes(token.toLowerCase()));
  const chosen = own.length > 0 ? own : groups.filter((g) => g.agents.includes('*'));
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

const matches = (pattern: string, path: string): boolean => {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
};

/** Longest matching rule wins; on equal length Allow wins; no match → allowed. `pathAndQuery` starts with `/`. */
export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  const longest = (patterns: readonly string[]): number =>
    patterns.filter((p) => matches(p, pathAndQuery)).reduce((n, p) => Math.max(n, p.length), -1);
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  return disallow < 0 || allow >= disallow;
}
