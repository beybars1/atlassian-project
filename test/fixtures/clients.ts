import type { Clients, IssueInfo } from "../../src/checks/types";

/** In-memory world the tests control. */
export function fakeClients(world: {
  pagesById?: string[];
  pagesByTitle?: Array<[spaceKey: string, title: string]>;
  issues?: Record<string, Partial<IssueInfo>>;
  projectKeys?: string[];
  users?: Record<string, boolean | undefined>;
  now?: string;
}): Clients {
  const byId = new Set(world.pagesById ?? []);
  const byTitle = new Set((world.pagesByTitle ?? []).map(([s, t]) => `${s}:${t}`));
  return {
    confluence: {
      async pageExistsById(id) { return byId.has(id); },
      async pageExistsByTitle(space, title) { return byTitle.has(`${space}:${title}`); },
    },
    jira: {
      async getIssue(key) {
        const i = world.issues?.[key];
        return i ? { key, exists: true, ...i } : { key, exists: false };
      },
      async knownProjectKeys() { return new Set(world.projectKeys ?? ["PAY"]); },
    },
    users: {
      async isActive(id) { return world.users?.[id]; },
    },
    now: () => new Date(world.now ?? "2026-11-07T00:00:00Z"),
  };
}
