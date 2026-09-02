# Briefs — historical record

**These documents describe the plan at the start of the build, not the app that exists.**
They are kept unedited, on purpose. Read `../README.md` and `../docs/ARCHITECTURE.md` for
what was actually built.

| File | What it is |
|---|---|
| `AGENT_BRIEF.md` | The build brief written before any code, 2026-09-01. |
| `PROJECT_CONTEXT.md` | Product framing and the competition constraints. |

## Where the plan and the result diverge

Worth reading side by side, because every difference below was forced by something
measured rather than chosen freely. The reasons are in
[../docs/PLATFORM_NOTES.md](../docs/PLATFORM_NOTES.md).

| The brief says | What shipped | Why |
|---|---|---|
| Two pipelines: `recipe_extract.pipe` and `substitute.pipe` | Three: `transcribe.pipe`, `vision.pipe`, `ask.pipe` | Extraction and substitution collapsed into *one* generic `ask.pipe`. Transcription split out because it needs no model and should not cost model prices. Vision split out again so the expensive path only runs when the cheap one comes back empty. |
| `llm_anthropic` with `${ROCKETRIDE_ANTHROPIC_KEY}` | `llm_openai` with `${ROCKETRIDE_OPENAI_KEY}` | The Anthropic key could not be topped up; the platform's own org-layer key was available and already funded. |
| Prompting configured on the `prompt` node | All prompting in `src/prompts.ts` | The `prompt` node's `instructions` config is silently ignored — proven with a canary instruction that never reached the model. |
| Ingest = file upload plus a text-paste fallback | Also accepts a pasted Instagram link | Added after the core worked. It reuses the upload path exactly: the link resolves to a browser `File`, so there is no second recipe pipeline. |
| No external services | A Cloudflare Worker | `tool_http_request` truncates response strings to ~79 characters, so no in-platform resolver can ever return a CDN URL. This was measured three times before accepting an external dependency. |

The brief's product framing — the user, the cuts, the definition of done — held up
unchanged. The architecture section did not survive contact with the platform.
