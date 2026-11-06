/**
 * Confluence "storage format" (XHTML with ac:/ri: namespaces) → plain text + links + Jira keys.
 * Deliberately regex-based: no DOM dependency, runs in Forge's Node runtime and in tests.
 * Good enough for v0; swap for a real parser if findings show false positives.
 */

import type { PageLink } from "../checks/types";

const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9_]{1,9})-(\d{1,6})\b/g;

export interface ParsedStorage {
  text: string;
  links: PageLink[];
  issueKeys: string[];
}

export function parseStorage(storage: string, opts: { siteBase?: string } = {}): ParsedStorage {
  const links: PageLink[] = [];
  const issueKeys = new Set<string>();

  // 1. Internal page links: <ac:link><ri:page ri:content-title="X" ri:space-key="Y"/></ac:link>
  for (const m of storage.matchAll(/<ri:page\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const title = attr(attrs, "ri:content-title");
    const spaceKey = attr(attrs, "ri:space-key");
    if (title) {
      links.push({ href: `ri:page:${spaceKey ?? ""}:${title}`, pageTitle: decode(title), spaceKey, external: false });
    }
  }

  // 2. Jira macros: <ac:structured-macro ac:name="jira">…<ac:parameter ac:name="key">ABC-1</ac:parameter>
  for (const m of storage.matchAll(
    /<ac:structured-macro\b[^>]*ac:name="jira"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
  )) {
    const key = /<ac:parameter\b[^>]*ac:name="key"[^>]*>([^<]+)<\/ac:parameter>/.exec(m[1])?.[1];
    if (key) {
      issueKeys.add(key.trim());
      links.push({ href: `jira:${key.trim()}`, issueKey: key.trim(), external: false });
    }
  }

  // 3. Plain anchors
  for (const m of storage.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)) {
    const href = decode(m[1]);
    links.push(classifyHref(href, opts.siteBase));
  }

  // 4. Text
  const text = toText(storage);

  // 5. Issue keys in text (filtered later against known project keys)
  for (const m of text.matchAll(ISSUE_KEY_RE)) issueKeys.add(`${m[1]}-${m[2]}`);
  for (const l of links) if (l.issueKey) issueKeys.add(l.issueKey);

  return { text, links, issueKeys: [...issueKeys] };
}

export function classifyHref(href: string, siteBase?: string): PageLink {
  const base = siteBase?.replace(/\/$/, "");
  const isSite = !!base && href.startsWith(base);
  const relative = href.startsWith("/");
  const path = isSite ? href.slice(base!.length) : relative ? href : undefined;

  if (path) {
    const page = /^\/wiki\/spaces\/([^/]+)\/pages\/(\d+)/.exec(path);
    if (page) return { href, spaceKey: page[1], pageId: page[2], external: false };
    const issue = /^\/browse\/([A-Z][A-Z0-9_]+-\d+)/.exec(path);
    if (issue) return { href, issueKey: issue[1], external: false };
    return { href, external: false };
  }
  if (/^(https?:)?\/\//.test(href)) return { href, external: true };
  // mailto:, anchors, etc.
  return { href, external: false };
}

export function toText(storage: string): string {
  return decode(
    storage
      .replace(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/g, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ")
      .replace(/<\/(p|div|h[1-6]|li|tr|table|br|ac:layout-section|ac:layout-cell)>/g, "\n")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name.replace(":", "\\:")}="([^"]*)"`).exec(attrs);
  return m?.[1];
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}
