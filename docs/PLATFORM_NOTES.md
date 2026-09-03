# Platform notes

Behaviour of the RocketRide staging platform that is not in its documentation, found
while building this app. Each entry is something that cost time, was isolated with a
minimal reproduction, and then had to be designed around.

Recorded because a constraint you have measured is worth more than a workaround you
half-remember — and because re-testing a known dead end is pure waste.

---

## `tool_http_request` truncates response strings to ~79 characters

**Measured three times.** String values in an HTTP response come back cut to roughly 79
characters.

**Why it mattered so much.** A signed Instagram CDN URL is over a thousand characters.
This single limit means *no* pipeline-internal resolver can ever return a media URL —
not one I write, and not a third-party fetch service either. It is the constraint that
forced the entire external Cloudflare Worker design. Without measuring it I would have
built the resolver in-platform and discovered the ceiling much later.

**Status:** designed around. The Worker exists because of this.

---

## `tool_python` with `allowedModules` is broken on staging

```
FileNotFoundError: 'python3.10'
  at /opt/rocketride/ai/common/sandbox.py:733
```

Bare `tool_python` config works, but has no network access — which makes it useless for
the one job it was wanted for.

**Consequence.** The natural in-platform solution (fetch and parse server-side in Python)
is unavailable. If this is fixed, the Cloudflare Worker becomes optional and the whole
external dependency could be removed.

**Status:** blocked, reported. Do not retry without checking whether it is fixed.

---

## The `prompt` node's `instructions` config is silently ignored

Verified with a canary instruction that never reached the model. No error, no warning —
the instruction simply has no effect.

**What does work:** the `Question` object's `role` / `addInstruction` / `addExample` /
`expectJson` path. `expectJson` additionally makes the server return an already-parsed
object instead of a string.

**Consequence.** All prompting moved into application code (`src/prompts.ts`). This
turned out to be better anyway — prompts became typed, diffable and reviewable — but it
was forced, not chosen.

**Status:** designed around.

---

## YouTube blocks browser access to video descriptions

The YouTube player API returns **403** whenever an `Origin` header is present, which a
browser always sends. So descriptions are unreachable from the client.

oEmbed *is* reachable and yields the title only.

**Contrast:** TikTok's oEmbed sends `Access-Control-Allow-Origin: *` and gives up the
full caption. YouTube gives a title.

**Status:** accepted. YouTube support is title-only and typed as thin text so the UI can
say so honestly.

---

## Instagram is unreachable from the browser, but its CDN is not

instagram.com sends no CORS headers, so `fetch()` is refused before it can read anything.

But the CDN that actually serves the MP4 sends `Access-Control-Allow-Origin: *`.

**Consequence, and the nicest finding here.** Only the *resolution* step needs a server.
Once the CDN URL is known, the browser downloads the video directly. No video bytes pass
through my infrastructure, which keeps the Worker in Cloudflare's free tier and removes
it from the data path entirely.

---

## Apify `videoUrl` already contains audio

The returned MP4 has both `mp4a` and `avc1` boxes present.

**Consequence.** `includeDownloadedVideo` and `includeTranscript` are *not* needed —
which is worth knowing, because both are more expensive per actor run.

**Status:** confirmed by inspecting the container boxes, not by assumption.

---

## Pipeline config applies at task start only

Editing a `.pipe` file during development and then attaching to the already-running task
silently keeps the **old** definition. There is no warning that the file on disk and the
running task have diverged.

**Workaround:** terminate the task, then start it again.

**Status:** development-time hazard. Cost real debugging time before it was understood —
changes appeared to have no effect.

---

## A task bills while alive, not while working

Billing runs for as long as a task is alive, not only while it is serving a request.

**Consequence.** The idle TTL is a direct cost lever rather than a tuning detail. It is
set to 180s: long enough to span the gap between extracting a recipe and asking the
fridge question, short enough that it stops billing while the user reads.

---

## A reaped task reports itself as a broken data pipe

After the idle TTL expires the task is gone, but a cached token knows nothing about it.
The next request fails with:

```
Failed to open a data pipe. Common causes:
 - Pipeline isn't running (wrong token or task terminated)
 ...
```

The message names a transport problem for what is really a missing task, so matching on
its text is the only signal available to tell "this token is stale" from "this request
was malformed".

**Why it bit so hard.** This app is read-heavy — a thirteen-step recipe takes minutes to
read — so the gap between one request and the next routinely exceeds the TTL. Extract a
recipe, read it, ask anything, and it failed. The token cache is cleared on reconnect and
on disconnect, and neither is what happens here: the socket is fine, the task is gone.

**Status:** designed around. Every pipeline call runs through a wrapper that drops the
token and starts a fresh task once when the failure matches this shape. Retried exactly
once — a new task failing the same way is not staleness.

---

## Rules that fail the build outright

Collected from the platform docs and from breaking them:

