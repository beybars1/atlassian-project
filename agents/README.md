# Agents

Two scheduled Claude tasks run this repo without a human in the loop. Their prompts live here so they can be recreated or edited.

| Task | Schedule (Almaty) | Prompt | Does |
|---|---|---|---|
| WikiVerify: ночная разработка | daily 02:23 | `nightly-dev.md` | takes the next task from `TASKS.md`, opens one PR |
| WikiVerify: ревью и мёрж PR | daily 05:23 | `review-merge.md` | reviews open PRs against `CLAUDE.md`, merges green ones |

Both report to the owner's Telegram (one message per run). The owner's only recurring duties: read the two messages, clear `[owner]` tasks, answer questions left in PR bodies.
