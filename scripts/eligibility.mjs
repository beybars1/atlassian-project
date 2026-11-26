/**
 * "Runs on Atlassian" pre-flight (T22, static half).
 *
 * The badge means no data leaves Atlassian: no outbound HTTP, no remote backends, no external
 * auth providers, no Connect parts. `forge eligibility` is the authority and needs a logged-in CLI;
 * this file checks the same surface offline so CI fails the night a change would lose the badge,
 * not the day the listing is reviewed. It is deliberately strict: any `permissions.external` key
 * (images and fonts included) counts, because the rule we enforce is "no egress", not "no fetch".
 *
 * Pure: takes the parsed manifest and the source files, returns a list of problems (empty = clean).
 */

/** Manifest keys that are only ever used to reach outside Atlassian. */
const EGRESS_TOP_LEVEL = ["remotes", "providers", "connectModules", "services"];

/** Source patterns that would make an outbound request (only possible with external permissions, but belt and braces). */
const SOURCE_PATTERNS = [
  { re: /\bapi\s*\.\s*fetch\s*\(/, why: "@forge/api fetch() is an egress call" },
  { re: /import\s*\{[^}]*\bfetch\b[^}]*\}\s*from\s*["']@forge\/api["']/, why: "imports fetch from @forge/api" },
  { re: /\bXMLHttpRequest\b/, why: "XMLHttpRequest reaches outside Atlassian" },
  { re: /\bnew\s+WebSocket\s*\(/, why: "WebSocket reaches outside Atlassian" },
];

/**
 * @param {unknown} manifest parsed manifest.yml
 * @param {Array<{ path: string; text: string }>} sources every file under src/
 * @returns {string[]} problems; empty when the app can carry the badge
 */
export function runsOnAtlassianIssues(manifest, sources = []) {
  const issues = [];
  const m = isObject(manifest) ? manifest : {};

  const permissions = isObject(m.permissions) ? m.permissions : {};
  if (isObject(permissions.external)) {
    for (const key of Object.keys(permissions.external)) {
      issues.push(`permissions.external.${key}: external permissions are egress`);
    }
  } else if (permissions.external !== undefined) {
    issues.push("permissions.external: external permissions are egress");
  }

  for (const key of EGRESS_TOP_LEVEL) {
    if (m[key] !== undefined) issues.push(`${key}: declares an off-Atlassian dependency`);
  }

  const app = isObject(m.app) ? m.app : {};
  if (app.connect !== undefined) issues.push("app.connect: Connect-on-Forge apps run partly outside Atlassian");

  const modules = isObject(m.modules) ? m.modules : {};
  for (const [moduleType, entries] of Object.entries(modules)) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, i) => {
      if (!isObject(entry)) return;
      const key = typeof entry.key === "string" ? entry.key : String(i);
      if (entry.endpoint !== undefined) issues.push(`modules.${moduleType}[${key}].endpoint: remote backend`);
      if (isObject(entry.providers)) issues.push(`modules.${moduleType}[${key}].providers: external auth provider`);
    });
  }

  for (const { path, text } of sources) {
    for (const { re, why } of SOURCE_PATTERNS) {
      if (re.test(text)) issues.push(`${path}: ${why}`);
    }
  }

  return issues;
}

function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
