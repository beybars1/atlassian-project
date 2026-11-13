/**
 * Forge implementations of the Clients interface. Everything goes through `./http` (asApp,
 * rate-limited, retried on 429/503), so scans run without a user context (scheduled triggers have none).
 *
 * Endpoints are the ones documented for Confluence REST v2 and Jira REST v3 as of Nov 2026.
 * First deploy task: hit each of these against the dev site and fix any that drifted.
 */
import { route } from "@forge/api";
import type { Clients, ComponentInfo, IssueInfo, VersionInfo } from "../checks/types";
import { confluenceGet, jiraGet } from "./http";

const cache = {
  users: new Map<string, boolean | undefined>(),
  issues: new Map<string, IssueInfo>(),
  pagesById: new Map<string, boolean>(),
  attachments: new Map<string, string[] | undefined>(),
  components: new Map<string, ComponentInfo[]>(),
  versions: new Map<string, VersionInfo[]>(),
  projectKeys: undefined as Set<string> | undefined,
};

let warnedAttachmentScope = false;

export function forgeClients(): Clients {
  return {
    confluence: {
      async pageExistsById(pageId) {
        const hit = cache.pagesById.get(pageId);
        if (hit !== undefined) return hit;
        const res = await confluenceGet(route`/wiki/api/v2/pages/${pageId}`);
        const ok = res.status === 200;
        cache.pagesById.set(pageId, ok);
        return ok;
      },
      async pageExistsByTitle(spaceKey, title) {
        // v2 needs a space id; resolve key → id once per space.
        const spaceId = await spaceIdByKey(spaceKey);
        if (!spaceId) return true; // unknown space: don't flag, avoid false positives
        const res = await confluenceGet(route`/wiki/api/v2/spaces/${spaceId}/pages?title=${title}&limit=1`);
        if (res.status !== 200) return true;
        const body = (await res.json()) as { results?: unknown[] };
        return (body.results?.length ?? 0) > 0;
      },
      async attachmentFilenames(pageId) {
        if (cache.attachments.has(pageId)) return cache.attachments.get(pageId);
        // v2 attachment `title` is the filename. Needs `read:attachment:confluence`; without it the
        // endpoint answers 403 and the attachment check stays silent (undefined → nothing flagged).
        const names: string[] = [];
        let cursor: string | undefined;
        let ok = true;
        for (;;) {
          const path = cursor
            ? route`/wiki/api/v2/pages/${pageId}/attachments?limit=250&cursor=${cursor}`
            : route`/wiki/api/v2/pages/${pageId}/attachments?limit=250`;
          const res = await confluenceGet(path);
          if (res.status !== 200) {
            ok = false;
            if (res.status === 403 && !warnedAttachmentScope) {
              warnedAttachmentScope = true;
              console.warn("attachments: HTTP 403 — add the read:attachment:confluence scope to enable the attachment check");
            }
            break;
          }
          const body = (await res.json()) as { results?: Array<{ title?: string }>; _links?: { next?: string } };
          body.results?.forEach((a) => a.title && names.push(a.title));
          const next = body._links?.next;
          cursor = next ? new URL(next, "https://x").searchParams.get("cursor") ?? undefined : undefined;
          if (!cursor) break;
        }
        const result = ok ? names : undefined;
        cache.attachments.set(pageId, result);
        return result;
      },
    },
    jira: {
      async getIssue(key) {
        const hit = cache.issues.get(key);
        if (hit) return hit;
        const res = await jiraGet(route`/rest/api/3/issue/${key}?fields=summary,status,resolution`);
        let info: IssueInfo;
        if (res.status === 404) {
          info = { key, exists: false };
        } else if (res.status !== 200) {
          info = { key, exists: true }; // transient error: assume fine, never flag on a 5xx
        } else {
          const body = (await res.json()) as {
            key: string;
            fields: { summary?: string; status?: { name?: string; statusCategory?: { key?: string } }; resolution?: unknown };
          };
          info = {
            key,
            exists: true,
            summary: body.fields.summary,
            statusName: body.fields.status?.name,
            statusCategory: body.fields.status?.statusCategory?.key,
            resolved: !!body.fields.resolution,
            movedTo: body.key !== key ? body.key : undefined,
          };
        }
        cache.issues.set(key, info);
        return info;
      },
      async knownProjectKeys() {
        if (cache.projectKeys) return cache.projectKeys;
        const keys = new Set<string>();
        let startAt = 0;
        for (;;) {
          const res = await jiraGet(route`/rest/api/3/project/search?startAt=${startAt}&maxResults=100`);
          if (res.status !== 200) break;
          const body = (await res.json()) as { values: Array<{ key: string }>; isLast: boolean };
          body.values.forEach((p) => keys.add(p.key));
          if (body.isLast) break;
          startAt += 100;
        }
        cache.projectKeys = keys;
        return keys;
      },
      async getComponents(projectKey) {
        const hit = cache.components.get(projectKey);
        if (hit) return hit;
        // Not paginated: returns every component of the project.
        const res = await jiraGet(route`/rest/api/3/project/${projectKey}/components`);
        let list: ComponentInfo[] = [];
        if (res.status === 200) {
          const body = (await res.json()) as Array<{ id: string; name: string; archived?: boolean }>;
          list = body.map((c) => ({ id: c.id, name: c.name, archived: !!c.archived }));
        }
        cache.components.set(projectKey, list);
        return list;
      },
      async getVersions(projectKey) {
        const hit = cache.versions.get(projectKey);
        if (hit) return hit;
        // Not paginated: returns every version of the project.
        const res = await jiraGet(route`/rest/api/3/project/${projectKey}/versions`);
        let list: VersionInfo[] = [];
        if (res.status === 200) {
          const body = (await res.json()) as Array<{
            id: string;
            name: string;
            archived?: boolean;
            released?: boolean;
            releaseDate?: string;
          }>;
          list = body.map((v) => ({
            id: v.id,
            name: v.name,
            archived: !!v.archived,
            released: !!v.released,
            releaseDate: v.releaseDate,
          }));
        }
        cache.versions.set(projectKey, list);
        return list;
      },
    },
    users: {
      async isActive(accountId) {
        if (cache.users.has(accountId)) return cache.users.get(accountId);
        // Jira's user endpoint reliably exposes `active`; same Atlassian accounts as Confluence.
        const res = await jiraGet(route`/rest/api/3/user?accountId=${accountId}`);
        let active: boolean | undefined;
        if (res.status === 200) {
          const body = (await res.json()) as { active?: boolean; accountType?: string };
          active = body.accountType === "app" ? undefined : body.active;
        }
        cache.users.set(accountId, active);
        return active;
      },
    },
    now: () => new Date(),
  };
}

const spaceIds = new Map<string, string | undefined>();
async function spaceIdByKey(key: string): Promise<string | undefined> {
  if (spaceIds.has(key)) return spaceIds.get(key);
  const res = await confluenceGet(route`/wiki/api/v2/spaces?keys=${key}&limit=1`);
  let id: string | undefined;
  if (res.status === 200) {
    const body = (await res.json()) as { results?: Array<{ id: string }> };
    id = body.results?.[0]?.id;
  }
  spaceIds.set(key, id);
  return id;
}
