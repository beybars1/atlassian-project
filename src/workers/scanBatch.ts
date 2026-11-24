/**
 * Async-events consumer: scans one batch of pages and stores findings.
 */
import { runChecks, V0_CHECKS } from "../checks";
import { contradictionFindings } from "../checks/contradiction";
import { makeJiraRenamed, type JiraRename, type RenameSource } from "../checks/jiraRenamed";
import { makeStaleByType, type StaleThresholds } from "../checks/staleByType";
import type { Clients, Finding, PageType } from "../checks/types";
import type { Repo, ScannedPage } from "../db/repo";
import { fetchPage } from "../forge/confluencePages";
import { adjudicateConflict } from "../llm/adjudicate";
import { classifyPageType } from "../llm/classifyPage";
import type { LlmClient } from "../llm/client";
import { addUsage, costAlert, emptyUsage, usageCostUsd, type LlmUsage } from "../llm/cost";
import { extractFacts, MIN_EXTRACT_CHARS, type Fact } from "../llm/extractFacts";
import { addFixPreviews, FIX_CHECKS } from "../llm/suggestFix";
import type { ScanBatchEvent } from "../scan/orchestrate";
import { projectKeysOf, refreshJiraNames } from "../scan/renameRescan";

export interface ScanDeps {
  /** Haiku classifier for check 5, fact extraction + Sonnet adjudication for check 6, Sonnet fix drafts (check 8). Without it, only labels / titles decide the page type, check 6 is off and suggestions stay generic. */
  llm?: LlmClient;
  /** Admin thresholds for check 5; defaults from code when absent. */
  staleThresholds?: StaleThresholds;
}

export async function scanBatch(event: ScanBatchEvent, repo: Repo, clients: Clients, deps: ScanDeps = {}): Promise<number> {
  const checks = [...V0_CHECKS, makeStaleByType(deps.staleThresholds), makeJiraRenamed(renameSource(repo, clients))];
  const tokens = emptyUsage();
  let scanned = 0;
  for (const pageId of event.pageIds) {
    try {
      const page = await fetchPage(pageId, event.spaceKey);
      const prev = await repo.getPage(page.id);
      page.pageType = await resolvePageType(page, prev, deps.llm, tokens);
      const findings = await runChecks(page, clients, checks);

      const facts = await resolveFacts(page, prev, repo, deps.llm, tokens);
      if (facts) {
        const other = await repo.factsForKeys(page.spaceId, facts.facts.map((f) => ({ entity: f.entity, attribute: f.attribute })));
        const llm = deps.llm!;
        const c = await contradictionFindings({
          page,
          pageFacts: facts.facts,
          otherFacts: other,
          adjudicate: (conflict) => adjudicateConflict(llm, conflict),
          jira: (key) => clients.jira.getIssue(key),
        });
        addUsage(tokens, "smart", c.usage);
        findings.push(...c.findings);
      }

      const withFixes = await resolveFixPreviews(page, prev, findings, repo, deps.llm, tokens);
      findings.splice(0, findings.length, ...withFixes);

      const stored: ScannedPage = {
        pageId: page.id,
        spaceId: page.spaceId,
        title: page.title,
        version: page.version,
        ownerId: page.ownerId,
        lastModified: page.lastModified,
        scannedAt: clients.now().toISOString(),
        pageType: page.pageType,
        factsVersion: facts ? page.version : undefined,
        projectKeys: projectKeysOf(page.issueKeys),
      };
      if (facts?.fresh) await repo.replaceFacts(page.id, facts.facts);
      await repo.upsertPage(stored);
      await repo.replaceFindings(page.id, findings);
      scanned += 1;
    } catch (err) {
      console.error(`scan ${pageId} failed`, err);
    }
  }
  const spent = usageCostUsd(tokens);
  if (spent > 0) {
    console.log(
      `batch llm tokens haiku in=${tokens.fast.input} out=${tokens.fast.output} sonnet in=${tokens.smart.input} out=${tokens.smart.output} $${spent.toFixed(4)}`,
    );
  }
  const run = await repo.recordBatch(`${event.runId}:${event.spaceId}`, { pagesScanned: scanned, usage: tokens, finishedAt: clients.now().toISOString() });
  const alert = run && costAlert(run, tokens);
  if (alert) console.warn(alert);
  return scanned;
}