- Pipeline files must use the `.pipe` extension. Tooling will not pick up a `.json`.
- `components` must be the **first** field; `project_id`, `viewport`, `version` last.
- `project_id` must be a literal fresh GUID per file, never a `${VAR}`.
- Every component needs a `config` object, even an empty one.
- Source config needs all four fields:
  `{ "hideForm": true, "mode": "Source", "parameters": {}, "type": "<provider>" }`
- Only `${ROCKETRIDE_*}` variables substitute. Any other `${VAR}` arrives as `<REDACTED>`.
- In the app, import the `.pipe` and pass `pipeline:` — never `filepath:`. The browser
  has no filesystem.
- `response_json` takes lane `json`, **not** lane `answers`. Using it after an LLM is a
  validation error; use `response_answers`.
- `client.send()` is for `webhook` sources; `client.chat()` is for `chat` sources.
  Crossing them is a common and confusing failure.
- The app id must match in **both** `package.json` (`appManifest.id`) and
  `src/AppDescriptor.ts`.
- Provider names must come from `services-catalog.json`; component config fields from
  `schema/<provider>.json`. Neither can be guessed.

---

## The merged environment includes the server's own process environment

`${ROCKETRIDE_OPENAI_KEY}` is not in the workspace `.env`, and the app depends on it for
every model call — so the obvious worry was that it lived in the *user* secret layer of
one account, and would silently fail to resolve for anyone else launching the app.

It does not. Measured with `client.account`:

| Source | Contains `ROCKETRIDE_OPENAI_KEY`? |
|---|---|
| Workspace `.env` | no |
| `getEnv('user')` | no — holds only `ROCKETRIDE_ANTHROPIC_KEY` |
| `getEnv('org', orgId)` | no — empty |
| `getEnv('team', devTeam)` | no — empty |
| `getEnvironmentKeys()` (merged) | **yes** |

Present in the merge, absent from all three account scopes. The rest of the merged set
explains where it comes from: alongside it sit `ROCKETRIDE_ALB_PORT_5565_TCP_ADDR`,
`ROCKETRIDE_EAAS_SERVICE_HOST` and fourteen more of the same shape — Kubernetes
service-discovery variables, which can only be injected into the server pod's own
process environment.

**So the merged environment is `process env + org + team + user`,** and the model key
lives in the first of those. A process environment is a property of the server, not of
whoever authenticated against it — it is identical for every account on that host.

Confirmed identical on both the dev and the deploy connection, which on staging turn out
to be the same host and the same credential.

**Consequence.** Nothing the app depends on is account-scoped. The one account-scoped
secret that does exist, `ROCKETRIDE_ANTHROPIC_KEY` in the user layer, is referenced by no
pipeline and no source file — verified with `git grep`.

**Caveat worth stating.** This proves the key is not tied to *this* account. Proving that
a second, unrelated account sees the same merged value would need a second account, which
was not available. The mechanism makes it near-certain, and every account-scoped
alternative has been positively ruled out rather than assumed.

**Method note.** `setEnv(scope, env)` replaces the **entire** dictionary at that level
rather than merging into it. Read, merge, write back — a naive `setEnv` call silently
destroys every other key in that scope.

---

## What actually costs money

Measured from the platform's billing ledger via `client.billing` — note the SDK puts
these on `billing` while the docs describe them on `account`:
`getCreditBalance`, `getUsageByUser`, `getTransactions`.

| Line item | Share of spend |
|---|---|
| `cpu_utilization` | 56% |
| `gpu_inference` | 40% |
| `cpu_memory` | 4% |

Split by pipeline, one number matters: the **video webhook took 5,350 tokens against 720
for every chat call combined.** A video run costs roughly **760**; a chat call averages
**33**. Video was 87% of all spend on an app whose reasoning is entirely chat.

Two things follow, and both shaped the design:

- **Flow testing should never touch video.** Links that resolve to text, pasted captions
  and described dishes all cost about a chat call. Video uploads are for testing the
  video path and rehearsing a demo, nothing else.
- **Frames are escalated, not always read.** `transcribe.pipe` originally ran
  `audio_transcribe` and `frame_grabber → ocr` in parallel on every upload, paying for
  OCR on reels where the cook says every amount out loud. Splitting the frames into
  `screentext.pipe` and running it only when the reel barely spoke — or spoke without
  ever naming an amount carrying a unit — roughly halves a common-case video run.

**A task bills while alive, not while working**, so the idle TTL is a cost lever rather
than a tuning detail. It is 180s, and a task reaped mid-session is restarted
transparently rather than paid to stay warm through every stretch of reading.

---

## Still unmeasured

Honest gaps, so nobody assumes these are known:

- **`frame_grabber` sampling rate.** Frame grab plus OCR is 71s of the 165s total and is
  the remaining bottleneck. Its sampling config field names are absent from both the
  schema and the docs, so capping it needs experimentation.
