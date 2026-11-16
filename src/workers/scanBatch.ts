/**
 * Async-events consumer: scans one batch of pages and stores findings.
 */
import { runChecks, V0_CHECKS } from "../checks";
import { contradictionFindings } from "../checks/contradiction";
import { makeStaleByType, type StaleThresholds } from "../checks/staleByType";
import type { Clients, PageType } from "../checks/types";
import type { Repo, ScannedPage } from "../db/repo";
import { fetchPage } from "../forge/confluencePages";
import { adjudicateConflict } from "../llm/adjudicate";
import { classifyPageType } from "../llm/classifyPage";
import type { LlmClient } from "../llm/client";
import { extractFacts, MIN_EXTRACT_CHARS, type Fact } from "../llm/extractFacts";
import type { ScanBatchEvent } from "../scan/orchestrate";

export interface ScanDeps {
  /** Haiku classifier for check 5 and fact extraction + Sonnet adjudication for check 6. Without it, only labels / titles decide the page type and check 6 is off. */
  llm?: LlmClient;
  /** Admin thresholds for check 5; defaults from code when absent. */
  staleThresholds?: StaleThresholds;
}

type Tokens = { input: number; output: number };

export async function scanBatch(event: ScanBatchEvent, repo: Repo, clients: Clients, deps: ScanDeps = {}): Promise<number> {
  const checks = [...V0_CHECKS, makeStaleByType(deps.staleThresholds)];
  const tokens: Tokens = { input: 0, output: 0 };
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
        tokens.input += c.usage.input;
        tokens.output += c.usage.output;
        findings.push(...c.findings);
      }

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
      };
      if (facts?.fresh) await repo.replaceFacts(page.id, facts.facts);
      await repo.upsertPage(stored);
      await repo.replaceFindings(page.id, findings);
      scanned += 1;
    } catch (err) {
      console.error(`scan ${pageId} failed`, err);
    }
  }
  if (tokens.input || tokens.output) console.log(`batch llm tokens in=${tokens.input} out=${tokens.output}`);
  await repo.finishRun(`${event.runId}:${event.spaceId}`, { finishedAt: clients.now().toISOString(), pagesScanned: scanned });
  return scanned;
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
  tokens: Tokens,
): Promise<PageType | undefined> {
  if (prev?.pageType && prev.version === page.version) return prev.pageType;
  try {
    const c = await classifyPageType(llm, page);
    tokens.input += c.usage.input;
    tokens.output += c.usage.output;
    return c.type;
  } catch (err) {
    console.warn(`classify ${page.id} failed`, err);
    return undefined;
  }
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
  tokens: Tokens,
): Promise<{ facts: Fact[]; fresh: boolean } | undefined> {
  if (!llm) return undefined;
  if (prev?.factsVersion === page.version) return { facts: await repo.factsOfPage(page.id), fresh: false };
  if (page.text.length < MIN_EXTRACT_CHARS) return { facts: [], fresh: true };
  try {
    const r = await extractFacts(llm, page);
    tokens.input += r.usage.input;
    tokens.output += r.usage.output;
    return { facts: r.facts, fresh: true };
  } catch (err) {
    console.warn(`extract facts ${page.id} failed`, err);
    return undefined;
  }
}
