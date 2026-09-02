# Project context — portable summary for any LLM

Paste this whole file as your first message to bring another model up to speed.
It assumes the model has no access to the RocketRide workspace or docs.

## The competition

RocketRide x SCU Buildathon. Runs 31 Aug – 6 Sep 2026; submission form releases 4 Sep.
Solo entry. Build on `staging.rocketride.ai` (not production), promo code `INDIAHACK`,
publish to `@me` or `@team` (`@public` needs review and is not required).

**Judging, in their own words:**

| Criterion | What it means |
| --- | --- |
| Does it have a real user? | Someone not on the team used it **and came back**. Listed first, weighted highest. |
| Is the problem specific? | *"AI for productivity loses. Expense sorting for food trucks wins."* |
| Is it listed and working? | Published on staging, runs when the judges launch it — offline, later, unattended. |
| Is it built properly? | Handles bad input, doesn't fall over, **costs something sane per run**. |

**Automatic disqualifiers:** never listed · works only on your machine · a demo with no
user · a wrapper with a landing page.

Notably absent from the rubric: technical difficulty, novelty, feature count. Their own
words: *"None of these are technically hard. All of them are things someone would pay
for, which is the point."*

## The product

**For international students who just moved out, cooking their home food for the first
time from the reels their family sends.**

The insight: a cooking reel is 45 seconds of fast cuts with no written recipe and
eyeballed quantities. The viewer understands every word and still can't cook from it,
because the creator cooks by instinct and omits quantities, prep order and doneness
cues. Our user watched a parent make this dish for twenty years — but they *ate*, they
never cooked. So they have maximum motivation and zero technique. The app fills the gap
the reel assumes.

**Scope:** ingest reel → structured recipe (real quantities, prep order, doneness cues)
→ free-text "what's in my fridge" substitution with honest flavour-cost notes → timed
cook mode → per-user recipe book (the reason anyone opens it twice).

**Deliberately cut, do not re-propose:**
- *Translation* — the target user already speaks the reel's language. This killed an
  earlier framing.
- *"Can't buy this ingredient in the US"* as the headline — the campus is ten minutes
  from Indian groceries. Survives only as a secondary axis.
- *Generated step-by-step video* — most expensive, slowest, zero rubric points.
- *Cheapest-price sourcing* — no accessible grocery pricing API exists; faking it trips
  the "wrapper" disqualifier.
- *Screenshot step-confirmation* — a vision call per step for no scored benefit.
- *Structured pantry CRUD* — a free-text box is faster for the user and a day cheaper.

## Platform facts (RocketRide)

Apps are React/TypeScript, built in a VS Code extension, deployed as immutable versions.
Pipelines are `.pipe` JSON files of typed components wired lane-to-lane, imported
directly into the app and run through a shared client.

Relevant to this build — all verified against the platform's component catalog:
- `audio_transcribe` takes a **video** lane and emits `text`. **Native ASR — no
  OpenAI/Whisper key needed.**
- `llm_anthropic` takes `questions`, emits `answers`; default profile
  `claude-sonnet-4-6`, key injected as `${ROCKETRIDE_ANTHROPIC_KEY}`.
- `frame_grabber` (video→image) + `ocr` (image→text) recover on-screen quantities.
- `webhook` source accepts video/text/json uploads; `chat` source accepts questions.
- `response_answers` terminates an LLM branch — `response_json` takes lane `json` and
  is the wrong node after an LLM.
- Per-user app-state blob for persistence.

Constraints worth knowing: only `${ROCKETRIDE_*}` env vars substitute (anything else
becomes `<REDACTED>`); `client.use()` is expensive and should run once per session;
the app id must match in both `package.json` and `src/AppDescriptor.ts`.

## Cost

Claude Pro does NOT cover API access — a separate `console.anthropic.com` key is
required. Roughly $0.056 per recipe on Opus 5, $0 on re-open with caching; about $6 for
a hundred recipes. ~$0.015/recipe on Haiku 4.5 if that lever is ever wanted.

## Plan shape

The decisive scheduling call: **real users are the top criterion and they are not a code
task.** Most teams build until the last night and scramble for a user, which is exactly
the "demo with no user" disqualifier. So: ship something rough and deployed by Wednesday
3 Sep, then spend Thursday and Friday on actual humans — five real users, watched using
it unaided, with verbatim quotes (the submission form asks who used it and what they
said) and at least one person returning a second time.

Submission needs: app id + version + launch link, who it's for in one sentence, the real
user and their words, a 60-second video or live link, and an honest answer to "would you
pay for this?" — where candour scores better than a pitch.
