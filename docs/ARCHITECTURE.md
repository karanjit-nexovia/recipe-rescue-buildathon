# Architecture

How a pasted link becomes a recipe, and why each piece is where it is.

---

## 1. The whole path

```
 ┌──────────────┐
 │ user pastes  │
 │ a reel URL   │
 └──────┬───────┘
        │
        ▼
 ┌────────────────────────┐      ┌──────────────┐
 │ resolveMediaSource()   │─────►│  Cloudflare  │────► Apify actor run
 │ src/mediaSource.ts     │      │   Worker     │
 │                        │◄─────│ resolver/    │◄──── sanitised metadata
 │ validates the URL      │      └──────────────┘      (mediaUrl, caption,
 │ BEFORE any network I/O │                             expiresAt, warnings)
 └──────┬─────────────────┘
        │  mediaUrl
        ▼
 ┌────────────────────────┐
 │ browser fetches the    │   Instagram CDN sends Access-Control-Allow-Origin: *
 │ MP4 straight from CDN  │   so no video bytes ever pass through my server.
 └──────┬─────────────────┘
        │  a browser File — identical to a manual upload from here on
        ▼
 ┌────────────────────────────────────────────┐
 │ transcribe.pipe                            │   Runs no model. Always run.
 │   webhook → audio_transcribe      → text   │
 └──────┬─────────────────────────────────────┘
        │  transcript
        │
        │  thin, OR no amount carrying a unit was ever said —
        │  the quantities are in an overlay:
        ▼
 ┌────────────────────────────────────────────┐
 │ screentext.pipe                            │   ~half the cost of a video
 │   webhook → frame_grabber → ocr   → text   │   run. Escalated, not default.
 └──────┬─────────────────────────────────────┘
        │  transcript + on-screen text
        │
        │  if combined length < 80 chars, the reel was silent
        │  and had no legible overlay — escalate again:
        ▼
 ┌────────────────────────────────────────────┐
 │ vision.pipe                                │   Costs money. Only runs when
 │   frame_grabber → image_vision_openai      │   the free path came back empty.
 └──────┬─────────────────────────────────────┘
        │
        ▼
 ┌────────────────────────────────────────────┐
 │ ask.pipe                                   │   One generic chat pipeline.
 │   chat → llm_openai → response_answers     │   Serves extraction, the fridge
 └──────┬─────────────────────────────────────┘   check, and the fallback dish.
        │  JSON
        ▼
 ┌────────────────────────┐
 │ parse.ts               │   Defensive. Model output is data, not a contract.
 │ extractJson()          │   Malformed JSON degrades the recipe; it never
 └──────┬─────────────────┘   crashes the screen.
        ▼
    Recipe object ──► render ──► cook mode ──► saved to the recipe book
```

## 2. Why four pipelines and not one

The obvious design is one pipeline that takes a video and returns a recipe. That was the
original brief. It is the wrong shape for two reasons.

**Cost.** Transcription and OCR need no model at all. Fusing them with the reasoning step
would mean paying model prices for work that is free. `transcribe.pipe` is therefore kept
model-free, and a run of it costs nothing.

**Escalation, twice over.** The three media pipelines are a cost ladder, and each rung is
climbed only when the one below came back short.

| Rung | Runs | Escalated when |
|---|---|---|
| `transcribe.pipe` | always | — |
| `screentext.pipe` | frames → OCR | the reel barely spoke, or spoke without ever naming an amount carrying a unit |
| `vision.pipe` | frames → image model | speech and screen text together came back near-empty |

Vision was split out first, and cut median link-to-recipe from 213s to 165s. OCR was
split out later, once the billing ledger showed video processing to be 87% of all spend
at roughly 760 tokens a run against 33 for a chat call.

The second condition on `screentext` is the interesting one. Skipping OCR whenever there
is *any* speech would lose the quantities on exactly the reels this app exists for —
"add some cream and the usual spices" is when the numbers live in an overlay. So the
transcript is checked for amounts that carry a unit, three or more, and the frames are
read whenever the cook never gave any.

