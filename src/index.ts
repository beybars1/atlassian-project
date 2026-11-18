/**
 * Forge entry points. Handlers referenced from manifest.yml.
 */
import Resolver from "@forge/resolver";
import { kvs } from "@forge/kvs";
import { chat, list } from "@forge/llm";
import { forgeClients } from "./forge/clients";
import { ForgeSqlRepo, migrate } from "./db/forgeSqlRepo";
import type { FindingStatus } from "./db/repo";
import { forgeLlmClient } from "./llm/client";
import { parseStaleThresholds } from "./checks/staleByType";
import { costRows } from "./ui/costReport";
import { runNightly, type SpaceConfig } from "./triggers/nightly";
import { scanBatch as scanBatchImpl } from "./workers/scanBatch";
import type { ScanBatchEvent } from "./scan/orchestrate";

const repo = new ForgeSqlRepo();
const llm = forgeLlmClient({ chat, list, log: (line) => console.log(line) });

/** Check 5 thresholds: admin values from KVS merged over the code defaults. */
const staleThresholds = async () => parseStaleThresholds(await kvs.get("config.staleDays"));

export async function nightly() {
  await migrate();
  const result = await runNightly(repo);
  console.log("nightly", JSON.stringify(result));
}

// Consumer resolver: manifest `consumer.resolver.method: scan`
const consumer = new Resolver();
consumer.define("scan", async ({ payload }) => {
  await migrate();
  const scanned = await scanBatchImpl(payload as ScanBatchEvent, repo, forgeClients(), {
    llm,
    staleThresholds: await staleThresholds(),
  });
  return { scanned };
});
export const scanBatch = consumer.getDefinitions();

// UI resolver for the dashboard
const ui = new Resolver();
ui.define("getSpaces", async () => ((await kvs.get("config.spaces")) as SpaceConfig[] | undefined) ?? []);
ui.define("setSpaces", async ({ payload }) => {
  await kvs.set("config.spaces", (payload as { spaces: SpaceConfig[] }).spaces);
  return { ok: true };
});
ui.define("getStaleDays", async () => staleThresholds());
ui.define("setStaleDays", async ({ payload }) => {
  const parsed = parseStaleThresholds((payload as { staleDays: unknown }).staleDays);
  await kvs.set("config.staleDays", parsed);
  return parsed;
});
ui.define("topFindings", async ({ payload }) => {
  await migrate();
  const { spaceId, limit = 20, status = "open" } = payload as { spaceId: string; limit?: number; status?: FindingStatus };
  if (status !== "open" && status !== "dismissed") throw new Error(`unknown status: ${String(status)}`);
  return repo.findingsByStatus(spaceId, status, Math.min(limit, 100));
});
ui.define("setFindingStatus", async ({ payload }) => {
  await migrate();
  const { id, status } = payload as { id: string; status: FindingStatus };
  if (status !== "open" && status !== "dismissed") throw new Error(`unknown status: ${String(status)}`);
  return { ok: await repo.setFindingStatus(String(id), status) };
});
ui.define("recentRuns", async ({ payload }) => {
  await migrate();
  const { spaceId, limit = 10 } = payload as { spaceId: string; limit?: number };
  return costRows(await repo.recentRuns(spaceId, Math.min(limit, 50)));
});
ui.define("runNow", async () => {
  await migrate();
  return runNightly(repo);
});
export const resolver = ui.getDefinitions();
