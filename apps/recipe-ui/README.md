# Recipe Rescue

**For international students who just moved out, cooking their home food for the first
time from the reels their family sends.**

## The problem

A cooking reel is 45 seconds of fast cuts with no written recipe. You understand every
word and still can't cook from it, because the person filming is an experienced cook
making a video for other experienced cooks — so they skip the quantities, the prep
order, and every cue for what "done" looks like. They say *"thoda sa"*, *"salt to
taste"*, *"cook till it's ready"*.

If you grew up eating a dish but never cooked it, that gap is the whole problem. You
have maximum motivation and none of the technique.

## What it does

**Drop in a reel** — paste an Instagram link, or upload the video yourself. The audio is
transcribed and on-screen text is read from the video frames, which is often where the
exact quantities actually live. No video? Paste the caption instead.

**Get a recipe you can follow.** Vague amounts become concrete ones, marked as estimates
so you know what came from the cook and what didn't. Every step that can go wrong gets a
sensory cue — *"the seeds sizzle and start popping, and smell toasty — not dark brown"*.
Steps are reordered the way one person actually works. Anything the reel never said is
listed honestly rather than invented.

**Cook with what you have.** Type what's in your kitchen, roughly — "some onions, half a
lemon, the usual spices". You get a straight answer about whether you can make this
tonight, with an honest note on what each substitution costs you in flavour. It will not
pretend a swap is free, and it won't substitute the ingredient the dish is built around —
if the cumin is gone, it says so and names something you *could* make instead.

**Timers and a recipe book.** Step-by-step cooking with timers on the steps where a timer
genuinely helps. Recipes you save stay in your book, ready to cook again.

## How it's built

Three pipelines, but only one of them does any thinking.

`transcribe.pipe` turns media into text — `audio_transcribe` for speech, `frame_grabber`
into `ocr` for on-screen text. It runs no model, so it costs nothing.

`vision.pipe` reads the frames with an image model, and runs *only* when transcription
and OCR together come back with almost nothing — a silent reel with no legible overlay.
Keeping it behind that threshold is what took a recipe from 213 seconds down to 165.

`ask.pipe` is a single generic chat pipeline; all prompting lives in `src/prompts.ts` as
`Question` objects with `expectJson`, which is what makes the answers arrive as parsed
structured data. Extraction and substitution are the same pipeline, asked different
questions.

Instagram links resolve through a small Cloudflare Worker (`resolver/` in the repository)
that hands back a media URL. Your browser downloads the video straight from the CDN, so
the video never passes through anyone's server in the middle.

Roughly five cents per recipe, and nothing at all to re-open one you've saved.