/**
 * Check 3c's rename source, one refresh per project per batch: Jira's current component / version
 * names go into the `jira_names` snapshot and are diffed against what the snapshot held before
 * (`refreshJiraNames`, shared with the nightly's rescan-on-rename, T19d).
 * Any failure means "no renames known" for that project tonight — never a wrong finding.
 */
function renameSource(repo: Repo, clients: Clients): RenameSource {
  const cache = new Map<string, Promise<JiraRename[]>>();
  return (project) => {
    let p = cache.get(project);
    if (!p) {
      p = refreshJiraNames(repo, clients, project).catch((err) => {
        console.warn(`jira names refresh ${project} failed`, err);
        return [];
      });
      cache.set(project, p);
    }
    return p;
  };
}

/**
 * Page type for check 5: reuse the cached classification when the version is unchanged, otherwise
 * classify (labels → title → Haiku). A classifier failure logs and leaves the type unknown, so the
 * page is still scanned by the other checks and check 5 stays silent for it.
 */
async function resolvePageType(
  page: { id: string; title: string; text: string; labels: string[]; version: number },
  prev: ScannedPage | undefined,
  llm: LlmClient | undefined,
  tokens: LlmUsage,
): Promise<PageType | undefined> {
  if (prev?.pageType && prev.version === page.version) return prev.pageType;
  try {
    const c = await classifyPageType(llm, page);
    addUsage(tokens, "fast", c.usage);
    return c.type;
  } catch (err) {
    console.warn(`classify ${page.id} failed`, err);
    return undefined;
  }
}

/**
 * Check 8 (T19b): concrete fix text for the findings of checks 3, 4 and 6 on this page — Sonnet,
 * at most `MAX_FIXES_PER_PAGE` calls. A rescan of the same version reuses the stored suggestions
 * (no call, and a dismissed finding keeps its identity); a changed page is drafted afresh. Without
 * an LLM, or when drafting fails, the generic suggestions stay.
 */
async function resolveFixPreviews(
  page: { id: string; title: string; text: string; version: number },
  prev: ScannedPage | undefined,
  findings: Finding[],
  repo: Repo,
  llm: LlmClient | undefined,
  tokens: LlmUsage,
): Promise<Finding[]> {
  if (!llm || !findings.some((f) => f.pageId === page.id && FIX_CHECKS.has(f.check))) return findings;
  let stored: Finding[] = [];
  if (prev?.version === page.version) {
    stored = [...(await repo.findingsOfPage(page.id, "open")), ...(await repo.findingsOfPage(page.id, "dismissed"))];
  }
  const r = await addFixPreviews({ llm, page, findings, stored, log: (line) => console.warn(line) });
  addUsage(tokens, "smart", r.usage);
  return r.findings;
}

/**
 * Facts for check 6: the stored ones when they belong to this version, otherwise Haiku (short
 * pages get an empty list without a call). `undefined` = no facts available (no LLM, or extraction
 * failed — then `factsVersion` stays unset so the next scan retries) and check 6 is skipped.
 */
async function resolveFacts(
  page: { id: string; title: string; text: string; version: number; issueKeys: string[] },
  prev: ScannedPage | undefined,
  repo: Repo,
  llm: LlmClient | undefined,
  tokens: LlmUsage,
): Promise<{ facts: Fact[]; fresh: boolean } | undefined> {
  if (!llm) return undefined;
  if (prev?.factsVersion === page.version) return { facts: await repo.factsOfPage(page.id), fresh: false };
  if (page.text.length < MIN_EXTRACT_CHARS) return { facts: [], fresh: true };
  try {
    const r = await extractFacts(llm, page);
    addUsage(tokens, "fast", r.usage);
    return { facts: r.facts, fresh: true };
  } catch (err) {
    console.warn(`extract facts ${page.id} failed`, err);
    return undefined;
  }
}
