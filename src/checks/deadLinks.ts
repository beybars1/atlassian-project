import type { Check, Finding, PageLink } from "./types";

/**
 * Check 1 — dead internal links.
 * Internal only: Confluence pages (by id or title) and Jira issues. External links are NOT checked,
 * because any outbound request would cost the "Runs on Atlassian" badge.
 */
export const deadLinks: Check = async (page, clients): Promise<Finding[]> => {
  const dead: string[] = [];
  const seen = new Set<string>();

  for (const link of page.links) {
    if (link.external) continue;
    const id = linkIdentity(link);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    if (link.pageId) {
      if (!(await clients.confluence.pageExistsById(link.pageId))) dead.push(describe(link));
    } else if (link.pageTitle) {
      const spaceKey = link.spaceKey ?? page.spaceKey;
      if (spaceKey && !(await clients.confluence.pageExistsByTitle(spaceKey, link.pageTitle))) {
        dead.push(describe(link));
      }
    } else if (link.issueKey) {
      const info = await clients.jira.getIssue(link.issueKey);
      if (!info.exists && !info.movedTo) dead.push(describe(link));
    }
  }

  if (dead.length === 0) return [];
  return [
    {
      pageId: page.id,
      check: "DEAD_LINK",
      severity: dead.length >= 3 ? "high" : "medium",
      evidence: `${dead.length} dead internal link(s): ${dead.slice(0, 5).join(", ")}${dead.length > 5 ? ", …" : ""}.`,
      suggestion: "Fix or remove the broken links.",
    },
  ];
};

function linkIdentity(l: PageLink): string | undefined {
  if (l.pageId) return `id:${l.pageId}`;
  if (l.pageTitle) return `title:${l.spaceKey ?? ""}:${l.pageTitle}`;
  if (l.issueKey) return `issue:${l.issueKey}`;
  return undefined;
}

function describe(l: PageLink): string {
  if (l.pageId) return `page #${l.pageId}`;
  if (l.pageTitle) return `"${l.pageTitle}"`;
  if (l.issueKey) return l.issueKey;
  return l.href;
}
