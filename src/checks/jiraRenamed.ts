import { componentMentioned, usable, versionMention } from "./jiraNameDrift";
import type { Check, Finding } from "./types";

/**
 * Check 3c (T19a) — rename propagation: a Jira component or version was renamed and the page still
 * uses the old name.
 *
 * Jira REST has no changelog for component / version renames (issue changelogs record field changes
 * on issues, not renames of the objects themselves), so the app keeps its own: every nightly refresh
 * of a project's components and versions is written to the `jira_names` snapshot, one row per
 * `(project, kind, id, name)` with first/last seen dates. Ids are stable across renames, so an id
 * that carries a new name is a rename; its earlier names are what pages must no longer say. Renames
 * older than `RENAME_WINDOW_DAYS` are forgotten, and nothing is reported the first time a project is
 * seen (there is nothing to compare against).
 *
 * Conservative by construction:
 *   - project context comes only from issue keys on the page (as in check 3b);
 *   - old names are matched with check 3b's rules (whole word; a single-word component needs the
 *     word "component" in the clause; a version needs release context or a "v" prefix);
 *   - a page that already mentions the new name is left alone ("Card Vault (formerly Vault)");
 *   - an old name that is still the name of something else in the project is never reported;
 *   - case-only renames and names under 3 characters are ignored.
 * Component → medium, version → low; the suggestion is the concrete replacement.
 */
export const RENAME_WINDOW_DAYS = 180;
export const MAX_RENAME_FINDINGS_PER_PAGE = 5;

export type JiraNameKind = "component" | "version";

/** One row of the `jira_names` snapshot. */
export interface JiraNameRow {
  projectKey: string;
  kind: JiraNameKind;
  jiraId: string;
  name: string;
  /** ISO date of the refresh that first saw this name on this id. */
  firstSeen: string;
  /** ISO date of the latest refresh that saw it. */
  lastSeen: string;
}

export interface JiraRename {
  projectKey: string;
  kind: JiraNameKind;
  jiraId: string;
  oldName: string;
  newName: string;
  /** ISO date: when the new name was first seen (= now for a rename found by this refresh). */
  renamedAt: string;
}

export interface CurrentJiraName {
  kind: JiraNameKind;
  id: string;
  name: string;
}

/**
 * Renames of `projectKey` within the window, from the snapshot rows as they were before this
 * refresh (`seen`) and what Jira lists now (`current`). Pure.
 */
export function detectRenames(projectKey: string, seen: JiraNameRow[], current: CurrentJiraName[], now: Date): JiraRename[] {
  const cutoff = now.getTime() - RENAME_WINDOW_DAYS * 86_400_000;
  const currentNames = new Map<JiraNameKind, Set<string>>();
  for (const c of current) {
    if (!currentNames.has(c.kind)) currentNames.set(c.kind, new Set());
    currentNames.get(c.kind)!.add(c.name.trim().toLowerCase());
  }
  const out: JiraRename[] = [];
  for (const c of current) {
    const rows = seen.filter((r) => r.projectKey === projectKey && r.kind === c.kind && r.jiraId === c.id);
    if (rows.length === 0) continue;
    const renamedAt = rows.find((r) => r.name === c.name)?.firstSeen ?? now.toISOString();
    if (new Date(renamedAt).getTime() < cutoff) continue;
    for (const r of rows) {
      if (r.name === c.name || !usable(r.name)) continue;
      if (currentNames.get(c.kind)!.has(r.name.trim().toLowerCase())) continue; // still a name in the project, or a case-only change
      out.push({ projectKey, kind: c.kind, jiraId: c.id, oldName: r.name, newName: c.name, renamedAt });
    }
  }
  return out;
}

/** Renames known for a project; the worker backs this with the Jira clients + the repo snapshot. */
export type RenameSource = (projectKey: string) => Promise<JiraRename[]>;

export function makeJiraRenamed(renamesFor: RenameSource): Check {
  return async (page, clients): Promise<Finding[]> => {
    if (page.issueKeys.length === 0 || page.text.length === 0) return [];
    const known = await clients.jira.knownProjectKeys();
    const projects = [...new Set(page.issueKeys.map((k) => k.split("-")[0]))].filter((p) => known.has(p));
    if (projects.length === 0) return [];

    const findings: Finding[] = [];
    for (const project of projects) {
      let renames: JiraRename[];
      try {
        renames = await renamesFor(project);
      } catch (err) {
        console.warn(`renames of ${project} unavailable`, err);
        continue;
      }
      for (const r of renames) {
        if (findings.length >= MAX_RENAME_FINDINGS_PER_PAGE) return findings;
        if (mentionsNewName(page.text, r.newName)) continue;
        const hit = r.kind === "component" ? componentMentioned(page.text, r.oldName) : versionMention(page.text, r.oldName) !== undefined;
        if (!hit) continue;
        const what = r.kind === "component" ? "Component" : "Version";
        findings.push({
          pageId: page.id,
          check: "JIRA_RENAMED",
          severity: r.kind === "component" ? "medium" : "low",
          evidence: `${what} "${r.oldName}" (${project}) was renamed to "${r.newName}" in Jira on ${r.renamedAt.slice(0, 10)}; the page still says "${r.oldName}".`,
          suggestion: `Replace "${r.oldName}" with "${r.newName}".`,
        });
      }
    }
    return findings;
  };
}

/** Loose whole-word, case-insensitive presence of the new name: any mention means the page knows it. */
function mentionsNewName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i").test(text);
}
