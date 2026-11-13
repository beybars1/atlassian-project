/**
 * Confluence "storage format" (XHTML with ac:/ri: namespaces) → plain text + links + Jira keys.
 * Deliberately regex-based: no DOM dependency, runs in Forge's Node runtime and in tests.
 * Good enough for v0; swap for a real parser if findings show false positives.
 */

import type { AttachmentRef, PageAnchors, PageLink } from "../checks/types";

const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9_]{1,9})-(\d{1,6})\b/g;
const DOWNLOAD_RE = /^\/wiki\/download\/(?:attachments|thumbnails)\/(\d+)\/([^/?#]+)/;

export interface ParsedStorage {
  text: string;
  links: PageLink[];
  issueKeys: string[];
  attachments: AttachmentRef[];
  anchors: PageAnchors;
}

export function parseStorage(storage: string, opts: { siteBase?: string } = {}): ParsedStorage {
  const links: PageLink[] = [];
  const issueKeys = new Set<string>();
  const attachments: AttachmentRef[] = [];
  const anchors: PageAnchors = { targets: [], names: [], headings: [], hasIncludes: false };

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
  const anchorTargets: Array<{ at: number; target: string }> = [];
  for (const m of storage.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)) {
    const href = decode(m[1]);
    const link = classifyHref(href, opts.siteBase);
    links.push(link);
    if (href.startsWith("#")) {
      const target = urlDecode(href.slice(1));
      if (target) anchorTargets.push({ at: m.index ?? 0, target });
      continue;
    }
    const download = !link.external && DOWNLOAD_RE.exec(sitePath(href, opts.siteBase) ?? "");
    if (download) attachments.push({ filename: urlDecode(download[2]), kind: "download", pageId: download[1] });
  }

  // 4. Attachments referenced by filename: <ri:attachment ri:filename="X"/> inside <ac:image>, <ac:link>
  //    or a file macro; a nested <ri:page> means the attachment lives on another page.
  for (const m of storage.matchAll(/<ri:attachment\b([^>]*?)(?:\/>|>([\s\S]*?)<\/ri:attachment>)/g)) {
    const filename = attr(m[1], "ri:filename");
    if (!filename) continue;
    const ref: AttachmentRef = { filename: decode(filename), kind: insideImage(storage, m.index ?? 0) ? "image" : "link" };
    const owner = m[2] ? /<ri:page\b([^>]*)\/?>/.exec(m[2]) : null;
    if (owner) {
      const title = attr(owner[1], "ri:content-title");
      if (title) ref.pageTitle = decode(title);
      const spaceKey = attr(owner[1], "ri:space-key");
      if (spaceKey) ref.spaceKey = spaceKey;
    }
    attachments.push(ref);
  }

  // 5. Same-page anchors: <ac:link ac:anchor="X"> with no page/attachment inside; anchor macros; ids; headings.
  for (const m of storage.matchAll(/<ac:link\b([^>]*)(?:\/>|>([\s\S]*?)<\/ac:link>)/g)) {
    const anchor = attr(m[1], "ac:anchor");
    if (!anchor || /<ri:(page|attachment)\b/.test(m[2] ?? "")) continue;
    const target = decode(anchor).trim();
    if (target) anchorTargets.push({ at: m.index ?? 0, target });
  }
  anchors.targets = anchorTargets.sort((a, b) => a.at - b.at).map((t) => t.target);
  for (const m of storage.matchAll(
    /<ac:structured-macro\b[^>]*ac:name="anchor"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
  )) {
    const name = /<ac:parameter\b[^>]*>([^<]*)<\/ac:parameter>/.exec(m[1])?.[1]?.trim();
    if (name) anchors.names.push(decode(name));
  }
  for (const m of storage.matchAll(/\sid="([^"]+)"/g)) anchors.names.push(decode(m[1]));
  for (const m of storage.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const heading = toText(m[2]);
    if (heading) anchors.headings.push(heading);
  }
  anchors.hasIncludes = /<ac:structured-macro\b[^>]*ac:name="(include|excerpt-include)"/.test(storage);

  // 6. Text
  const text = toText(storage);

  // 7. Issue keys in text (filtered later against known project keys)
  for (const m of text.matchAll(ISSUE_KEY_RE)) issueKeys.add(`${m[1]}-${m[2]}`);
  for (const l of links) if (l.issueKey) issueKeys.add(l.issueKey);

  return { text, links, issueKeys: [...issueKeys], attachments, anchors };
}

/** Site-relative path of an href when it is relative or on the given site base; otherwise undefined. */
function sitePath(href: string, siteBase?: string): string | undefined {
  const base = siteBase?.replace(/\/$/, "");
  if (base && href.startsWith(base)) return href.slice(base.length);
  return href.startsWith("/") ? href : undefined;
}

function insideImage(storage: string, at: number): boolean {
  const open = storage.lastIndexOf("<ac:image", at);
  return open >= 0 && storage.indexOf("</ac:image>", open) >= at;
}

function urlDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function classifyHref(href: string, siteBase?: string): PageLink {
  const path = sitePath(href, siteBase);
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
