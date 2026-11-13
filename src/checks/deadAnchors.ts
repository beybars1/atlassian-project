import type { Check, Finding } from "./types";

/**
 * Check 1c — same-page anchor links that point nowhere (T12).
 * A target is alive when it matches an anchor macro, an element id, or a heading — in any of the
 * forms Confluence has generated over the years ("Heading text", "Headingtext", "Page-Title-Heading-text",
 * "Headingtext.1" for duplicate headings). Comparison ignores case and non-alphanumerics, so the check
 * never has to know which editor wrote the page. Anchors into other pages are not checked, and a page that
 * includes other pages (include / excerpt-include macros) is skipped: their anchors are not visible here.
 */
export const deadAnchors: Check = async (page): Promise<Finding[]> => {
  const { targets, names, headings, hasIncludes } = page.anchors;
  if (targets.length === 0 || hasIncludes) return [];

  const title = norm(page.title);
  const alive = new Set<string>();
  for (const n of [...names, ...headings]) {
    const k = norm(n);
    if (!k) continue;
    alive.add(k);
    if (title) alive.add(title + k);
  }

  const dead: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const k = norm(target);
    if (!k || k === "top" || seen.has(k)) continue;
    seen.add(k);
    if (!isAlive(k, alive)) dead.push(`#${target}`);
  }

  if (dead.length === 0) return [];
  return [
    {
      pageId: page.id,
      check: "DEAD_LINK",
      severity: "low",
      evidence: `${dead.length} anchor link(s) with no target on this page: ${dead.slice(0, 5).join(", ")}${dead.length > 5 ? ", …" : ""}.`,
      suggestion: "Point the link at an existing heading or add an anchor macro with that name.",
    },
  ];
};

function isAlive(key: string, alive: Set<string>): boolean {
  if (alive.has(key)) return true;
  // Duplicate headings get a numeric suffix ("Deploysteps.1"); accept any digits after a known anchor.
  for (let i = key.length - 1; i > 0 && /\d/.test(key[i]); i--) {
    if (alive.has(key.slice(0, i))) return true;
  }
  return false;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