**Generality.** `ask.pipe` is a single `chat → llm → response_answers` pipeline with no
recipe-specific configuration in it at all. Extraction and substitution are the same
pipeline invoked with different `Question` objects. Adding a third kind of reasoning
would need no new pipeline.

## 2b. The order the app asks its questions

The screen sequence is not the order the data arrives in — it is the order a person
decides in:

```
welcome -> link or describe -> [extract] -> tick what you have -> verdict
                                                                    |
                                    +-------------------------------+
                                    |                               |
                          shop for what is missing        cook something else
                                    |                               |
                                    +---------> the recipe <--------+
                                                     |
                                            cook mode -> "congratulations"
```

The method is rendered **last**. It used to be first, with the fridge check below the
whole thing, which meant scrolling past thirteen steps to answer a question you ask
before cooking and then scrolling back up to cook.

Two consequences worth stating:

- **Ticking is the input.** A tick means "I have this", which makes the shopping list
  exact rather than a model's reading of a sentence someone typed, and makes the fridge
  check a statement of fact rather than a guess. Pantry basics start ticked, because
  nobody thinks of salt and water as ingredients they *have*.
- **The check is a snapshot.** Tick something off in the shop and the app retires the
  swap lines that no longer apply and recomputes the count locally, rather than spending
  another model call to be told what it can work out itself.

## 3. Where the prompting lives, and why

All prompting is in `src/prompts.ts` as typed `Question` objects, not in the `.pipe`
files.

This is not a style preference. The `prompt` node's `instructions` config field is
silently ignored on this platform — verified with a canary instruction that never
reached the model. The `Question` object's `role` / `addInstruction` / `addExample` /
`expectJson` path does work, and `expectJson` makes the server return an already-parsed
object rather than a string to be salvaged.

Consequence worth stating: prompting is application code here. It is typed, reviewable
in a diff, and testable, which is where prompting belongs anyway.

## 4. Link resolution is source-agnostic

`src/mediaSource.ts` exposes one function, `resolveMediaSource()`, returning a
discriminated union:

| Outcome | Meaning |
|---|---|
| `{ kind: 'media' }` | A fetchable video. The good path, straight into the existing pipeline. |
| `{ kind: 'text' }` | Caption or title only. Better than nothing, worse than video. |
| `{ kind: 'unsupported' }` | A recognised link that cannot be served, kept typed so the UI can explain why. |

Providers differ in how much they give up:

| Platform | Route | Yields |
|---|---|---|
| Instagram | Server-side resolver (Cloudflare Worker → Apify) | Video URL + caption |
| TikTok | oEmbed, CORS `*` | Full caption, no video URL |
| YouTube | oEmbed, CORS echoes origin | Title only, no description |

Adding a platform means adding one entry to `PROVIDERS`. Nothing downstream of
`resolveMediaSource()` knows which platform a recipe came from.

Failure modes are a closed set of typed codes — `private-or-deleted`, `media-expired`,
`resolver-timeout`, `wrong-host`, and so on — because every one of them needs a different
sentence shown to the user and a different suggested next action.

## 5. The resolver, and why a server exists at all

I did not want a server. Instagram forced one.

- **From the browser**: instagram.com sends no CORS headers, so `fetch()` is refused
  before it can read anything.
- **From inside a platform pipeline**: `tool_http_request` truncates response string
  values to about 79 characters. A signed Instagram CDN URL is over a thousand. This is
  measured, reproduced three times, and detailed in [PLATFORM_NOTES.md](PLATFORM_NOTES.md).
- **From `tool_python`**, which could fetch and parse server-side: currently broken on
  staging when `allowedModules` is set.

So exactly one step needs a server: turning a reel URL into a CDN URL. The Worker does
only that. Because the CDN itself sends `Access-Control-Allow-Origin: *`, the browser
downloads the video directly and **no video bytes pass through the Worker** — which
keeps it inside Cloudflare's free tier and out of the data path.

