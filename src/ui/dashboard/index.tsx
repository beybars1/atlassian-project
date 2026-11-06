/**
 * UI Kit (render: native) dashboard. v0: pick spaces, run a scan, see the top 20 problem pages.
 * Kept minimal; replace with Custom UI if the table needs more than UI Kit offers.
 */
import React, { useEffect, useState } from "react";
import ForgeReconciler, { Text, Button, Heading, Stack, Textfield, DynamicTable, Lozenge } from "@forge/react";
import { invoke as forgeInvoke } from "@forge/bridge";

/** invoke() may wrap the result in { body }; unwrap once here. */
async function invoke<T>(fn: string, payload?: Record<string, unknown>): Promise<T> {
  const r = (await forgeInvoke(fn, payload)) as T | { body: T };
  return r && typeof r === "object" && "body" in (r as object) ? (r as { body: T }).body : (r as T);
}

type SpaceConfig = { spaceId: string; spaceKey?: string };
type Row = {
  page: { pageId: string; title: string; lastModified: string };
  findings: Array<{ check: string; severity: "high" | "medium" | "low"; evidence: string }>;
};

const App = () => {
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<SpaceConfig[]>("getSpaces").then((s: SpaceConfig[]) => {
      setSpaces(s);
      setDraft(s.map((x: SpaceConfig) => x.spaceId).join(","));
      if (s[0]) invoke<Row[]>("topFindings", { spaceId: s[0].spaceId }).then(setRows);
    });
  }, []);

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
            { content: r.findings.map((f) => `${f.check}: ${f.evidence}`).join(" | ") },
          ],
        }))}
        emptyView={<Text>No findings yet. Save a space and run a scan.</Text>}
      />
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
