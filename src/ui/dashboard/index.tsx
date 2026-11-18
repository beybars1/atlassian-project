/**
 * UI Kit (render: native) dashboard. v0: pick spaces, run a scan, see the top 20 problem pages.
 * Kept minimal; replace with Custom UI if the table needs more than UI Kit offers.
 */
import React, { useEffect, useState } from "react";
import ForgeReconciler, { Text, Button, Heading, Stack, Inline, Label, Textfield, DynamicTable, Lozenge } from "@forge/react";
import { invoke as forgeInvoke } from "@forge/bridge";
import { findingLabel } from "../findingLabel";
import type { CostRow } from "../costReport";

/** invoke() may wrap the result in { body }; unwrap once here. */
async function invoke<T>(fn: string, payload?: Record<string, unknown>): Promise<T> {
  const r = (await forgeInvoke(fn, payload)) as T | { body: T };
  return r && typeof r === "object" && "body" in (r as object) ? (r as { body: T }).body : (r as T);
}

type SpaceConfig = { spaceId: string; spaceKey?: string };
/** Check 5 thresholds (days); null = that type is never flagged. Mirrors `StaleThresholds` in src/checks. */
type StaleDays = Record<string, number | null>;
const STALE_TYPES: Array<[key: string, label: string]> = [
  ["runbook", "Runbooks"],
  ["how-to", "How-to guides"],
  ["onboarding", "Onboarding"],
  ["decision", "Decision records"],
  ["meeting-notes", "Meeting notes"],
];
type Row = {
  page: { pageId: string; title: string; lastModified: string };
  findings: Array<{ check: string; severity: "high" | "medium" | "low"; evidence: string; related?: { pageId: string; pageTitle: string } }>;
};

const App = () => {
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [staleDraft, setStaleDraft] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<CostRow[]>([]);

  useEffect(() => {
    invoke<SpaceConfig[]>("getSpaces").then((s: SpaceConfig[]) => {
      setSpaces(s);
      setDraft(s.map((x: SpaceConfig) => x.spaceId).join(","));
      if (s[0]) {
        invoke<Row[]>("topFindings", { spaceId: s[0].spaceId }).then(setRows);
        invoke<CostRow[]>("recentRuns", { spaceId: s[0].spaceId }).then(setRuns);
      }
    });
    invoke<StaleDays>("getStaleDays").then((d: StaleDays) =>
      setStaleDraft(Object.fromEntries(STALE_TYPES.map(([k]) => [k, d[k] == null ? "" : String(d[k])]))),
    );
  }, []);

  const saveStale = async () => {
    // Empty field = off; the resolver validates and returns what it stored.
    const staleDays = Object.fromEntries(STALE_TYPES.map(([k]) => [k, staleDraft[k]?.trim() === "" ? null : staleDraft[k]]));
    const stored = await invoke<StaleDays>("setStaleDays", { staleDays });
    setStaleDraft(Object.fromEntries(STALE_TYPES.map(([k]) => [k, stored[k] == null ? "" : String(stored[k])])));
  };

  const save = async () => {
    const next = draft.split(",").map((x) => x.trim()).filter(Boolean).map((spaceId) => ({ spaceId }));
    await invoke("setSpaces", { spaces: next });
    setSpaces(next);
  };

  const run = async () => {
    setBusy(true);
    await invoke("runNow");
    setBusy(false);
  };

  return (
    <Stack space="space.200">
      <Heading as="h2">WikiVerify</Heading>
      <Text>Space IDs to scan nightly (comma-separated):</Text>
      <Textfield value={draft} onChange={(e: any) => setDraft(e.target.value)} />
      <Button onClick={save}>Save spaces</Button>
      <Button onClick={run} isDisabled={busy || spaces.length === 0}>
        {busy ? "Queued…" : "Scan now"}
      </Button>
      <Heading as="h3">Stale-page thresholds</Heading>
      <Text>Days since the last edit after which a page of each type is reported. Leave empty to never report that type.</Text>
      <Inline space="space.200" shouldWrap>
        {STALE_TYPES.map(([key, label]) => (
          <Stack key={key} space="space.050">
            <Label labelFor={`stale-${key}`}>{label}</Label>
            <Textfield
              id={`stale-${key}`}
              width="small"
              value={staleDraft[key] ?? ""}
              onChange={(e: any) => setStaleDraft({ ...staleDraft, [key]: e.target.value })}
            />
          </Stack>
        ))}
      </Inline>
      <Button onClick={saveStale}>Save thresholds</Button>
      <DynamicTable
        head={{ cells: [{ content: "Page" }, { content: "Severity" }, { content: "What is wrong" }] }}
        rows={rows.map((r) => ({
          key: r.page.pageId,
          cells: [
            { content: r.page.title },
            {
              content: (
                <Lozenge appearance={r.findings.some((f) => f.severity === "high") ? "removed" : "moved"}>
                  {r.findings.length} issue(s)
                </Lozenge>
              ),
            },
            { content: r.findings.map((f) => `${findingLabel(f)}: ${f.evidence}`).join(" | ") },
          ],
        }))}
        emptyView={<Text>No findings yet. Save a space and run a scan.</Text>}
      />
      <Heading as="h3">Scan cost</Heading>
      <Text>LLM tokens per nightly run and their estimated price at list rates. "Per 2,000 pages" projects this run's rate onto a full scan of a large space.</Text>
      <DynamicTable
        head={{
          cells: [{ content: "Run" }, { content: "Pages scanned" }, { content: "Haiku tokens" }, { content: "Sonnet tokens" }, { content: "Cost" }, { content: "Per 2,000 pages" }],
        }}
        rows={runs.map((r) => ({
          key: r.id,
          cells: [
            { content: r.date },
            { content: r.pages },
            { content: r.haiku },
            { content: r.sonnet },
            { content: r.overBudget ? <Lozenge appearance="removed">{r.cost}</Lozenge> : r.cost },
            { content: r.per2000 },
          ],
        }))}
        emptyView={<Text>No scan runs yet.</Text>}
      />
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
