# Recipe Rescue

**Paste a YouTube link, or describe the dish. Get a recipe a first-time cook can actually follow.**

Built solo for the RocketRide × SCU Buildathon, 2026.

**[Watch the demo](demo/demo-final.mp4)** — 2 minutes 46 seconds, the whole flow end to end.

---

## The problem this solves

A cooking video is a few minutes of fast cuts with no written recipe. You understand
every word and still cannot cook from it — because the person filming is an experienced
cook making a video for other experienced cooks. They skip the quantities, the prep
order, and every cue for what "done" looks like. They say *"thoda sa"*, *"salt to
taste"*, *"cook till it's ready"*.

The user is a narrow intersection, not a broad audience: **first-year international
students, cooking the food they grew up eating, for the first time.** They watched a
parent make it for twenty years but only ever ate it. Maximum motivation, zero
technique. The video assumes exactly the knowledge they lack.

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
| **Ingest** | Two doors: paste a YouTube link (a video or a Short), or describe the dish in your own words. A YouTube link arrives as the spoken transcript, plus the title — see [Why only YouTube](#why-only-youtube). |
| **Extract** | The transcript becomes a structured recipe. Automatic captions are phonetic, so the title rides along as corroboration: it is typed by the cook, and outranks the transcript on any name. |
| **Ground** | Vague amounts become concrete ones, marked as estimates. "All the usual spices" becomes a named list with quantities. Steps are reordered the way one person actually works. |
| **Cue** | Every step that can go wrong gets a sensory cue: *"the seeds sizzle and start popping, and smell toasty — not dark brown"*. |
| **Decide** | Tick what you have. The app works out what is missing, exactly, without asking a model to parse a sentence you typed. |
| **Shop or adapt** | A shopping list you tick off as you go, with the right kind of grocery store nearby — or a different dish built from what is already in your kitchen. |
| **Cook** | One step at a time, timers, arrow keys, and the ingredients that step needs pulled alongside it. |
| **Finish** | Completing every step lands on a proper ending, and asks whether to keep the recipe — which is the first moment you actually know. |

## Numbers that mattered

| Metric | Value |
|---|---|
| Cost of a run (YouTube link, or a described dish) | **~18 platform tokens** |
| Cost of a video run, when video was still reachable | **~760** |
| Cost to re-open a saved recipe | **0** |
| YouTube link to finished recipe | **~75s** (resolve 6s, task start 8s, extraction 61s) |
| Resolver tests, all passing | **15**, including lookalike hosts, raw IPs, localhost |
| Video bytes through my server | **0** |

Those costs are measured from the platform's own billing ledger, not estimated. The
40x gap between reading a video and reading text is the single number that shaped this
app more than any other — it is why the product is what it is, and it is explained in
[Why only YouTube](#why-only-youtube).

## Architecture at a glance

```
  YouTube URL ──► Cloudflare Worker ──► Apify transcript actor
                   (holds the token,             │
                    returns text only)           ▼
                                        spoken transcript
                                                 │
                          oEmbed title ─────────►│  (typed by the cook, so it
                                                 │   outranks a phonetic transcript
                                                 ▼   on any name)
                                     ┌────────────────────────┐
                                     │  ask.pipe              │  all reasoning
                                     │  one generic chat pipe │
                                     └───────────┬────────────┘
                                                 ▲
     described dish ────────────────────────────►│
                                                 ▼
                                          structured recipe
```

**One pipeline reasons, and it is the only one now reached.** `ask.pipe` is a single
generic chat pipeline serving extraction, substitution and the fallback dish alike —
all the prompting lives in `src/prompts.ts` as typed `Question` objects, so a new kind
of question costs no new infrastructure.

Three further pipelines remain in the repo — `transcribe` (audio), `screentext`
(frames and OCR), `vision` (an image model) — built as a cost ladder where each rung
was climbed only when the one below came back short. They are intact and tested, and
nothing routes to them now. They are the path back if reading video ever becomes
affordable; see [Why only YouTube](#why-only-youtube).

Full detail: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Why only YouTube

Reading a **video** is the only expensive thing this app ever did: about 760 platform
tokens a run, measured from the billing ledger, against about 18 for a text run. A 40x
difference, structural rather than incidental. The competition budget is fixed and has
to cover every judge and every tester — at video prices that is two runs, at text
prices it is eighty.

That ruled out reading video, which ruled out Instagram: a reel gives up nothing from
the browser, so the only way to read one is to download it and listen to it.

TikTok was different, and worth stating plainly because it looked like a free win and
was not. Its oEmbed returns the caption and never the video — so it costs a text run,
not a video run. But a TikTok caption is conventionally a dish name, an @mention and
five hashtags. The honest description was "works when the cook wrote the recipe out in
the caption", which is not often enough to put on the front of a product. A caption of
98 characters that was 61 characters of hashtags had been clearing the evidence bar on
length alone and buying a model call to reach a dead end.

So the app does two things and says so: **YouTube reads what the cook actually said,
and the describe box handles everything else** — including the dish your mother makes
that was never filmed. What survives from the TikTok work is `recipeEvidence()`, which
strips hashtags and mentions before the evidence bar is measured, so a title-only
source now stops for free instead of buying a run to fail.

## Repository layout

```
apps/recipe-ui/         The app. React + TypeScript, deployed to RocketRide staging.
  src/prompts.ts        All prompting. Typed Question objects with expectJson.
  src/mediaSource.ts    Link resolution. Provider-agnostic; a platform is one entry.
  src/usePipelines.ts   Pipeline lifecycle, timeouts, cost controls.
  src/ask.pipe          The pipeline that serves every request the app makes.
  src/*.pipe            transcribe, screentext, vision — the dormant video ladder.
resolver/               Cloudflare Worker. Resolves links, holds the Apify token.
resolver/test-resolver.sh  15-case contract and security suite for the Worker.
scripts/                Operator tooling: status, deploy, publish, end-to-end YouTube.
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

Operator scripts live in [scripts/](scripts/README.md): `status.cjs` reports versions,
serving rungs and remaining budget for free; `deploy.cjs` and `publish.cjs` ship and
repoint; `yt-flow.cjs` drives the whole YouTube path end to end without a browser,
compiling the app's real prompts against the app's real pipeline.

## What building this actually involved

Not a list of technologies — the specific problems that had to be solved:

- **Working against an undocumented platform.** Several capabilities did not behave as
  documented. Each was isolated with a minimal reproduction before being designed
  around, and the findings written up in
  [docs/PLATFORM_NOTES.md](docs/PLATFORM_NOTES.md) — including an HTTP tool that
  silently truncates response strings to about 79 characters, the single constraint
  that forced the entire external-resolver design.
- **Designing a security boundary.** The resolver accepts one route, one method,
  allowlisted hosts and known URL shapes. Lookalike hosts (`youtube.com.evil.co`),
  raw IPs, localhost and plain `http://` are refused before any outbound request is
  made, so it cannot be turned into a general-purpose proxy.
- **Cost as a design constraint.** Tasks bill for as long as they are *alive*, not just
  while serving a request — so the TTL is a direct cost lever, a task is warmed only
  when the work that needs it is close enough to use it, and saved recipes are cached
  by content hash. The scope of the product itself was set by a measured price.
- **Treating model output as data, not a contract.** Malformed JSON degrades the recipe
  rather than crashing the screen, and a recipe that comes back with no method is
  refused rather than shown — a recipe without a method is not a recipe.
- **Failure design for an unattended reviewer.** Every path has a timeout, a typed error
  code, and a next action for the user. A dead pipeline must never present as a spinner
  that spins forever.
- **Scope discipline.** Features were cut on purpose, each for a stated reason, and the
  last cut was made on the final day. Those are recorded in
  [docs/DECISIONS.md](docs/DECISIONS.md), because what was deliberately *not* built is
  the more useful half of the record.

## Status

The app works end to end and is deployed to RocketRide staging. Open work is tracked
here rather than hidden:

- The full adverse-input test matrix (private or deleted videos, expired links,
  cold launch, a second account) is specified but has not been run end to end.
- No automated tests on the app itself. The resolver has a suite; the React layer is
  covered by a type check and by `scripts/yt-flow.cjs`, which exercises the real
  prompts against the real pipeline for about one run's worth of budget.
- The Worker still carries its original media route, unreachable from the app now that
  no provider returns video. It is left in place rather than deleted, for the same
  reason the pipeline ladder is.

Closed since: the model credential was suspected of being tied to the author's account,
which would have meant the app failing for anyone else who launched it. It is not — it
resolves from the server's process environment, and every account-scoped alternative was
ruled out by measurement. And a task reaped after three minutes idle used to surface as
"failed to open a data pipe" on the next request — pipelines now restart themselves
instead. Evidence for both in [docs/PLATFORM_NOTES.md](docs/PLATFORM_NOTES.md).

## Licence

MIT — see [LICENSE](LICENSE).
