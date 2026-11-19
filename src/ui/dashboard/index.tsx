/**
 * UI Kit (render: native) dashboard. v1 (T18): settings on top, then one tab per scanned space with
 * a severity filter, the problem pages (linked), a "Dismiss" per finding, and the space's scan cost.
 * Kept minimal; replace with Custom UI if the table needs more than UI Kit offers.
 */
import React, { useCallback, useEffect, useState } from "react";
import ForgeReconciler, {
  Text, Button, Heading, Stack, Inline, Label, Textfield, DynamicTable, Lozenge, Tabs, TabList, Tab, TabPanel, Link, Select, Toggle,
} from "@forge/react";
import { invoke as forgeInvoke } from "@forge/bridge";
import { findingLabel } from "../findingLabel";
import type { CostRow } from "../costReport";
import { SEVERITY_OPTIONS, filterBySeverity, pageUrl, sortFindings, spaceLabel, type DashboardRow, type SeverityFilter } from "../dashboardRows";

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

const SEVERITY_APPEARANCE = { high: "removed", medium: "moved", low: "default" } as const;

/** One space: its findings (open or dismissed), the severity filter and its cost table. */
const SpacePanel = ({ space }: { space: SpaceConfig }) => {
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [runs, setRuns] = useState<CostRow[]>([]);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  const status = showDismissed ? "dismissed" : "open";
  const load = useCallback(async () => {
    setLoading(true);
    setRows(await invoke<DashboardRow[]>("topFindings", { spaceId: space.spaceId, status }));
    setLoading(false);
  }, [space.spaceId, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    invoke<CostRow[]>("recentRuns", { spaceId: space.spaceId }).then(setRuns);
  }, [space.spaceId]);

  const setStatus = async (id: string, next: "open" | "dismissed") => {
    await invoke("setFindingStatus", { id, status: next });
    await load();
  };

  const visible = filterBySeverity(rows, severity);
  return (
    <Stack space="space.200">
      <Inline space="space.200" alignBlock="center" shouldWrap>
        <Select
          id={`severity-${space.spaceId}`}
          options={SEVERITY_OPTIONS}
          value={SEVERITY_OPTIONS.find((o) => o.value === severity)}
          onChange={(o: any) => setSeverity((o?.value as SeverityFilter) ?? "all")}
          spacing="compact"
        />
        <Toggle id={`dismissed-${space.spaceId}`} label="Show dismissed" isChecked={showDismissed} onChange={() => setShowDismissed(!showDismissed)} />
      </Inline>
      <DynamicTable
        isLoading={loading}
        head={{ cells: [{ content: "Page" }, { content: "Issues" }, { content: "What is wrong" }] }}
        rows={visible.map((r) => ({
          key: r.page.pageId,
          cells: [
            {
              content: (
                <Link href={pageUrl(r.page.pageId)} openNewTab>
                  {r.page.title}
                </Link>
              ),
            },
            {
              content: (
                <Lozenge appearance={r.findings.some((f) => f.severity === "high") ? "removed" : "moved"}>
                  {r.findings.length} issue(s)
                </Lozenge>
              ),
            },
            {
              content: (
                <Stack space="space.100">
                  {sortFindings(r.findings).map((f) => (
                    <Inline key={f.id} space="space.100" alignBlock="center" shouldWrap>
                      <Lozenge appearance={SEVERITY_APPEARANCE[f.severity]}>{f.severity}</Lozenge>
                      <Text>
                        {findingLabel(f)}: {f.evidence}
                      </Text>
                      {f.status === "open" ? (
                        <Button appearance="subtle" spacing="compact" onClick={() => setStatus(f.id, "dismissed")}>
                          Dismiss
                        </Button>
                      ) : (
                        <Button appearance="subtle" spacing="compact" onClick={() => setStatus(f.id, "open")}>
                          Restore
                        </Button>
                      )}
                    </Inline>
                  ))}
                </Stack>
              ),
            },
          ],
        }))}
        emptyView={<Text>{showDismissed ? "No dismissed findings." : "No open findings. Run a scan, or widen the severity filter."}</Text>}
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

const App = () => {
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [staleDraft, setStaleDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    invoke<SpaceConfig[]>("getSpaces").then((s: SpaceConfig[]) => {
      setSpaces(s);
      setDraft(s.map((x: SpaceConfig) => x.spaceId).join(","));
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
    // Keep a space key the admin entered before (the id is what identifies the space).
    const keys = new Map(spaces.map((s) => [s.spaceId, s.spaceKey]));
    const next = draft
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((spaceId) => (keys.get(spaceId) ? { spaceId, spaceKey: keys.get(spaceId) } : { spaceId }));
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
      <Inline space="space.100">
        <Button onClick={save}>Save spaces</Button>
        <Button onClick={run} isDisabled={busy || spaces.length === 0}>
          {busy ? "Queued…" : "Scan now"}
        </Button>
      </Inline>
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
      <Heading as="h3">Findings</Heading>
      {spaces.length === 0 ? (
        <Text>No spaces configured. Save a space and run a scan.</Text>
      ) : (
        <Tabs id="spaces">
          <TabList>
            {spaces.map((s) => (
              <Tab key={s.spaceId}>{spaceLabel(s)}</Tab>
            ))}
          </TabList>
          {spaces.map((s) => (
            <TabPanel key={s.spaceId}>
              <SpacePanel space={s} />
            </TabPanel>
          ))}
        </Tabs>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
