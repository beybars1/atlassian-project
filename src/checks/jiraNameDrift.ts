import type { Check, Finding } from "./types";

/**
 * Check 3b — Jira component and version names on the page that Jira has retired.
 *
 * Project context comes only from issue keys on the page: a page that mentions PAY-12 is checked
 * against the components and versions of PAY, nothing else. Names are matched conservatively —
 * a component called "Pricing" or a version called "1.0" must not fire on ordinary prose:
 *   - component names: whole-word match; a single-word name needs exact case AND the word
 *     "component" in the same clause; multi-word or digit-bearing names match case-insensitively.
 *   - version names: whole-token match (not inside "2.3.1" when the name is "2.3") and a release
 *     word ("version", "release", "shipped", …) in the same clause, or a direct "v" prefix.
 * Archived component → medium. Archived version → low. Released version whose clause still calls
 * it planned/upcoming → low. Deleted components and versions cannot be detected (Jira no longer
 * lists them), so they are not reported.
 */
export const jiraNameDrift: Check = async (page, clients): Promise<Finding[]> => {
  if (page.issueKeys.length === 0 || page.text.length === 0) return [];
  const known = await clients.jira.knownProjectKeys();
  const projects = [...new Set(page.issueKeys.map((k) => k.split("-")[0]))].filter((p) => known.has(p));
  if (projects.length === 0) return [];

  const archivedComponents: string[] = [];
  const archivedVersions: string[] = [];
  const releasedAsUpcoming: string[] = [];

  for (const project of projects) {
    const [components, versions] = await Promise.all([
      clients.jira.getComponents(project),
      clients.jira.getVersions(project),
    ]);
    for (const c of components) {
      if (!c.archived || !usable(c.name)) continue;
      if (componentMentioned(page.text, c.name)) archivedComponents.push(`"${c.name}" (${project})`);
    }
    for (const v of versions) {
      if (!usable(v.name)) continue;
      const hit = versionMention(page.text, v.name);
      if (hit === undefined) continue;
      if (v.archived) {
        archivedVersions.push(`"${v.name}" (${project})`);
      } else if (v.released && UPCOMING_WORDS.test(clause(page.text, hit, hit + v.name.length))) {
        const when = v.releaseDate ? ` on ${v.releaseDate}` : "";
        releasedAsUpcoming.push(`"${v.name}" (${project}) was released${when} but the page describes it as upcoming`);
      }
    }
  }

  const findings: Finding[] = [];
  if (archivedComponents.length) {
    findings.push({
      pageId: page.id,
      check: "JIRA_REF_DRIFT",
      severity: "medium",
      evidence: `Component(s) archived in Jira: ${archivedComponents.join(", ")}.`,
      suggestion: "Point readers at the component that replaced it, or remove the reference.",
    });
  }
  if (archivedVersions.length) {
    findings.push({
      pageId: page.id,
      check: "JIRA_REF_DRIFT",
      severity: "low",
      evidence: `Version(s) archived in Jira: ${archivedVersions.join(", ")}.`,
      suggestion: "Confirm the page still applies to a supported version, or mark it historical.",
    });
  }
  if (releasedAsUpcoming.length) {
    findings.push({
      pageId: page.id,
      check: "JIRA_REF_DRIFT",
      severity: "low",
      evidence: releasedAsUpcoming.join("; ") + ".",
      suggestion: "Reword the section: the release has happened.",
    });
  }
  return findings;
};

const UPCOMING_WORDS = /\b(planned|upcoming|scheduled|will be|to be|not yet|unreleased|pending|targets?|targeted)\b/i;
const COMPONENT_WORD = /\bcomponents?\b/i;
const RELEASE_WORDS =
  /\b(versions?|releases?|released|releasing|fix ?versions?|ship|ships|shipped|shipping|milestone|upgraded?|rollout|rolled out|build)\b/i;
/** Where a clause starts/ends: sentence punctuation followed by whitespace, or a block break. */
const CLAUSE_BREAK = /[.;:!?]\s|\n/g;
const FIRST_CLAUSE_BREAK = /[.;:!?]\s|\n/;

function usable(name: string): boolean {
  return name.trim().length >= 3;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function componentMentioned(text: string, name: string): boolean {
  const distinctive = /\s/.test(name.trim()) || /\d/.test(name);
  const re = new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, distinctive ? "gi" : "g");
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (distinctive) return true;
    if (COMPONENT_WORD.test(clause(text, idx, idx + name.length))) return true;
  }
  return false;
}

/** Index of the first mention that has release context, or undefined. */
function versionMention(text: string, name: string): number | undefined {
  const re = new RegExp(`(?<![A-Za-z0-9.])(v)?${escape(name)}(?![A-Za-z0-9]|\\.\\d)`, "g");
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (m[1]) return idx; // "v2.3" is unambiguous
    const around = clause(text, idx, idx + name.length);
    if (RELEASE_WORDS.test(around.replace(name, " "))) return idx;
  }
  return undefined;
}

/** The sentence/clause containing [start, end), with the match itself included. */
function clause(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - 80), start);
  const after = text.slice(end, end + 80);
  let prefix = before;
  for (const m of before.matchAll(CLAUSE_BREAK)) prefix = before.slice((m.index ?? 0) + m[0].length);
  const stop = FIRST_CLAUSE_BREAK.exec(after);
  const suffix = stop ? after.slice(0, stop.index) : after;
  return prefix + text.slice(start, end) + suffix;
}
