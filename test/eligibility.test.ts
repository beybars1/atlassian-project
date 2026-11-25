import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { runsOnAtlassianIssues } from "../scripts/eligibility.mjs";

const clean = {
  modules: {
    scheduledTrigger: [{ key: "nightly", function: "nightly", interval: "day" }],
    function: [{ key: "nightly", handler: "index.nightly" }],
    sql: [{ key: "main", engine: "mysql" }],
  },
  permissions: { scopes: ["read:page:confluence", "storage:app"] },
  app: { runtime: { name: "nodejs22.x" }, id: "ari:cloud:ecosystem::app/x" },
};

function withExternal(external: Record<string, unknown>) {
  return { ...clean, permissions: { ...clean.permissions, external } };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

describe("runsOnAtlassianIssues — manifest", () => {
  it("accepts a manifest with scopes only", () => {
    expect(runsOnAtlassianIssues(clean)).toEqual([]);
  });

  it("rejects every kind of external permission, fetch or not", () => {
    expect(runsOnAtlassianIssues(withExternal({ fetch: { backend: ["example.com"] } }))).toEqual([
      "permissions.external.fetch: external permissions are egress",
    ]);
    const issues = runsOnAtlassianIssues(withExternal({ images: ["cdn.example.com"], fonts: ["fonts.example.com"] }));
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatch(/external\.images/);
    expect(issues[1]).toMatch(/external\.fonts/);
  });

  it("rejects a non-object external block instead of ignoring it", () => {
    expect(runsOnAtlassianIssues(withExternal(undefined as never))).toEqual([]);
    expect(runsOnAtlassianIssues({ ...clean, permissions: { scopes: [], external: [] } })).toEqual([
      "permissions.external: external permissions are egress",
    ]);
  });

  it("rejects remotes, providers, connectModules, services and app.connect", () => {
    expect(runsOnAtlassianIssues({ ...clean, remotes: [{ key: "r", baseUrl: "https://example.com" }] })).toEqual([
      "remotes: declares an off-Atlassian dependency",
    ]);
    expect(runsOnAtlassianIssues({ ...clean, providers: { auth: [] } })).toEqual([
      "providers: declares an off-Atlassian dependency",
    ]);
    expect(runsOnAtlassianIssues({ ...clean, connectModules: {} })).toEqual([
      "connectModules: declares an off-Atlassian dependency",
    ]);
    expect(runsOnAtlassianIssues({ ...clean, services: [] })).toEqual([
      "services: declares an off-Atlassian dependency",
    ]);
    expect(runsOnAtlassianIssues({ ...clean, app: { ...clean.app, connect: { key: "old" } } })).toEqual([
      "app.connect: Connect-on-Forge apps run partly outside Atlassian",
    ]);
  });

  it("rejects a module with a remote endpoint or an auth provider", () => {
    const m = {
      ...clean,
      modules: {
        ...clean.modules,
        function: [
          { key: "local", handler: "index.nightly" },
          { key: "remote", endpoint: "backend" },
          { key: "oauth", handler: "index.x", providers: { auth: ["github"] } },
        ],
      },
    };
    expect(runsOnAtlassianIssues(m)).toEqual([
      "modules.function[remote].endpoint: remote backend",
      "modules.function[oauth].providers: external auth provider",
    ]);
  });

  it("does not throw on garbage", () => {
    expect(runsOnAtlassianIssues(null)).toEqual([]);
    expect(runsOnAtlassianIssues("yaml")).toEqual([]);
    expect(runsOnAtlassianIssues({ modules: { function: "nope" }, permissions: 3 })).toEqual([]);
  });
});

describe("runsOnAtlassianIssues — sources", () => {
  it("flags the @forge/api egress call and its import, not Atlassian requests", () => {
    const ok = [
      { path: "a.ts", text: 'import api, { route } from "@forge/api";\napi.asApp().requestConfluence(route`/x`);' },
      { path: "b.ts", text: "export async function fetchPage(id: string) { return prefetch(id); }" },
    ];
    expect(runsOnAtlassianIssues(clean, ok)).toEqual([]);

    expect(runsOnAtlassianIssues(clean, [{ path: "c.ts", text: 'await api.fetch("https://example.com");' }])).toEqual([
      "c.ts: @forge/api fetch() is an egress call",
    ]);
    expect(runsOnAtlassianIssues(clean, [{ path: "d.ts", text: 'import { fetch, route } from "@forge/api";' }])).toEqual([
      "d.ts: imports fetch from @forge/api",
    ]);
    expect(runsOnAtlassianIssues(clean, [{ path: "e.tsx", text: "const x = new XMLHttpRequest();" }])).toEqual([
      "e.tsx: XMLHttpRequest reaches outside Atlassian",
    ]);
    expect(runsOnAtlassianIssues(clean, [{ path: "f.ts", text: 'new WebSocket("wss://example.com")' }])).toEqual([
      "f.ts: WebSocket reaches outside Atlassian",
    ]);
  });
});

describe("this repository", () => {
  it("manifest.yml and src/ carry no egress", () => {
    const manifest = YAML.parse(readFileSync("manifest.yml", "utf8"));
    const sources = listFiles("src")
      .filter((p) => /\.(ts|tsx|js|mjs)$/.test(p))
      .map((path) => ({ path, text: readFileSync(path, "utf8") }));
    expect(sources.length).toBeGreaterThan(10);
    expect(runsOnAtlassianIssues(manifest, sources)).toEqual([]);
  });
});
