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
 │ transcribe.pipe                            │   Runs no model, so a run is free.
 │   webhook → audio_transcribe      → text   │
 │   webhook → frame_grabber → ocr   → text   │
 └──────┬─────────────────────────────────────┘
        │  transcript + on-screen text
        │
        │  if combined length < 80 chars, the reel was silent
        │  and had no legible overlay — escalate:
        ▼
 ┌────────────────────────────────────────────┐
 │ vision.pipe                                │   Costs money. Only runs when
 │   frame_grabber → image_vision_openai      │   the free path came back empty.
 └──────┬─────────────────────────────────────┘
        │
        ▼
 ┌────────────────────────────────────────────┐
 │ ask.pipe                                   │   One generic chat pipeline.
 │   chat → llm_openai → response_answers     │   Serves BOTH extraction and
 └──────┬─────────────────────────────────────┘   substitution.
        │  JSON
        ▼
 ┌────────────────────────┐
 │ parse.ts               │   Defensive. Model output is data, not a contract.
 │ extractJson()          │   Malformed JSON degrades the recipe; it never
 └──────┬─────────────────┘   crashes the screen.
        ▼
    Recipe object ──► render ──► cook mode ──► saved to the recipe book
```

## 2. Why three pipelines and not one

The obvious design is one pipeline that takes a video and returns a recipe. That was the
original brief. It is the wrong shape for two reasons.

**Cost.** Transcription and OCR need no model at all. Fusing them with the reasoning step
would mean paying model prices for work that is free. `transcribe.pipe` is therefore kept
model-free, and a run of it costs nothing.

**Escalation.** Most reels have usable audio or legible overlays. A minority — silent
cooking videos over music, with no text — yield nothing from the cheap path. Vision over
frames handles those, but it is the expensive option, so it must not run by default.
Splitting it into `vision.pipe` behind an 80-character threshold cut the median
link-to-recipe time from 213s to 165s, because the common case stopped paying for the
rare one.

**Generality.** `ask.pipe` is a single `chat → llm → response_answers` pipeline with no
recipe-specific configuration in it at all. Extraction and substitution are the same
pipeline invoked with different `Question` objects. Adding a third kind of reasoning
would need no new pipeline.

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

`ROCKETRIDE_OPENAI_KEY` resolving from the platform's own env layer rather than this
repository is deliberate — but see the Status section of the top-level README for the
one thing about it that is still unverified.