The Worker is also the token boundary. `APIFY_TOKEN` is a Cloudflare secret, never in the
repository, the app bundle, a `.pipe` file, or a log line.

### Resolver contract

`POST /resolve-media` with `{"url": "https://www.instagram.com/reel/…/"}`

Returns sanitised metadata only, never raw scraper output:

```json
{
  "platform": "instagram",
  "canonicalUrl": "https://www.instagram.com/reel/ABC123/",
  "mediaUrl": "https://scontent…cdninstagram.com/…mp4?…",
  "caption": "…",
  "thumbnailUrl": "…",
  "durationSeconds": 42,
  "expiresAt": 1788400000000,
  "resolverConfidence": "high",
  "warnings": []
}
```

On failure: `{"error": "human-readable", "code": "machine-readable"}` with a matching
HTTP status. Codes line up one-to-one with `ResolveErrorCode` in `mediaSource.ts`.

## 6. Cost and lifecycle control

Costs are managed in `src/usePipelines.ts`, which owns pipeline lifecycle.

- **`client.use()` is expensive.** Each pipeline is started once per session and its
  token reused. Never per request.
- **A task bills for as long as it is alive**, not only while serving a request. `TASK_TTL`
  is set to 180s — long enough to cover the gap between extracting a recipe and asking
  the fridge question, short enough that it does not burn credits while the user reads.
  Restarting costs a few seconds.
- **Config changes apply at task start only.** Editing a `.pipe` during development
  requires terminating the running task; attaching to it silently keeps the old
  definition. This cost real debugging time and is worth knowing.
- **Saved recipes are cached by content hash**, so re-opening one costs nothing.

Result: about $0.056 per recipe, $0 on re-open.

## 7. Failure design

The reviewer launches this unattended, with nobody around to restart anything. So:

| Failure | Behaviour |
|---|---|
| Video with no speech | Falls back to the OCR branch, then to vision, then to asking the user to paste the caption. Never a blank screen. |
| Model returns invalid JSON | Parsed defensively; the recipe renders in degraded form. |
| Pipeline throws | `PipeException` is caught at the call site and rendered as a real error state. |
| Task died between requests | `getTaskStatus(token)` is checked. |
| Hung pipeline | Hard ceilings: 5 min for transcription, 2 min for a question. The timeout frees the UI; it cannot cancel the server-side run, which is the right trade — a stuck screen is worse than a wasted run, and the task TTL reaps it. |
| Oversized or non-video upload | Rejected at 200 MB before it ever reaches a pipeline. |

## 8. Configuration

Environment variables, all server-substituted. Only `${ROCKETRIDE_*}` names substitute;
any other `${VAR}` arrives as `<REDACTED>`.

| Variable | Purpose | Lives in |
|---|---|---|
| `ROCKETRIDE_URI` / `ROCKETRIDE_APIKEY` | Development connection | `.env`, untracked |
| `ROCKETRIDE_DEPLOY_URI` / `ROCKETRIDE_DEPLOY_APIKEY` | Deploy target | `.env`, untracked |
| `ROCKETRIDE_OPENAI_KEY` | Model calls in `ask.pipe` and `vision.pipe` | Platform env layer, **not** the repo |
| `APIFY_TOKEN` | Instagram resolution | Cloudflare secret only |
| `ALLOWED_ORIGINS` | Origins the Worker will echo | `resolver/wrangler.toml` |

`ROCKETRIDE_OPENAI_KEY` resolves from the staging server's own **process** environment,
not from any org, team, or user secret layer — measured, with the method and evidence in
[PLATFORM_NOTES.md](PLATFORM_NOTES.md). That matters for a reviewer launching the app
under their own account: nothing the app depends on is account-scoped, so the key
resolves for them exactly as it does for the author.

Should a model credential ever fail to resolve, the substitution is passed through as
literal text and the provider rejects it as a malformed key. `errText()` in `App.tsx`
recognises that shape and reports a missing server-side credential rather than showing a
bare 401, which would read as a broken app rather than a configuration gap.
