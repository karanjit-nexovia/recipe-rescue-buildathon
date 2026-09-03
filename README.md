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

## How it works

The app is a guided flow, one question per screen, in the order someone
actually decides:

```
  welcome  ->  link or describe  ->  tick what you have  ->  the verdict
                                                                  |
                              +-----------------------------------+
                              |                                   |
                    shop for what is missing            cook something else
                              |                                   |
                              +----------------> the recipe <-----+
                                                     |
                                                  cook mode
                                                     |
                                             "congratulations"
```

The method comes **last**, not first. Nobody needs step seven while working out
whether tonight is even possible.

| | |
|---|---|
| **Ingest** | Paste an Instagram, TikTok or YouTube link, upload a video, or just describe the dish. YouTube arrives as a spoken transcript; a blocked video download falls back to the post caption. |
| **Extract** | Audio, then on-screen text, then vision — each escalated only when the one before came back short. |
| **Ground** | Vague amounts become concrete ones, marked as estimates. "All the usual spices" becomes a named list with quantities. Steps are reordered the way one person actually works. |
| **Cue** | Every step that can go wrong gets a sensory cue: *"the seeds sizzle and start popping, and smell toasty — not dark brown"*. |
| **Decide** | Tick what you have. The app works out what is missing, exactly, without asking a model to parse a sentence you typed. |
| **Shop or adapt** | A shopping list you tick off as you go, with the right kind of grocery store nearby — or a different dish built from what is already in your kitchen. |
| **Cook** | One step at a time, timers, arrow keys, and the ingredients that step needs pulled alongside it. |
| **Finish** | Completing every step lands on a proper ending, and asks whether to keep the recipe — which is the first moment you actually know. |

## Numbers that mattered

| Metric | Value |
|---|---|
| Cost of a text run (link, caption, described dish) | **~33 platform tokens** |
| Cost of a video run | **~760**, before the OCR escalation split |
| Cost to re-open a saved recipe | **0** |
| Link to finished recipe | **165s** (down from 213s) |
| Resolver tests, all passing | **15**, including lookalike hosts, raw IPs, localhost |
| Video bytes through my server | **0** — the browser downloads direct from CDN |

Those first two are measured from the platform's own billing ledger, not estimated.
Video processing turned out to be 87% of all spend against 12% for every model call
combined, which is what motivated the escalation ladder above.

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
                                     │  audio → text          │  always
                                     └───────────┬────────────┘
                                                 │  thin, or no amounts named?
                                                 ▼
                                     ┌────────────────────────┐
                                     │  screentext.pipe       │  ~half the cost
                                     │  frames → OCR → text   │  of a video run
                                     └───────────┬────────────┘
                                                 │  both came back empty?
                                                 ▼
                                     ┌────────────────────────┐
                                     │  vision.pipe           │  dearest rung
                                     │  frames → image vision │
                                     └───────────┬────────────┘
                                                 ▼
                                     ┌────────────────────────┐
                                     │  ask.pipe              │  all reasoning
                                     │  one generic chat pipe │
                                     └────────────────────────┘
```

Four pipelines, but only one reasons. The other three are a cost ladder, each rung
climbed only when the one below came back short: `transcribe` (audio, always run),
`screentext` (frames and OCR, when the reel barely spoke or never named an amount),
`vision` (an image model, when both came back empty).

`ask.pipe` is a single generic chat pipeline serving extraction, substitution and the
fallback dish alike — all the prompting lives in `src/prompts.ts` as typed `Question`
objects, so a new kind of question costs no new infrastructure.

Full detail: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Repository layout

```
apps/recipe-ui/         The app. React + TypeScript, deployed to RocketRide staging.
  src/prompts.ts        All prompting. Typed Question objects with expectJson.
  src/mediaSource.ts    Source-agnostic link resolution. New platform = one entry.
  src/usePipelines.ts   Pipeline lifecycle, timeouts, cost controls.
  src/*.pipe            The four pipeline definitions.
resolver/test-resolver.sh  15-case contract and security suite for the Worker.
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
- Frame-grab and OCR is the remaining latency bottleneck. Its sampling rate is
  governed by config fields absent from the platform schema, so it is escalated
  rather than tuned.
- No automated tests on the app itself. The resolver has a suite; the React layer is
  covered by a type check and use.

Closed since: the model credential was suspected of being tied to the author's account, which
would have meant the app failing for anyone else who launched it. It is not — it resolves
from the server's process environment, and every account-scoped alternative was ruled out
by measurement. And a task reaped after three minutes idle used to surface as "failed to
open a data pipe" on the next request — pipelines now restart themselves instead.
Evidence for both in [docs/PLATFORM_NOTES.md](docs/PLATFORM_NOTES.md).

## Licence

MIT — see [LICENSE](LICENSE).
