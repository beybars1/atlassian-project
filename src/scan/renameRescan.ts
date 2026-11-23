/**
 * T19d — rescan on rename. The nightly diff is by page version, so a page nobody edited since a Jira
 * component / version was renamed would never meet check 3c (T19a) again. The worker therefore
 * stores the Jira projects each page cites (`pages.project_keys`), and the nightly refreshes the
 * `jira_names` snapshot of every cited project itself: a page whose cited project has a rename newer
 * than the page's own `scanned_at` is added to tonight's batches, version unchanged.
 *
 * Free of Forge imports: the repo and the Jira clients are injected, so this runs in unit tests.
 */
import { detectRenames, type CurrentJiraName, type JiraRename } from "../checks/jiraRenamed";
import type { Clients } from "../checks/types";
import { storedDateMs, type CitedProjects, type Repo } from "../db/repo";

/** Distinct project keys of a page's issue keys, in first-seen order. */
export function projectKeysOf(issueKeys: string[]): string[] {
  return [...new Set(issueKeys.map((k) => k.split("-")[0]).filter(Boolean))];
}

/**
 * Refresh a project's component / version names from Jira into the snapshot and return the renames
 * within the window (check 3c). An empty list from a client is also what it returns on an error, so
 * an empty kind is simply not refreshed — a Jira outage never turns into "every name disappeared".
 */
export async function refreshJiraNames(repo: Repo, clients: Clients, project: string): Promise<JiraRename[]> {
  const [components, versions] = await Promise.all([clients.jira.getComponents(project), clients.jira.getVersions(project)]);
  const current: CurrentJiraName[] = [
    ...components.map((c): CurrentJiraName => ({ kind: "component", id: c.id, name: c.name })),
    ...versions.map((v): CurrentJiraName => ({ kind: "version", id: v.id, name: v.name })),
  ];
  if (current.length === 0) return [];
  const seen = await repo.jiraNames(project);
  const now = clients.now();
  const renames = detectRenames(project, seen, current, now);
  await repo.upsertJiraNames(current.map((c) => ({ projectKey: project, kind: c.kind, jiraId: c.id, name: c.name })), now.toISOString());
  return renames;
}

/** Pages whose scan predates the latest rename in one of the projects they cite. Pure. */
export function pagesNeedingRescan(pages: CitedProjects[], latestRenameAt: Map<string, string>): string[] {
  const out: string[] = [];
  for (const p of pages) {
    const scanned = storedDateMs(p.scannedAt);
    if (p.projectKeys.some((k) => storedDateMs(latestRenameAt.get(k) ?? "") > scanned)) out.push(p.pageId);
  }
  return out;
}

/**
 * Page ids of `spaceId` to rescan tonight because of a Jira rename. Refreshes each cited project
 * once; a project the site does not know, or whose refresh fails, yields no rescans — never a throw,
 * so the nightly's regular diff always goes ahead.
 */
export async function renameRescanPageIds(repo: Repo, clients: Clients, spaceId: string): Promise<string[]> {
  const pages = await repo.pagesCitingProjects(spaceId);
  if (pages.length === 0) return [];
  const known = await clients.jira.knownProjectKeys();
  const projects = [...new Set(pages.flatMap((p) => p.projectKeys))].filter((k) => known.has(k));
  const latest = new Map<string, string>();
  for (const project of projects) {
    let renames: JiraRename[];
    try {
      renames = await refreshJiraNames(repo, clients, project);
    } catch (err) {
      console.warn(`jira names refresh ${project} failed`, err);
      continue;
    }
    for (const r of renames) {
      const have = latest.get(project);
      if (!have || storedDateMs(r.renamedAt) > storedDateMs(have)) latest.set(project, r.renamedAt);
    }
  }
  return pagesNeedingRescan(pages, latest);
}
