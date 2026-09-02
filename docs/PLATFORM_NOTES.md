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

## Still unmeasured

Honest gaps, so nobody assumes these are known:

- **`frame_grabber` sampling rate.** Frame grab plus OCR is 71s of the 165s total and is
  the remaining bottleneck. Its sampling config field names are absent from both the
  schema and the docs, so capping it needs experimentation.
- **Model key resolution across accounts.** `${ROCKETRIDE_OPENAI_KEY}` resolves from the
  platform env layer. Whether it resolves under an account other than the author's has
  never been tested, and an org-scoped key has not been tried.
