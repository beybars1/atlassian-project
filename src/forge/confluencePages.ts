import { route } from "@forge/api";
import type { PageRecord } from "../checks/types";
import { parseStorage } from "../text/storageToText";
import { confluenceGet } from "./http";

export interface PageHead {
  id: string;
  spaceId: string;
  title: string;
  version: number;
}

/** List all current pages in a space (v2, cursor-paged). Returns heads only; bodies are fetched per page. */
export async function listPageHeads(spaceId: string): Promise<PageHead[]> {
  const heads: PageHead[] = [];
  let cursor: string | undefined;
  for (;;) {
    const path = cursor
      ? route`/wiki/api/v2/spaces/${spaceId}/pages?limit=250&status=current&cursor=${cursor}`
      : route`/wiki/api/v2/spaces/${spaceId}/pages?limit=250&status=current`;
    const res = await confluenceGet(path);
    if (res.status !== 200) throw new Error(`list pages ${spaceId}: HTTP ${res.status}`);
    const body = (await res.json()) as {
      results: Array<{ id: string; spaceId: string; title: string; version: { number: number } }>;
      _links?: { next?: string };
    };
    body.results.forEach((p) => heads.push({ id: p.id, spaceId: p.spaceId, title: p.title, version: p.version.number }));
    const next = body._links?.next;
    cursor = next ? new URL(next, "https://x").searchParams.get("cursor") ?? undefined : undefined;
    if (!cursor) break;
  }
  return heads;
}

/** Fetch one page with storage body, owner and labels, parsed into a PageRecord. */
export async function fetchPage(pageId: string, spaceKey?: string): Promise<PageRecord> {
  const res = await confluenceGet(route`/wiki/api/v2/pages/${pageId}?body-format=storage&include-labels=true`);
  if (res.status !== 200) throw new Error(`fetch page ${pageId}: HTTP ${res.status}`);
  const p = (await res.json()) as {
    id: string;
    spaceId: string;
    title: string;
    ownerId?: string;
    authorId?: string;
    version: { number: number; createdAt: string; authorId?: string };
    body?: { storage?: { value: string } };
    labels?: { results?: Array<{ name: string }> };
  };
  const parsed = parseStorage(p.body?.storage?.value ?? "");
  return {
    id: p.id,
    spaceId: p.spaceId,
    spaceKey,
    title: p.title,
    version: p.version.number,
    ownerId: p.ownerId,
    lastEditorId: p.version.authorId ?? p.authorId,
    lastModified: p.version.createdAt,
    labels: p.labels?.results?.map((l) => l.name) ?? [],
    text: parsed.text,
    links: parsed.links,
    issueKeys: parsed.issueKeys,
  };
}
