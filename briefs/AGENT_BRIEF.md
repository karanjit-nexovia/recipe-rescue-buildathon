# Build brief — Reel-to-Recipe (RocketRide staging app)

You are building a RocketRide app in this workspace. Read
`.rocketride/docs/ROCKETRIDE_PIPELINES.md`, `ROCKETRIDE_APPS.md`,
`ROCKETRIDE_COMPONENT_REFERENCE.md` and `ROCKETRIDE_typescript_API.md` before
writing code. Provider names must come from `.rocketride/services-catalog.json` —
never invent one. Component config fields come from `.rocketride/schema/<provider>.json`.

## 1. The product

**One sentence:** For international students who just moved out, cooking their home
food for the first time from the reels their family sends.

A cooking reel is 45 seconds of fast cuts with no written recipe and eyeballed
quantities ("thoda sa", "namak swad anusar"). The viewer understands every word and
still cannot cook from it, because the creator cooks by instinct and skips the
quantities, prep order and doneness cues. Our user has the strongest possible
motivation (they know exactly how the dish should taste) and none of the technique
(they only ever ate it). **We fill the gap the reel assumes.**

Do NOT build: translation (the user already speaks the language), generated video,
grocery price comparison, screenshot step-verification, or a structured pantry
manager. These were considered and cut deliberately.

## 2. Scope, in build order

1. **Ingest** — accept a video file upload, and a plain-text paste fallback.
2. **Extract** — reel → structured recipe: title, servings, ingredients with *real*
   quantities inferred from context, numbered steps, per-step time, doneness cues
   ("edges pull away from the pan"), total time.
3. **Substitute** — one free-text box: "what's in your fridge?" Returns swaps with an
   honest note on what each swap costs in flavour. Free text only — no pantry CRUD.
4. **Cook mode** — step-by-step with timers. Pure client state, no LLM at runtime.
5. **Recipe book** — saved recipes persist per user. This is the return mechanic; it
   is why someone opens the app a second time. Do not cut it.
6. *(stretch)* Shopping list grouped by aisle. No price claims.

## 3. Architecture — verified against this workspace's catalog

RocketRide has native audio transcription, so **no OpenAI/Whisper key is needed.**
`audio_transcribe` accepts a **video** lane directly and emits `text`.

### Pipeline A — `recipe_extract.pipe`

    webhook_1  (source; produces video)
      -> audio_transcribe_1   input { lane: "video", from: "webhook_1" }      -> text
      -> prompt_1             input { lane: "text",  from: "audio_transcribe_1" } -> questions
      -> llm_anthropic_1      input { lane: "questions", from: "prompt_1" }   -> answers
      -> response_answers_1   input { lane: "answers", from: "llm_anthropic_1" }

Optional second branch for on-screen text (many reels put quantities in overlays),
merged into the same `prompt_1` as a second `text` input:

    webhook_1 -> frame_grabber_1 { lane: "video" } -> image
              -> ocr_1           { lane: "image" } -> text  -> prompt_1

### Pipeline B — `substitute.pipe`

    chat_1 (source; produces questions)
      -> llm_anthropic_2   input { lane: "questions", from: "chat_1" } -> answers
      -> response_answers_2

Every lane above is verified against `services-catalog.json`. `response_json` takes
lane `json`, NOT `answers` — using it after an LLM is a validation error. Use
`response_answers`.

### LLM config

    "config": {
      "profile": "claude-sonnet-4-6",
      "claude-sonnet-4-6": { "apikey": "${ROCKETRIDE_ANTHROPIC_KEY}" },
      "parameters": {}
    }

Confirm available profiles in `.rocketride/schema/llm_anthropic.json` before pinning a
different one. Add `ROCKETRIDE_ANTHROPIC_KEY` to `.env` in the same change.

### Recipe book storage

Use the app-state blob via `useWorkspace()` (see ROCKETRIDE_APPS.md § State &
Persistence). It is per-user and free. Do not reach for `memory_persistent` unless
app state proves insufficient — it is a pipeline node and adds a run to every save.

## 4. Platform rules that fail the build if broken

- `.pipe` extension, never `.json` — tooling will not pick up the file otherwise.
- `components` is the **first** field; `project_id`, `viewport`, `version` at the bottom.
- `project_id` is a literal fresh GUID per file, never a `${VAR}`.
- Every component needs a `config` object, even `{}`.
- Source config needs all four fields:
  `{ "hideForm": true, "mode": "Source", "parameters": {}, "type": "<provider>" }`
- Only `${ROCKETRIDE_*}` env vars substitute. Any other `${VAR}` arrives as `<REDACTED>`.
- In the app, import the `.pipe` and pass `pipeline:` — never `filepath:` (browser has
  no filesystem).
- `client.use()` is expensive: call once per session with `useExisting: true`, keep the
  token. Never start/stop per request.
- `client.send(token, data, objinfo, mimetype, onSSE)` for `webhook`;
  `client.chat({ token, question, onSSE })` for `chat`. Wrong method to wrong source is a
  common failure.
- Set `"authenticated": false` in the app's `package.json` — the shell's own sign-in wall
  opens a window that may not complete inside the VS Code webview.
- App id must match in BOTH `package.json` (`appManifest.id`) and `src/AppDescriptor.ts`.
- Keep strict type checking ON. Deploy early and often so failures surface now.

## 5. Robustness — this is graded

The judges launch this offline, later, with nobody to restart anything. Handle:

- A video with no speech at all → fall back to the OCR branch, then to asking the user
  to paste the caption. Never a blank screen.
- An LLM answer that is not valid JSON → parse defensively. Model output is data, not a
  contract. Show the recipe in a degraded form rather than crashing.
- Pipeline failure → catch `PipeException` (from `'rocketride'`) at the call site and
  render a real error state. Also check `getTaskStatus(token)` for a task that died
  between requests.
- A huge or non-video upload → reject with a clear message before it reaches the pipeline.
- Cache extracted recipes by content hash so re-opening a saved recipe costs nothing.

## 6. Definition of done

Deployed to `@me` on staging, launches clean from `staging.rocketride.ai` with the App
Builder panel closed, survives a junk input without falling over, and turns a real reel
into a recipe a beginner could actually cook. Target cost ≈ 6 cents per recipe, $0 on
re-open — state this number in the submission.
