import type { AttachmentRef, Check, Finding } from "./types";

/**
 * Check 1b — attachments referenced by the page that no longer exist (T12).
 * Covers <ac:image>/<ac:link> with <ri:attachment> on this page and /wiki/download/attachments/{id}/{file}
 * links to any page. Attachments referenced on another page *by title* are skipped: resolving the title
 * costs a request per reference and a wrong guess is a false positive.
 * When the attachment list of a page cannot be fetched (missing `read:attachment:confluence` scope,
 * error, page gone) the client returns `undefined` and nothing on that page is flagged.
 */
export const deadAttachments: Check = async (page, clients): Promise<Finding[]> => {
  const byPage = new Map<string, AttachmentRef[]>();
  for (const ref of page.attachments) {
    if (ref.pageTitle) continue;
    const owner = ref.pageId ?? page.id;
    const list = byPage.get(owner) ?? [];
    if (!list.some((r) => sameFile(r.filename, ref.filename))) list.push(ref);
    byPage.set(owner, list);
  }
  if (byPage.size === 0) return [];

  const missing: string[] = [];
  for (const [owner, refs] of byPage) {
    const existing = await clients.confluence.attachmentFilenames(owner);
    if (!existing) continue;
    for (const ref of refs) {
      if (existing.some((name) => sameFile(name, ref.filename))) continue;
      missing.push(`"${ref.filename}"${owner === page.id ? "" : ` (page #${owner})`}`);
    }
  }

  if (missing.length === 0) return [];
  return [
    {
      pageId: page.id,
      check: "DEAD_LINK",
      severity: missing.length >= 3 ? "high" : "medium",
      evidence: `${missing.length} missing attachment(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}.`,
      suggestion: "Re-upload the file or remove the reference.",
    },
  ];
};

/** Confluence filenames are case-sensitive, but a case-only difference is not worth a finding. */
function sameFile(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
