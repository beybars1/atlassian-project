import type { Check, Finding } from "./types";

/**
 * Check 4 — placeholder and unfinished-template text.
 * Pure regex. Conservative on purpose: a false "TODO" on a legitimate task list is worse than a miss.
 */
const PATTERNS: Array<{ re: RegExp; label: string; severity: "medium" | "low" }> = [
  { re: /\bTBD\b/g, label: "TBD", severity: "medium" },
  { re: /\bTBA\b/g, label: "TBA", severity: "medium" },
  { re: /\bTODO\b[:\s]/g, label: "TODO", severity: "medium" },
  { re: /\bFIXME\b/g, label: "FIXME", severity: "medium" },
  { re: /\blorem ipsum\b/gi, label: "lorem ipsum", severity: "medium" },
  { re: /\[insert[^\]]*\]/gi, label: "[insert …]", severity: "medium" },
  { re: /\[(name|date|owner|link|description|your [a-z ]+)\]/gi, label: "[template field]", severity: "medium" },
  { re: /\bcoming soon\b/gi, label: "coming soon", severity: "low" },
  { re: /\bto be (added|written|completed|defined|determined)\b/gi, label: "to be …", severity: "low" },
  { re: /\bwork in progress\b|\bWIP\b/g, label: "WIP", severity: "low" },
];

export const placeholders: Check = async (page): Promise<Finding[]> => {
  const findings: Finding[] = [];
  const hits: Array<{ label: string; count: number; sample: string; severity: "medium" | "low" }> = [];

  for (const p of PATTERNS) {
    const matches = [...page.text.matchAll(p.re)];
    if (matches.length === 0) continue;
    const sample = snippet(page.text, matches[0].index ?? 0);
    hits.push({ label: p.label, count: matches.length, sample, severity: p.severity });
  }
  if (hits.length === 0) return findings;

  const severity = hits.some((h) => h.severity === "medium") ? "medium" : "low";
  const evidence = hits.map((h) => `${h.label} ×${h.count} — "${h.sample}"`).join("; ");
  findings.push({
    pageId: page.id,
    check: "PLACEHOLDER",
    severity,
    evidence,
    suggestion: "Fill in or remove the placeholder text, or mark the page as draft.",
  });
  return findings;
};

function snippet(text: string, at: number, width = 60): string {
  const start = Math.max(0, at - width / 2);
  return text.slice(start, start + width).replace(/\s+/g, " ").trim();
}
