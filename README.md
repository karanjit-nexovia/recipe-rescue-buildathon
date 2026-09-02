# Recipe Rescue

**Paste a cooking reel. Get a recipe a first-time cook can actually follow.**

Built solo for the RocketRide × SCU Buildathon, 2026.

---

## The problem this solves

A cooking reel is 45 seconds of fast cuts with no written recipe. You understand every
word and still cannot cook from it — because the person filming is an experienced cook
making a video for other experienced cooks. They skip the quantities, the prep order,
and every cue for what "done" looks like. They say *"thoda sa"*, *"salt to taste"*,
*"cook till it's ready"*.

The user is a narrow intersection, not a broad audience: **first-year international
students, cooking the food they grew up eating, for the first time.** They watched a
parent make it for twenty years but only ever ate it. Maximum motivation, zero
technique. The reel assumes exactly the knowledge they lack.

This is deliberately *not* a translation tool — the user already speaks the language.
The gap is technique, not vocabulary.

## What it does

| | |
|---|---|
| **Ingest** | Paste an Instagram reel URL, upload a video file, or paste the caption as a fallback. |
| **Extract** | Audio is transcribed and on-screen text is read from video frames — overlays are often where the real quantities live. |
| **Ground** | Vague amounts become concrete ones, *marked as estimates* so you can tell what came from the cook and what was inferred. Steps are reordered into the order one person actually works in. |
| **Cue** | Every step that can go wrong gets a sensory cue: *"the seeds sizzle and start popping, and smell toasty — not dark brown"*. |
| **Substitute** | One free-text box: "what's in your fridge?" Returns swaps with an honest note on what each costs in flavour — and refuses to swap the ingredient the dish is built around. |
| **Cook** | Step-by-step mode with timers on the steps where a timer genuinely helps. Pure client state, no model calls at runtime. |
| **Keep** | Saved recipes persist per user and re-open for free. |

### Verified output

On a real reel, the extractor produced `Rigatoni — 8 oz (225 g)`, matching the caption
exactly; 13 of 13 steps carried doneness cues; and it reported `totalMinutes: 35`
against the reel's claimed 20 — the honest number rather than the marketed one.

## Numbers that mattered

| Metric | Value |
|---|---|
| Cost per recipe | **~$0.056** |
| Cost to re-open a saved recipe | **$0** |
| Link to finished recipe | **165s** (down from 213s) |
| URL-validation cases handled | 15, including lookalike hosts, raw IPs, localhost |
| Video bytes through my server | **0** — the browser downloads direct from CDN |

## Architecture at a glance

```
  Instagram URL ──► Cloudflare Worker ──► Apify ──► CDN media URL
        │            (holds the token,            │
        │             never sees the video)       │
        │                                         ▼
        │                            browser downloads MP4 direct
        │                                         │
   file upload ──────────────────────────────────►│
                                                  ▼
                                     ┌────────────────────────┐
                                     │  transcribe.pipe       │  no model, $0
                                     │  audio  → text         │
                                     │  frames → OCR → text   │
                                     └───────────┬────────────┘
                                                 │  under 80 chars?
                                                 ▼
                                     ┌────────────────────────┐
                                     │  vision.pipe           │  escalation only
                                     │  frames → image vision │
                                     └───────────┬────────────┘
                                                 ▼
                                     ┌────────────────────────┐
                                     │  ask.pipe              │  all reasoning
                                     │  one generic chat pipe │
                                     └────────────────────────┘
```

Three pipelines, but only one does any reasoning. `ask.pipe` is a single generic chat
pipeline serving both recipe extraction *and* fridge substitution — all the prompting
lives in `src/prompts.ts` as typed `Question` objects, so a new kind of question costs
no new infrastructure.

Full detail: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Repository layout

```
apps/recipe-ui/         The app. React + TypeScript, deployed to RocketRide staging.
  src/prompts.ts        All prompting. Typed Question objects with expectJson.
  src/mediaSource.ts    Source-agnostic link resolution. New platform = one entry.
  src/usePipelines.ts   Pipeline lifecycle, timeouts, cost controls.
  src/*.pipe            The three pipeline definitions.
resolver/               Cloudflare Worker. Resolves links, holds the Apify token.
docs/                   Architecture, decisions, and the platform constraints found.
briefs/                 The original build brief, kept as a historical record.
apps/staging-doctor-ui/ Small diagnostic app used to probe platform behaviour.
```

## Running it

```bash
pnpm install                    # one root install links every app under apps/
cd apps/recipe-ui && pnpm dev   # live preview
```

Requires a `.env` with RocketRide connection credentials — key names are listed in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Secrets are never committed; the Apify
token exists only as a Cloudflare secret (`npx wrangler secret put APIFY_TOKEN`).

## What building this actually involved

Not a list of technologies — the specific problems that had to be solved:

- **Working against an undocumented platform.** Several capabilities did not behave as
  documented. Each was isolated with a minimal reproduction before being designed
  around, and the findings written up in
  [docs/PLATFORM_NOTES.md](docs/PLATFORM_NOTES.md) — including an HTTP tool that
  silently truncates response strings to about 79 characters, the single constraint
  that forced the entire external-resolver design.
- **Designing a security boundary.** The resolver accepts one route, one method, one
  allowlisted host, three known URL shapes. Lookalike hosts (`instagram.com.evil.co`),
  raw IPs, and localhost are refused before any outbound request is made, so it cannot
  be turned into a general-purpose proxy.
- **Cost as a design constraint.** Tasks bill for as long as they are *alive*, not just
  while serving a request — so the TTL is a direct cost lever, the transcription
  pipeline runs no model at all, vision is escalated only when cheap extraction comes
  back empty, and saved recipes are cached by content hash.
- **Treating model output as data, not a contract.** Malformed JSON degrades the recipe
  rather than crashing the screen.
- **Failure design for an unattended reviewer.** Every path has a timeout, a typed error
  code, and a next action for the user. A dead pipeline must never present as a spinner
  that spins forever.
- **Scope discipline.** Five substantial features were cut on purpose, each for a stated
  reason. Those are recorded in [docs/DECISIONS.md](docs/DECISIONS.md), because what was
  deliberately *not* built is the more useful half of the record.

## Status

The app works end to end and is deployed to RocketRide staging. Open work is tracked
here rather than hidden:

- The full adverse-input test matrix (private/deleted reels, expired CDN links,
  oversized uploads, cold launch) is specified but has not been run end to end.
- 165s per recipe is dominated by frame-grab and OCR at 71s; the sampling rate is
  governed by config fields absent from the platform schema.

Closed: the model credential was suspected of being tied to the author's account, which
would have meant the app failing for anyone else who launched it. It is not — it resolves
from the server's process environment, and every account-scoped alternative was ruled out
by measurement. Evidence in [docs/PLATFORM_NOTES.md](docs/PLATFORM_NOTES.md).

## Licence

MIT — see [LICENSE](LICENSE).
