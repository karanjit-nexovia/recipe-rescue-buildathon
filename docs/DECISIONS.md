# Decisions

What was decided, what was rejected, and why. Kept because on a one-week build the
things deliberately *not* built explain the result better than the things that were.

---

## Product

### The user is an intersection, not a union

**Decided 2026-09-01.** The user is not "people who watch cooking reels" and not
"international students". It is the narrow overlap: **first-year international students
cooking the food they grew up eating, for the first time.**

They watched a parent cook the dish for twenty years and only ever ate it. So they have
the strongest possible motivation — they know exactly how it is supposed to taste — and
none of the technique. The reel assumes precisely the knowledge they are missing.

Widening this to "anyone who cooks from reels" would have made every subsequent decision
mushier: which quantities to infer, how much technique to explain, what to substitute.
The narrow user answers those questions on its own.

### Rejected: "translation of Hindi reels"

The target user already speaks Hindi. Framing the product as translation solves a problem
they do not have, and would have sent the build toward language models for language's
sake. The gap is **technique**, not vocabulary.

### Rejected: "can't find the ingredient in the US" as the headline

Santa Clara University is roughly ten minutes from Indian grocery stores in Sunnyvale.
As a headline claim this is simply not true for the actual user.

It survives as a *secondary* axis: substitution works on two axes — what is in the fridge
right now, and what is obtainable on a student budget — but the fridge axis leads, because
that is the one that bites on a Tuesday night.

---

## Scope cuts

Five substantial features were cut on purpose. Each was considered properly and rejected
for a stated reason, not dropped for lack of time.

| Cut | Reason |
|---|---|
| **Generated step-by-step video** | The reel already is the video. Regenerating it adds cost and latency to reproduce something the user already has open in another tab. |
| **Cheapest-price grocery comparison** | There is no accessible grocery pricing API. Faking it with scraped or estimated prices would be inventing data and presenting it as fact. |
| **Screenshot step-confirmation** | "Photograph your pan so we can check it" is a heavy interaction to ask of someone whose hands are covered in dough. The doneness cue in text does the same job. |
| **Structured pantry CRUD** | Nobody maintains a pantry database. A free-text box — "some onions, half a lemon, the usual spices" — gets the same information with none of the upkeep. |
| **Shopping list by aisle** | Stretch goal. Cut for time, and it makes no price claims, so it adds least. |

The connecting principle: **do not invent data, and do not ask the user for structure
they will not maintain.**

---

## Technical

### One generic reasoning pipeline, not one per feature

`ask.pipe` is a bare `chat → llm → response_answers` pipeline with nothing
recipe-specific in it. Extraction and substitution are the same pipeline called with
different `Question` objects.

The alternative — a pipeline per feature — would have duplicated lifecycle, error
handling, timeout and cost management for each one. A third kind of reasoning currently
costs one new function in `prompts.ts` and no new infrastructure.

### Prompting is application code

Forced by the platform: the `prompt` node's `instructions` config is silently ignored
(see [PLATFORM_NOTES.md](PLATFORM_NOTES.md)). All prompting therefore lives in
`src/prompts.ts` as typed `Question` objects.

It turned out to be the better design regardless. Prompts are now typed, reviewable in a
diff, and changeable without touching pipeline definitions.

### Split vision out behind a threshold, rather than always running it

Vision over frames is the expensive path and only helps a minority of reels — silent
cooking videos with no legible overlay. Running it on every reel meant every user paid
for the rare case.

Escalating only when transcript plus screen text comes back under 80 characters cut
link-to-recipe from **213s to 165s**, and removed the vision cost from the common path
entirely.

### Link ingestion reuses the upload path — no second recipe pipeline

A pasted URL resolves to a browser `File`, which is exactly what a manual upload already
produced. Everything downstream is untouched.

The alternative — a separate server-side ingestion pipeline for links — would have meant
two code paths to keep behaviourally identical, and two sets of failure modes. Instead
`resolveMediaSource()` has one job: produce that `File`, or fail in a way the user can
act on.

### The resolver holds the token, and nothing else

The Cloudflare Worker exists for exactly one reason: `tool_http_request` truncates
responses to ~79 characters, so no in-platform resolver can ever return a CDN URL.

Given that a server had to exist, it was scoped as narrowly as possible: one route, one
method, one allowlisted host, three known URL shapes. Lookalike hosts
(`instagram.com.evil.co`), raw IPs and localhost are rejected before any outbound request
is made. It cannot be repurposed as a general proxy.

And because the Instagram CDN sends `Access-Control-Allow-Origin: *`, the browser
downloads the video itself — so the Worker never touches video bytes and stays out of the
data path.

### Model output is data, not a contract

Every model response is parsed defensively. Malformed JSON degrades the recipe into a
reduced form rather than throwing.

This is not defensive-programming reflex. A recipe that renders with four good steps and
one missing is useful; a stack trace is not.

### Timeouts free the UI, and deliberately do not cancel the run

A timeout rejects the promise and returns control to the interface. It cannot stop the
server-side run, which continues and may still bill.

That is the intended trade. A screen frozen on a spinner is worse for the person in front
of it than one wasted run is for the budget — and the task TTL reaps the run anyway.

---

## Process

### Ship rough early, then spend the remaining time on real users

Inverted from normal hackathon pacing, which builds until the deadline. The reasoning:
the thing being evaluated weights a real person who came back above feature count, and
treats a demo nobody has used as a serious weakness.

Feature work has a known ceiling of value. Contact with a real user does not.

### Write down the dead ends

Every measured platform limitation went into [PLATFORM_NOTES.md](PLATFORM_NOTES.md) with
its reproduction, immediately.

On a one-week build with no team, the expensive mistake is not making an error — it is
re-testing something already proven not to work, three days later, having forgotten the
result.
