# scripts

Operator scripts for shipping and checking the app. All of them read the
workspace `.env`, which is gitignored — nothing here prints or writes a
credential, and nothing here is part of the app bundle.

Run them from the repo root.

| | |
|---|---|
| `node scripts/status.cjs` | Versions, which one is serving, and how much budget is left. Read-only, costs nothing. |
| `node scripts/deploy.cjs "what changed"` | Verify locally, deploy the next registry version, check the build, point `@me` at it. |
| `node scripts/publish.cjs 34 [@me]` | Point an audience at a version that already exists. This is how a rollback is done. |
| `node scripts/yt-flow.cjs <youtube url>` | The whole YouTube path end to end, no browser. Costs one text run. |

## Why these exist

**Deploying and publishing are two different things.** Deploying adds a version
to the registry and activates nothing; publishing binds an audience to a
version. So a rollback is a repoint, never a rebuild — `publish.cjs 34` puts
the previous version back in seconds without touching the registry.

**`yt-flow.cjs` compiles the app's real `prompts.ts` and drives the app's real
`ask.pipe`.** It is not a mock of the path, it is the path, minus React. That
matters because the prompt is where most of this app's behaviour actually
lives, and a change to it is otherwise only testable by spending a run in a
browser. It caught the `Poock Panade` naming bug and verified the fix.

## Costs, measured

| | |
|---|---|
| A text run (YouTube link, pasted caption, described dish) | **14–19 tokens** |
| A video run (Instagram reel, uploaded file) | **~760 tokens** |
| Re-opening a saved recipe | **0** |

That 40x gap is why video is paused for the competition — see the README at the
repo root. `status.cjs` prints how many of each the remaining balance buys.

## The two connections

`.env` holds two pairs, and they are not interchangeable:

- `ROCKETRIDE_URI` / `ROCKETRIDE_APIKEY` — **development**: run, validate,
  iterate. `yt-flow.cjs` uses this one.
- `ROCKETRIDE_DEPLOY_URI` / `ROCKETRIDE_DEPLOY_APIKEY` — **deployment target**:
  deploy, publish, build logs, billing. The other three use this one.

Lifecycle verbs are never run against the development pair. If the deploy pair
is missing, the scripts stop and say so rather than guessing.
