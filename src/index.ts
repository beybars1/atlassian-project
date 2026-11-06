/**
 * Forge entry points. Handlers referenced from manifest.yml.
 */
import Resolver from "@forge/resolver";
import { kvs } from "@forge/kvs";
import { forgeClients } from "./forge/clients";
import { ForgeSqlRepo, migrate } from "./db/forgeSqlRepo";
import { runNightly, type SpaceConfig } from "./triggers/nightly";
import { scanBatch as scanBatchImpl } from "./workers/scanBatch";
import type { ScanBatchEvent } from "./scan/orchestrate";

const repo = new ForgeSqlRepo();

export async function nightly() {
  await migrate();
  const result = await runNightly(repo);
  console.log("nightly", JSON.stringify(result));
}

// Consumer resolver: manifest `consumer.resolver.method: scan`
const consumer = new Resolver();
consumer.define("scan", async ({ payload }) => {
  await migrate();
  const scanned = await scanBatchImpl(payload as ScanBatchEvent, repo, forgeClients());
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
ui.define("topFindings", async ({ payload }) => {
  await migrate();
  const { spaceId, limit = 20 } = payload as { spaceId: string; limit?: number };
  return repo.openFindings(spaceId, limit);
});
ui.define("runNow", async () => {
  await migrate();
  return runNightly(repo);
});
export const resolver = ui.getDefinitions();
