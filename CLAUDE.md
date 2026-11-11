# WikiVerify — instructions for the development agent

You are the developer of this repo. The human owner reviews pull requests; he does not manage the work. Read this file, then `PLAN.md` (what and why), `TASKS.md` (the ordered backlog), and the top entry of `DEVLOG.md` (where things stand) before touching code.

## How a session goes

1. `git pull`, `npm ci`, `npm run typecheck && npm test` — if main is red, fixing it is the task.
2. `gh pr list --state open`: a PR with **changes requested** is the task — check out its branch, address every review comment, push, stop. A PR still awaiting review is left alone (do not stack a second PR on it unless it is for a different task).
3. Otherwise take the **first unchecked task in `TASKS.md`** whose "needs" line is satisfied and that is not marked `[owner]`. Never skip ahead; never pick two. If none is unblocked, write one line in `DEVLOG.md` naming the owner tasks that block you and stop.
4. Branch `task/<id>-<slug>`. Small commits. Keep the change inside the task's scope.
5. Write or update tests first for anything in `src/checks`, `src/text`, `src/scan`, `src/db/repo.ts` — these must stay runnable without the Forge runtime (inject clients, no `@forge/*` imports).
6. `npm run typecheck && npm test && npm run validate:manifest` must pass. If `forge lint` is available (`npx forge lint`, needs a logged-in CLI), run it too.
7. Tick the task in `TASKS.md`. Append a `DEVLOG.md` entry (newest first): done / learned / next / hours. If you discovered new work, add it to `TASKS.md` in the right position with a "needs" line — do not do it now.
8. Open a PR titled `T<id>: <task title>` with: what changed, how it was tested, anything the owner must do by hand (secrets, Atlassian console, listing). One task per PR.
9. Stop. Do not merge your own PR. A separate review session merges PRs that pass CI and these rules.

Budget per session: about 90 minutes of work. If the task is bigger, ship a coherent, tested part and split the remainder into a new task right below it in `TASKS.md`.

## Rules that do not bend

- **No egress.** No `external` permissions in `manifest.yml`, no `fetch` to anything outside Atlassian APIs, no third-party LLMs. The "Runs on Atlassian" badge is the product.
- **Forge LLMs only** (`@forge/llm`): Haiku for extraction/classification, Sonnet for adjudication. No Opus. Log token usage on every call.
- **Never** write secrets, tokens or site URLs into the repo. Deploy credentials live only in GitHub Actions secrets (`FORGE_EMAIL`, `FORGE_API_TOKEN`).
- **Never** change pricing, scopes, the module list, or the product scope in `PLAN.md` on your own. Those need a task written by the owner. If a task seems to require it, write the question in the PR and stop.
- Findings must be conservative: a false positive costs more trust than a miss. When a check is unsure, it returns nothing.
- Prefer the simplest defensible implementation. No frameworks, no abstractions for one call site.

## Code map

- `src/checks/*` — pure checks, one per file, `Check` signature from `types.ts`
- `src/text/storageToText.ts` — storage format → text, links, issue keys
- `src/scan/orchestrate.ts` — which pages to scan, batching (pure)
- `src/triggers/nightly.ts` — scheduled trigger → queue
- `src/workers/scanBatch.ts` — consumer: fetch page → checks → store
- `src/forge/*` — the only files that call Atlassian REST APIs
- `src/db/repo.ts` (interface + memory impl), `src/db/forgeSqlRepo.ts` (Forge SQL)
- `src/ui/dashboard` — UI Kit admin page
- `test/fixtures/pages.ts` — planted-fault pages; every new check gets a planted fault here

## When you are blocked

Write the blocker at the top of `DEVLOG.md` under **BLOCKED**, open a PR with what you have (draft), and stop. Typical blockers only the owner can clear: Atlassian partner account, `forge register`, deploy secrets, Marketplace listing, anything needing a login.
