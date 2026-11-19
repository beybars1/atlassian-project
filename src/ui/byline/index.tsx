/**
 * UI Kit (render: native) popup behind the byline chip (T19). The chip itself ("✓ verified",
 * "⚠ 2 issues") is set by the module's `dynamicProperties` function; clicking it opens this view
 * with the open findings of the page. Read-only: dismissing stays on the admin dashboard.
 */
import React, { useEffect, useState } from "react";
import ForgeReconciler, { Text, Strong, Stack, Inline, Lozenge, SectionMessage, Spinner, useProductContext } from "@forge/react";
import { invoke as forgeInvoke } from "@forge/bridge";
import { findingLabel } from "../findingLabel";
import type { BylineStatus } from "../bylineSummary";

/** invoke() may wrap the result in { body }; unwrap once here. */
async function invoke<T>(fn: string, payload?: Record<string, unknown>): Promise<T> {
  const r = (await forgeInvoke(fn, payload)) as T | { body: T };
  return r && typeof r === "object" && "body" in (r as object) ? (r as { body: T }).body : (r as T);
}

const SEVERITY_APPEARANCE = { high: "removed", medium: "moved", low: "default" } as const;

const App = () => {
  const context = useProductContext();
  const pageId: string | undefined = context?.extension?.content?.id != null ? String(context.extension.content.id) : undefined;
  const [status, setStatus] = useState<BylineStatus | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!pageId) return;
    invoke<BylineStatus>("bylineStatus", { pageId })
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [pageId]);

  if (!context) return <Spinner size="small" />;
  if (!pageId) return <Text>WikiVerify could not identify this page.</Text>;
  if (error) return <SectionMessage appearance="warning"><Text>WikiVerify could not load this page's status: {error}</Text></SectionMessage>;
  if (!status) return <Spinner size="small" />;

  const { summary, findings, page } = status;
  if (summary.state === "unscanned") {
    return (
      <SectionMessage appearance="information">
        <Text>{summary.tooltip} Pages are checked nightly in the spaces a Confluence admin configured on the WikiVerify dashboard.</Text>
      </SectionMessage>
    );
  }
  if (summary.state === "verified") {
    return (
      <SectionMessage appearance="success">
        <Text>{summary.tooltip}</Text>
      </SectionMessage>
    );
  }
  return (
    <Stack space="space.150">
      <Text>
        <Strong>{summary.title}</Strong> on this page{page ? ` — last checked ${page.scannedAt.slice(0, 10)}` : ""}.
      </Text>
      {findings.map((f) => (
        <Stack key={f.id} space="space.050">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Lozenge appearance={SEVERITY_APPEARANCE[f.severity]}>{f.severity}</Lozenge>
            <Text>
              <Strong>{findingLabel(f)}</Strong>
            </Text>
          </Inline>
          <Text>{f.evidence}</Text>
          <Text>→ {f.suggestion}</Text>
        </Stack>
      ))}
      <Text>Not a problem? A Confluence admin can dismiss a finding on the WikiVerify dashboard.</Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
