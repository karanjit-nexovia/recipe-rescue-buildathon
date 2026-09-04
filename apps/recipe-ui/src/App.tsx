// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * Recipe Rescue — root component rendered by the RocketRide shell.
 *
 * For international students who just moved out, cooking their home food for
 * the first time from the reels their family sends. A reel assumes technique
 * the viewer does not have; this app restores what the reel skipped.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShellAppProps } from 'shell';
import {
	AppLayout,
	Banner,
	Button,
	Card,
	ContentHeader,
	DropZone,
	EmptyState,
	StatusBadge,
	TabControl,
	useWorkspace,
} from 'shell';

import { MAX_VIDEO_BYTES, THIN_EVIDENCE_CHARS, usePipelines } from './usePipelines';
import { CookingScreen } from './CookingScreen';
import { WelcomeScreen } from './WelcomeScreen';
import { CelebrateScreen } from './CelebrateScreen';
import { ForkScreen } from './ForkScreen';
import { GroceryScreen } from './GroceryScreen';
import { PotScreen } from './PotScreen';
import { mmss, SLOW_SECONDS } from './format';
import {
	detectPlatform,
	fetchMediaAsFile,
	looksLikeLink,
	resolveMediaSource,
	ResolveError,
	verifiedProviders,
} from './mediaSource';
import type { MediaSource } from './mediaSource';
import type { Ingredient, Recipe, SavedRecipe, Step, SubLine, Substitution } from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

const VIDEO_RE = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

/**
 * COMPETITION GUARD — remove after the buildathon closes (2026-09-06).
 *
 * Every stage that reads a video scales with its length, so reel length is the
 * single biggest lever on what a run costs: a 62-second reel measured past four
 * minutes and burned 557 platform tokens against a budget with four runs left
 * in it. Nothing about the app needs this limit; the remaining credit balance
 * does.
 *
 * Enforced on duration rather than on file size because size tracks encoding
 * quality as much as length, and it is time on the clock that costs money here.
 *
 * There is deliberately NO hard floor. Thirty seconds is the advice, because
 * shorter reels tend to skip the steps that make a recipe worth having — but a
 * short reel is CHEAPER, so refusing one would spend goodwill to save nothing.
 * A user turned away is the one thing this project cannot afford.
 */
const MAX_REEL_SECONDS = 45;
const SUGGESTED_REEL_RANGE = '30 to 45 seconds';

/** Shared by both paths, so a link and a dropped file are refused in the same
 *  words for the same reason. */
const tooLongMessage = (seconds: number): string =>
	`That reel is ${Math.round(seconds)} seconds long, and during the competition this is capped at ` +
	`${MAX_REEL_SECONDS}. Reading a video costs real credits per second of footage, and the budget ` +
	`has to last the week. Pick a reel of ${SUGGESTED_REEL_RANGE} — or paste its caption below, ` +
	`which costs almost nothing and is often the whole recipe.`;

/**
 * A dropped file's duration, read from its own metadata.
 *
 * The resolver hands us the length of a linked reel, but a file dropped from
 * disk has nobody to ask. The browser will decode just the metadata off an
 * object URL — no upload, no network, nothing billed — which is what makes it
 * possible to refuse an over-long video before it costs anything.
 *
 * Resolves null when the browser cannot read it. An unreadable duration must
 * not block the upload: failing open costs at most one run, while failing
 * closed would reject files that are perfectly fine.
 */
const readVideoSeconds = (file: File): Promise<number | null> =>
	new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const probe = document.createElement('video');
		const done = (value: number | null) => {
			URL.revokeObjectURL(url);
			probe.removeAttribute('src');
			resolve(value);
		};
		// Some containers never fire either event. Do not hang the drop on it.
		const timer = setTimeout(() => done(null), 4000);
		probe.preload = 'metadata';
		probe.onloadedmetadata = () => {
			clearTimeout(timer);
			done(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
		};
		probe.onerror = () => {
			clearTimeout(timer);
			done(null);
		};
		probe.src = url;
	});

/** Above this share of estimated ingredients, badging each one is just noise —
 *  say it once at the top instead. */
const MOSTLY_ESTIMATED = 0.6;

/**
 * Things nobody thinks of as ingredients they "have" — they are just there.
 *
 * Making someone tick Salt, Oil and Water is friction, and forgetting to tick
 * them produces a wrong answer: the fridge check dutifully reports the salt as
 * missing and hands back a recipe with no seasoning. These start ticked, and
 * anyone who genuinely has run out can untick them.
 */
const PANTRY_BASICS =
	/^(salt|sea salt|table salt|kosher salt|water|oil|cooking oil|vegetable oil|olive oil|neutral oil|sunflower oil|black pepper|pepper|sugar)\b/i;

const isPantryBasic = (ing: Ingredient): boolean =>
	PANTRY_BASICS.test((ing.item ?? '').replace(/\(.*?\)/g, '').trim());

/** Halving and doubling is what people actually do; anything finer is a slider
 *  nobody asked for. Labels stay in the language of servings, not multipliers. */
const SCALES: Array<[number, string]> = [
	[0.5, 'Half'],
	[1, '1x'],
	[2, '2x'],
	[3, '3x'],
];

type View =
	| 'welcome'
	| 'source'
	| 'ingest'
	/** The wait between handing over a link and having a recipe. Its own screen
	 *  because it lasts minutes, not because there is anything to do on it. */
	| 'cooking'
	/** The wait while swaps for THIS dish are worked out. */
	| 'adjusting'
	/** The wait while a different dish is written from what is in the kitchen. */
	| 'improvising'
	/** Everything ticked. No call to make, and the best news the app has. */
	| 'celebrate'
	/** Something missing: go and get it, or cook something else. */
	| 'fork'
	/** The list of what to buy, and the kind of shop that stocks it. */
	| 'grocery'
	| 'ingredients'
	| 'verdict'
	| 'recipe'
	| 'cook'
	| 'done'
	| 'book';

/** Which way in the user chose on the second screen. */
type SourceMode = 'link' | 'describe';

// =============================================================================
// STYLES
// =============================================================================

const s: Record<string, React.CSSProperties> = {
	// The client area is a fixed zone — the app must scroll inside it rather
	// than overflow, or the user has to zoom out to see the page.
	scroll: { height: '100%', overflowY: 'auto', overflowX: 'hidden' },
	page: { maxWidth: 840, margin: '0 auto', padding: '28px 28px 72px' },
	sticky: {
		position: 'sticky',
		top: 0,
		zIndex: 2,
		background: 'var(--rr-bg-primary, var(--rr-bg, #fff))',
		paddingTop: 4,
		marginBottom: 16,
	},

	stack: { display: 'flex', flexDirection: 'column', gap: 16 },
	row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
	muted: { fontSize: 13, color: 'var(--rx-ink-soft)', lineHeight: 1.55 },
	meta: { fontSize: 12.5, color: 'var(--rx-ink-soft)', letterSpacing: 0.2 },


	textarea: {
		width: '100%',
		minHeight: 130,
		padding: 12,
		borderRadius: 8,
		border: '1px solid var(--rx-line)',
		fontFamily: 'inherit',
		fontSize: 13.5,
		lineHeight: 1.6,
		background: 'var(--rr-bg-input, transparent)',
		color: 'var(--rx-ink)',
		resize: 'vertical',
		boxSizing: 'border-box',
	},

	// --- ingredients -------------------------------------------------------
	ingRow: {
		display: 'grid',
		gridTemplateColumns: '1fr auto',
		gap: '4px 18px',
		alignItems: 'baseline',
		padding: '10px 0',
		borderBottom: '1px solid var(--rx-line)',
	},
	ingName: { fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
	ingQty: {
		fontSize: 13,
		fontVariantNumeric: 'tabular-nums',
		color: 'var(--rx-ink-soft)',
		textAlign: 'right',
		whiteSpace: 'normal',
		maxWidth: 260,
	},
	ingNote: { gridColumn: '1 / -1', fontSize: 12.5, color: 'var(--rx-ink-soft)', lineHeight: 1.5 },

	// --- steps -------------------------------------------------------------
	doneWhen: {
		marginTop: 8,
		padding: '8px 11px',
		borderRadius: 6,
		borderLeft: '3px solid var(--rx-gold)',
		background: 'var(--rx-gold-wash)',
		fontSize: 12.5,
		lineHeight: 1.55,
	},

	// --- cook mode ---------------------------------------------------------
	progressTrack: { height: 3, borderRadius: 2, background: 'rgba(31, 28, 22, 0.09)', overflow: 'hidden', marginTop: 14 },
	progressFill: { height: '100%', background: 'var(--rx-gold)', transition: 'width 300ms linear' },
};

// =============================================================================
// STYLESHEET
//
// Inline style objects cannot express a media query, and the recipe screen
// needs one: on a laptop the ingredients belong beside the method, held in
// place while the steps scroll, and on a phone they belong above it. Everything
// here is scoped under .rx- and themed from the shell's own CSS variables, so
// it follows light and dark without knowing which is active.
// =============================================================================

const CSS = `
/* ===========================================================================
   PALETTE — gold on warm white.
   
   The accent is set as the shell's own --rr-accent rather than only on our
   classes, because Buttons, Banners and Cards are the shell's components: style
   ours alone and you get gold content sitting in blue chrome.

   Gold is used sparingly and on purpose. It marks the things you act on — the
   primary button, a ticked box, a progress bar, the cue in cook mode — and
   never decorates. A page where everything is gold has no accent at all, only
   a colour scheme, and the ticked-off state stops meaning anything.
   =========================================================================== */
:root {
  --rx-gold: #b8912f;
  --rx-gold-soft: #d8bb6b;
  --rx-gold-wash: rgba(184, 145, 47, 0.09);
  --rx-ink: #1f1c16;
  --rx-ink-soft: #6d6559;
  --rx-line: rgba(31, 28, 22, 0.11);
  --rx-paper: #fdfbf6;
  --rx-card: #ffffff;

  /* Hand the accent to the shell so its own components come along. */
  --rr-accent: var(--rx-gold);
  --rr-accent-hover: #a37f28;
}

/* Warm white ground, and a serif for the things you read rather than press —
   a recipe is a document before it is an interface. */
.rx-page { background: var(--rx-paper); color: var(--rx-ink); }
.rx-page h1, .rx-page h2, .rx-title, .rx-hero h1, .rx-verdict h2, .rx-done h2 {
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  font-weight: 600; letter-spacing: -0.2px;
}
.rx-page .rx-label { color: var(--rx-gold); opacity: 0.95; }
.rx-head { margin-bottom: 22px; }
.rx-title { font-size: 27px; line-height: 1.18; font-weight: 650; letter-spacing: -0.4px; margin: 0 0 12px; }
.rx-chips { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
.rx-chip {
  font-size: 12.5px; padding: 4px 11px; border-radius: 999px;
  background: var(--rx-gold-wash);
  color: var(--rx-ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* The whole point of the redesign: what I need, beside what I do. */
/* Same trap as .rx-ways: this breakpoint is measured against the window, but
   the app is a panel inside the shell and its column is narrower. The
   minmax(0, ...) is what lets each side shrink — a grid track will not go
   below its content's min-content width unless told it may, which is how a
   long ingredient name pushes the method off the edge of the card. */
.rx-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 30px; }
.rx-split > * { min-width: 0; }
@media (min-width: 880px) {
  .rx-split { grid-template-columns: minmax(0, 330px) minmax(0, 1fr); gap: 44px; align-items: start; }
  /* The verdict screen has no method beside it, so it takes the full width. */
  .rx-split.rx-solo { grid-template-columns: 1fr; max-width: 680px; margin: 0 auto; }
}

.rx-label {
  font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--rx-ink-soft); margin: 0 0 14px;
}

.rx-group { margin: 0 0 20px; }
.rx-group:last-child { margin-bottom: 0; }
.rx-group-name { font-size: 12.5px; font-weight: 650; margin: 0 0 7px; }
.rx-ing {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 14px; padding: 7px 0;
  border-bottom: 1px solid var(--rx-line);
}
.rx-ing:last-child { border-bottom: 0; }
.rx-ing-name { font-size: 13.5px; line-height: 1.45; }
.rx-ing-qty {
  font-size: 13px; text-align: right; color: var(--rx-ink-soft);
  font-variant-numeric: tabular-nums; max-width: 160px;
}

/* ---------------------------------------------------------------------------
   OVERFLOW GUARDS

   Every string on these screens is model output, and the model writes things
   like "Neutral oil (vegetable/rapeseed) + ghee or butter" and "Kasuri methi
   (dried fenugreek leaves)". A browser will not break inside a parenthesised
   run or at a slash, so those sail straight out through the side of the card.
   A grid column also refuses to shrink below its content unless told, which is
   what minmax(0, ...) is for: 1fr alone means min-content, not zero.
   --------------------------------------------------------------------------- */
.rx-ing { grid-template-columns: minmax(0, 1fr) minmax(0, auto); }
.rx-ing-name, .rx-ing-qty, .rx-ing-note,
.rx-step-text, .rx-cook-step, .rx-cook-cue, .rx-cook-ing,
.rx-verdict p, .rx-sub-line, .rx-title { overflow-wrap: anywhere; }
/* A chip may sit on one line, but not at the cost of leaving the box. */
.rx-chip { white-space: normal; overflow-wrap: anywhere; }
/* A word, not a badge. Thirty badges down a list is thirty things shouting. */
.rx-est { font-size: 10.5px; letter-spacing: 0.4px; text-transform: uppercase; color: var(--rx-ink-soft); opacity: 0.7; margin-left: 7px; }
.rx-ing-note { grid-column: 1 / -1; font-size: 12px; color: var(--rx-ink-soft); line-height: 1.45; margin-top: 2px; }

.rx-step {
  display: grid; grid-template-columns: 26px 1fr; gap: 16px; padding: 19px 0;
  border-bottom: 1px solid var(--rx-line);
}
.rx-step:first-of-type { padding-top: 0; }
.rx-step:last-child { border-bottom: 0; }
.rx-step-n { font-size: 13px; font-weight: 700; color: var(--rx-ink-soft); font-variant-numeric: tabular-nums; padding-top: 3px; }
/* Read from across a counter, often with one hand and wet fingers. */
.rx-step-text { font-size: 15.5px; line-height: 1.62; }
.rx-step-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.rx-step-time { font-size: 12px; color: var(--rx-ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; padding-top: 3px; }
/* Was a bordered, filled callout on every step. Thirteen of those down a page
   is thirteen alarms; the cue is supporting text, so it now reads as such. */
.rx-cue { margin-top: 7px; font-size: 13px; line-height: 1.5; color: var(--rx-ink-soft); }
.rx-cue b { font-weight: 600; color: var(--rx-ink); }

.rx-caveats { margin-top: 30px; padding-top: 22px; border-top: 1px solid var(--rx-line); }
.rx-caveats ul { margin: 0; padding-left: 17px; }
.rx-caveats li { font-size: 12.5px; line-height: 1.55; color: var(--rx-ink-soft); margin-bottom: 6px; }


/* --- the guided flow ------------------------------------------------------ */
.rx-hero { text-align: center; padding: 44px 16px 36px; }
.rx-hero h1 { font-size: 30px; line-height: 1.2; font-weight: 650; letter-spacing: -0.5px; margin: 0 0 12px; }
.rx-hero p { font-size: 14.5px; line-height: 1.6; color: var(--rx-ink-soft); margin: 0 auto 26px; max-width: 460px; }
.rx-choices { display: grid; gap: 14px; grid-template-columns: 1fr; max-width: 620px; margin: 0 auto; }
@media (min-width: 680px) { .rx-choices { grid-template-columns: 1fr 1fr; } }
.rx-choice {
  text-align: left; appearance: none; font: inherit; cursor: pointer;
  padding: 20px; border-radius: 12px;
  border: 1px solid var(--rx-line);
  background: transparent; color: inherit;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}
.rx-choice:hover { border-color: var(--rx-gold); background: var(--rx-gold-wash); transform: translateY(-2px); }
.rx-choice b { display: block; font-size: 15px; margin-bottom: 6px; }
.rx-choice span { font-size: 12.5px; line-height: 1.55; color: var(--rx-ink-soft); }
.rx-steps { display: flex; gap: 7px; align-items: center; justify-content: center; margin-bottom: 22px; }
.rx-pip { width: 26px; height: 3px; border-radius: 2px; background: rgba(31, 28, 22, 0.10); transition: background 240ms ease; }
.rx-pip.is-on { background: var(--rx-gold); }
.rx-pip.is-past { background: var(--rx-ink-soft); opacity: 0.4; }
.rx-verdict { text-align: center; padding: 10px 0 26px; }
.rx-verdict h2 { font-size: 23px; font-weight: 640; margin: 0 0 10px; letter-spacing: -0.3px; }
.rx-verdict p { font-size: 14px; line-height: 1.6; color: var(--rx-ink-soft); margin: 0 auto; max-width: 520px; }
@media (prefers-reduced-motion: reduce) { .rx-choice:hover { transform: none; } }



/* Suggestions, not the recipe. Visibly its own thing, so nobody mistakes an
   idea of ours for something the cook actually did. */
.rx-touches { margin-top: 26px; padding: 16px 18px; border-radius: 10px; background: var(--rx-gold-wash); }
.rx-touches ul { margin: 0; padding-left: 17px; }
.rx-touches li { font-size: 13px; line-height: 1.6; margin-bottom: 7px; }
.rx-touches li:last-child { margin-bottom: 0; }

/* --- finishing ------------------------------------------------------------ */
@keyframes rx-rise { 0% { opacity: 0; transform: scale(0.94) translateY(10px); } 100% { opacity: 1; transform: none; } }
.rx-done { text-align: center; padding: 50px 16px 40px; animation: rx-rise 420ms cubic-bezier(0.2,0.8,0.3,1) both; }
.rx-done .rx-mark {
  width: 62px; height: 62px; border-radius: 50%; margin: 0 auto 22px;
  display: flex; align-items: center; justify-content: center;
  background: var(--rx-gold); color: #fff; font-size: 30px; line-height: 1;
  animation: rx-pop 520ms 160ms cubic-bezier(0.2,0.8,0.3,1) both;
}
.rx-done h2 { font-size: 27px; font-weight: 650; letter-spacing: -0.4px; margin: 0 0 12px; }
.rx-done p { font-size: 14.5px; line-height: 1.6; color: var(--rx-ink-soft); margin: 0 auto 26px; max-width: 440px; }
@media (prefers-reduced-motion: reduce) { .rx-done, .rx-done .rx-mark { animation: none; } }

/* Cards lift off the warm ground rather than sitting flush against it. */
.rx-page [class*="card"], .rx-page [class*="Card"] {
  border-radius: 12px;
}

/* The one place gold is allowed to be a surface rather than a mark. */
.rx-choice:hover { border-color: var(--rx-gold); background: var(--rx-gold-wash); }
.rx-chip { border: 1px solid var(--rx-line); background: transparent; }
.rx-group-name { color: var(--rx-ink); }
.rx-touches { background: var(--rx-gold-wash); border: 1px solid rgba(184, 145, 47, 0.18); }
.rx-done .rx-mark { box-shadow: 0 6px 20px rgba(184, 145, 47, 0.35); }
.rx-timer { color: var(--rx-ink); }
.rx-est { color: var(--rx-gold); opacity: 0.85; }

/* Ticked reads as confirmed, in the accent, without shouting. */
.rx-ing.is-done .rx-ing-name { color: var(--rx-ink-soft); }

/* --- motion ------------------------------------------------------------- */
@keyframes rx-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
.rx-in { animation: rx-in 280ms cubic-bezier(0.2,0.7,0.3,1) both; }
.rx-in-2 { animation-delay: 70ms; }
.rx-in-3 { animation-delay: 140ms; }
@keyframes rx-pop { 0% { transform: scale(1); } 40% { transform: scale(1.18); } 100% { transform: scale(1); } }

/* --- ticking things off -------------------------------------------------- */
.rx-ing, .rx-step {
  cursor: pointer; border-radius: 7px;
  padding-left: 7px; padding-right: 7px; margin-left: -7px; margin-right: -7px;
  transition: background 160ms ease, opacity 220ms ease;
}
.rx-ing:hover, .rx-step:hover { background: var(--rx-gold-wash); }
.rx-ing-name { display: flex; align-items: flex-start; }
.rx-box {
  width: 15px; height: 15px; border-radius: 4px; flex: none; margin: 2px 10px 0 0;
  border: 1.5px solid rgba(31, 28, 22, 0.22);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; line-height: 1; color: transparent;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}
.is-done .rx-box { background: var(--rx-gold); border-color: var(--rx-gold); color: #fff; animation: rx-pop 260ms ease; }
.rx-ing.is-done .rx-ing-name { color: var(--rx-ink-soft); }
.rx-ing.is-done .rx-ing-qty { opacity: 0.75; }
.rx-step.is-done { opacity: 0.45; }
.rx-step.is-done .rx-step-text { text-decoration: line-through; }

.rx-progress { display: flex; align-items: center; gap: 11px; margin-bottom: 15px; }
.rx-bar { flex: 1; height: 4px; border-radius: 3px; background: rgba(31, 28, 22, 0.09); overflow: hidden; }
.rx-bar-fill { height: 100%; background: var(--rx-gold); border-radius: 3px; transition: width 340ms cubic-bezier(0.2,0.7,0.3,1); }
.rx-count { font-size: 12px; color: var(--rx-ink-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* The availability check belongs beside the ingredients it asks about, not
   below thirteen steps. It also fills the column the sticky aside used to
   leave empty. */
.rx-panel { margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--rx-line); }
.rx-solo .rx-panel { margin-top: 0; padding-top: 0; border-top: 0; }
.rx-panel textarea { font-size: 13px; }

/* --- serving scaler ------------------------------------------------------ */
.rx-scale { display: inline-flex; border: 1px solid var(--rx-line); border-radius: 999px; overflow: hidden; }
.rx-scale button {
  appearance: none; background: transparent; border: 0; padding: 4px 12px;
  font: inherit; font-size: 12px; color: var(--rx-ink-soft); cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}
.rx-scale button:hover { background: var(--rx-gold-wash); }
.rx-scale button.is-on { background: var(--rx-gold); color: #fff; }

/* --- cook mode ----------------------------------------------------------- */
.rx-cook { max-width: 700px; margin: 0 auto; }
.rx-cook-step { font-size: 25px; line-height: 1.45; font-weight: 500; margin: 0 0 18px; }
/* Here the accent border earns its keep: one cue on the screen, not thirteen. */
.rx-cook-cue {
  font-size: 15px; line-height: 1.55; color: var(--rx-ink-soft);
  border-left: 3px solid var(--rx-gold); padding-left: 13px; margin-bottom: 24px;
}
.rx-cook-cue b { color: var(--rx-ink); font-weight: 600; }
.rx-timer { font-size: 58px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 1px; line-height: 1.05; }
.rx-cook-ing { font-size: 13px; line-height: 1.6; color: var(--rx-ink-soft); margin-bottom: 22px; }
.rx-cook-ing b { color: var(--rx-ink); font-weight: 600; }
.rx-dots { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 24px; }
.rx-dot {
  width: 8px; height: 8px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  background: rgba(31, 28, 22, 0.10);
  transition: background 200ms ease, transform 200ms ease;
}
.rx-dot:hover { transform: scale(1.3); }
.rx-dot.is-on { background: var(--rx-gold); transform: scale(1.4); }
.rx-dot.is-past { background: var(--rx-ink-soft); opacity: 0.45; }
.rx-hint { font-size: 11.5px; color: var(--rx-ink-soft); opacity: 0.75; margin-top: 14px; }

/* ===========================================================================
   THE FRONT DOOR

   The one screen a stranger sees before deciding whether to bother. The cloche
   is the pitch in one object: it sits closed, invites a touch, and what is
   under it is a dish you already know the taste of.

   It opens on hover for the curious and on click for everyone else. A
   hover-only reveal is a reveal that does not exist on a phone, which is where
   most of the people this is for will open it.
   =========================================================================== */
.rx-welcome { text-align: center; max-width: 600px; margin: 0 auto; padding: 10px 0 8px; }
.rx-welcome-kicker {
  font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
  color: var(--rx-gold); margin: 0 0 10px;
}
.rx-welcome h1 {
  font-size: 34px; line-height: 1.14; margin: 0 0 6px;
  letter-spacing: -0.6px;
}
@media (max-width: 520px) { .rx-welcome h1 { font-size: 27px; } }
.rx-welcome-line {
  font-size: 14.5px; line-height: 1.65; color: var(--rx-ink-soft);
  margin: 0 auto 24px; max-width: 470px; min-height: 72px;
}
.rx-welcome-cta { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

/* The whole illustration is one button. */
.rx-reveal {
  display: block; width: 100%; max-width: 330px; margin: 0 auto 6px;
  background: none; border: 0; padding: 0; cursor: pointer; font: inherit;
  -webkit-tap-highlight-color: transparent;
}
.rx-reveal svg { display: block; width: 100%; overflow: visible; }
.rx-reveal:focus-visible { outline: 2px solid var(--rx-gold); outline-offset: 6px; border-radius: 4px; }

.rx-reveal-hint {
  display: inline-block; margin-top: 2px;
  font-size: 11px; letter-spacing: 1.8px; text-transform: uppercase;
  color: var(--rx-ink-soft); opacity: 0.7;
  transition: opacity 160ms ease, color 160ms ease;
}
.rx-reveal:hover .rx-reveal-hint { opacity: 1; color: var(--rx-gold); }

/* Hover peeks. Click commits. */
.rx-cloche { transition: transform 560ms cubic-bezier(0.2, 0.8, 0.25, 1); transform-box: fill-box; transform-origin: center bottom; }
.rx-reveal:hover .rx-cloche { transform: translateY(-9px); }
.rx-reveal.is-open .rx-cloche { transform: translateY(-58px) rotate(-11deg); }

.rx-dish { opacity: 0; transition: opacity 260ms ease 200ms; }
.rx-reveal.is-open .rx-dish { opacity: 1; }
/* The steam and the sparks only exist once it is open — an animation running
   under a closed lid is work nobody can see. */
.rx-dish .rx-steam { animation-play-state: paused; }
.rx-reveal.is-open .rx-dish .rx-steam { animation-play-state: running; }
.rx-cloche-sparks { opacity: 0; }
.rx-reveal.is-open .rx-cloche-sparks { opacity: 1; }
.rx-reveal.is-open .rx-cloche-sparks .rx-spark { animation-name: rx-burst; }
.rx-cloche-sparks .rx-spark { animation-name: none; }

@media (prefers-reduced-motion: reduce) {
  .rx-cloche { transition-duration: 1ms; }
  .rx-reveal:hover .rx-cloche { transform: none; }
}

/* ===========================================================================
   COOK MODE: THE STEAMY KITCHEN

   Cook mode is the only screen someone stands in front of for half an hour
   with a pan going, so it is the one screen allowed an atmosphere. Soft
   clouds drift behind the step, slowly enough that they are never the thing
   being looked at — the step is 25px and sits on a solid card above them.

   Drawn as blurred radial gradients rather than images: nothing to load,
   nothing to go wrong offline, and they tint with the palette for free.
   =========================================================================== */
/* The card the step sits on is opaque, so clouds placed only behind it are
   clouds nobody sees. The wrapper is padded to open a band around the card for
   them to drift through, and one more passes ABOVE it at low opacity, which is
   what makes the screen feel steamy rather than merely bordered. */
.rx-steamy { position: relative; isolation: isolate; padding: 34px 26px; }
@media (max-width: 560px) { .rx-steamy { padding: 22px 8px; } }
.rx-steamy > .rx-clouds {
  position: absolute; inset: 0; z-index: -1;
  overflow: hidden; border-radius: 14px; pointer-events: none;
  background: linear-gradient(170deg, rgba(184,145,47,0.05), rgba(184,145,47,0) 60%);
}
.rx-cloud {
  position: absolute; border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(184,145,47,0.30), rgba(184,145,47,0) 70%);
  filter: blur(10px);
  animation: rx-drift 26s ease-in-out infinite;
}
.rx-cloud:nth-child(1) { width: 340px; height: 220px; top: -60px; left: -70px; }
.rx-cloud:nth-child(2) { width: 300px; height: 200px; bottom: -70px; right: -60px; animation-duration: 34s; animation-delay: -8s; }
.rx-cloud:nth-child(3) { width: 420px; height: 250px; bottom: -90px; left: 18%; animation-duration: 30s; animation-delay: -16s;
  background: radial-gradient(circle at 50% 50%, rgba(109,101,89,0.20), rgba(109,101,89,0) 70%); }

/* Passes over the top of everything. Low enough that the 25px step reads
   straight through it, and it never takes a click. */
.rx-steamy > .rx-drifting {
  position: absolute; inset: 0; z-index: 2; overflow: hidden;
  pointer-events: none; border-radius: 14px;
}
/* Weak on purpose, and kept to the edges. A first pass at half opacity across
   the middle visibly greyed the step text — and the step is the one thing on
   this screen that must never be harder to read than it was. */
.rx-steamy > .rx-drifting .rx-cloud {
  width: 420px; height: 260px; top: -8%; left: -22%;
  background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.9), rgba(255,255,255,0) 66%);
  filter: blur(26px); opacity: 0.26;
  animation-duration: 40s;
}
.rx-steamy > .rx-drifting .rx-cloud:nth-child(2) {
  top: auto; bottom: -8%; left: auto; right: -22%;
  width: 360px; height: 230px; animation-duration: 48s; animation-delay: -20s;
}
@keyframes rx-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%      { transform: translate(22px, -14px) scale(1.08); }
  66%      { transform: translate(-16px, 10px) scale(0.95); }
}

/* ===========================================================================
   THE ENDING

   Finishing a dish is the moment the whole app exists for, and it is also the
   only honest moment to ask someone to keep the recipe: they know NOW whether
   it was any good. So the question is asked here and nowhere else.
   =========================================================================== */
.rx-finish { text-align: center; max-width: 520px; margin: 0 auto; padding: 18px 0 8px; }
.rx-finish h2 { font-size: 29px; margin: 6px 0 12px; line-height: 1.2; }
.rx-finish > p { font-size: 14px; color: var(--rx-ink-soft); margin: 0 0 24px; line-height: 1.6; }

.rx-ask { font-size: 12.5px; color: var(--rx-ink-soft); margin: 0 0 12px; }
.rx-rate { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-bottom: 26px; }
/* Square tags rather than pills. Nothing else in this app is a bubble. */
.rx-rate button {
  font: inherit; font-size: 13px; cursor: pointer;
  background: var(--rx-card); color: var(--rx-ink);
  border: 1px solid var(--rx-line); border-radius: 1px; padding: 9px 18px;
  transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
}
.rx-rate button:hover { border-color: var(--rx-gold); transform: translateY(-1px); }
.rx-rate button.is-on { background: var(--rx-gold); border-color: var(--rx-gold); color: #fff; }
.rx-rate button:focus-visible { outline: 2px solid var(--rx-gold); outline-offset: 2px; }
.rx-said {
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  font-style: italic; font-size: 14.5px; color: var(--rx-ink);
  margin: 0 0 22px; animation: rx-pop-in 380ms cubic-bezier(0.2,0.7,0.3,1) both;
}

/* ===========================================================================
   THE FORK IN THE ROAD, AND THE THREE ROADS OUT

   Ticking the menu ends in one of three places, and each gets its own screen
   rather than three states of one. The shared vocabulary is the ink line art
   and the single gold accent; what differs is the motion, because the motion
   is what says which of the three happened before a word is read.
   =========================================================================== */

/* --- the celebration: nothing is missing ------------------------------- */
.rx-celebrate { text-align: center; padding: 26px 0 8px; }
.rx-celebrate h2 { font-size: 28px; margin: 4px 0 12px; }
.rx-celebrate p { font-size: 14px; color: var(--rx-ink-soft); margin: 0 auto 22px; max-width: 420px; line-height: 1.6; }
.rx-scene { display: block; width: 100%; max-width: 280px; margin: 0 auto 22px; overflow: visible; }

/* Steam is the one thing on this screen that keeps moving. Everything else
   fires once and settles — a celebration that loops is a spinner. */
@keyframes rx-steam {
  0%   { opacity: 0; transform: translateY(4px) scaleX(0.9); }
  30%  { opacity: 0.75; }
  100% { opacity: 0; transform: translateY(-22px) scaleX(1.25); }
}
.rx-steam { transform-box: fill-box; transform-origin: center bottom; animation: rx-steam 2600ms ease-out infinite; }
.rx-steam-2 { animation-delay: 700ms; }
.rx-steam-3 { animation-delay: 1400ms; }

@keyframes rx-burst {
  0%   { opacity: 0; transform: translate(0, 0) scale(0.4); }
  35%  { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--bx), var(--by)) scale(1); }
}
.rx-spark {
  transform-box: fill-box; transform-origin: center;
  animation: rx-burst 1100ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

/* --- the fork: two ways forward ---------------------------------------- */
.rx-fork { max-width: 780px; margin: 0 auto; text-align: center; }
.rx-fork > h2 { font-size: 25px; margin: 0 0 8px; }
.rx-fork > p { font-size: 13.5px; color: var(--rx-ink-soft); margin: 0 auto 24px; line-height: 1.6; max-width: 520px; }
/* auto-fit, not a media query. The breakpoint would be measured against the
   VIEWPORT, but this app is a panel inside the RocketRide shell and its column
   is narrower than the window — so a viewport rule happily lays out three
   columns in a space that fits two, and the third goes out through the side.
   auto-fit asks the container instead, which is the thing that actually
   constrains it. */
.rx-ways {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}
.rx-way:nth-child(3) { animation-delay: 260ms; }

/* They pop in rather than appear, one after the other, because a choice
   offered a beat apart reads as two options — arriving together it reads as
   a wall of buttons. */
@keyframes rx-pop-in {
  0%   { opacity: 0; transform: translateY(14px) scale(0.96); }
  60%  { transform: translateY(-3px) scale(1.01); }
  100% { opacity: 1; transform: none; }
}
/* Index cards, not buttons: square, a gold rule along the top edge, and the
   heading set in the same serif as everything else worth reading. */
.rx-way {
  background: var(--rx-card); border: 1px solid var(--rx-line); border-radius: 0;
  border-top: 2px solid var(--rx-gold);
  padding: 22px 20px; text-align: left; cursor: pointer; width: 100%;
  font: inherit; color: inherit;
  animation: rx-pop-in 420ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  transition: border-color 140ms ease, transform 140ms ease, background 140ms ease;
}
.rx-way:hover { background: var(--rx-gold-wash); }
.rx-way:nth-child(2) { animation-delay: 130ms; }
.rx-way:hover { border-color: var(--rx-gold); transform: translateY(-2px); }
.rx-way:focus-visible { outline: 2px solid var(--rx-gold); outline-offset: 2px; }
.rx-way-icon { display: block; margin-bottom: 12px; }
.rx-way h3 {
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  font-size: 17px; font-weight: 600; margin: 0 0 6px;
}
.rx-way p { font-size: 12.5px; color: var(--rx-ink-soft); margin: 0; line-height: 1.5; }

/* --- the grocery run ----------------------------------------------------
   Set as a paper slip torn off a pad, not a panel: square corners, a ruled
   row per line, a tally at the foot, and a torn bottom edge. It is a thing
   carried into a shop, so it should look like one. */
.rx-grocery { max-width: 520px; margin: 0 auto; text-align: center; }
.rx-grocery h2 { font-size: 25px; margin: 0 0 8px; }
.rx-grocery > p { font-size: 13.5px; color: var(--rx-ink-soft); margin: 0 auto 20px; line-height: 1.6; max-width: 430px; }

/* Each item drops into the basket a beat after the one before. The stagger is
   the whole effect: a list that appears all at once is a list, and a list that
   arrives item by item is a basket filling up. */
@keyframes rx-drop-in {
  0%   { opacity: 0; transform: translateY(-16px) rotate(-6deg); }
  70%  { transform: translateY(2px) rotate(1deg); }
  100% { opacity: 1; transform: none; }
}
.rx-slip {
  background: var(--rx-card);
  border: 1px solid var(--rx-line);
  border-bottom: 0;
  padding: 6px 0 0; margin-bottom: 22px; text-align: left;
  background-image: linear-gradient(178deg, var(--rx-gold-wash) 0%, rgba(255,255,255,0) 38%);
}
/* The torn edge along the bottom, drawn rather than pictured. */
.rx-slip-foot {
  font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--rx-ink-soft); text-align: right;
  padding: 12px 16px; border-top: 1px solid var(--rx-line);
  background:
    linear-gradient(-45deg, transparent 8px, var(--rx-card) 0) bottom left / 14px 10px repeat-x,
    var(--rx-card);
  padding-bottom: 20px;
}
.rx-buy {
  display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, auto);
  align-items: baseline; gap: 0 12px;
  padding: 11px 16px; text-align: left; cursor: pointer;
  border-bottom: 1px solid var(--rx-line);
  animation: rx-drop-in 380ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  transition: background 140ms ease;
}
.rx-buy:hover { background: var(--rx-gold-wash); }
.rx-buy:focus-visible { outline: 2px solid var(--rx-gold); outline-offset: -2px; }
/* A square box, ticked. Not a bubble — this is a list on paper. */
.rx-buy-box {
  width: 16px; height: 16px; align-self: center;
  border: 1px solid var(--rx-ink-soft); border-radius: 1px;
  color: #fff; font-size: 11px; line-height: 15px; text-align: center;
  transition: background 140ms ease, border-color 140ms ease;
}
.rx-buy.is-got .rx-buy-box { background: var(--rx-gold); border-color: var(--rx-gold); }
.rx-buy-name { font-size: 14.5px; overflow-wrap: anywhere; }
.rx-buy-qty {
  font-size: 12.5px; color: var(--rx-ink-soft); font-variant-numeric: tabular-nums;
  text-align: right; overflow-wrap: anywhere;
}
.rx-buy-why { grid-column: 2 / -1; font-size: 11.5px; color: var(--rx-ink-soft); font-style: italic; margin-top: 3px; }
/* Bought: the row steps back, so what is left is what is still to find. */
.rx-buy.is-got .rx-buy-name, .rx-buy.is-got .rx-buy-qty { color: var(--rx-ink-soft); opacity: 0.55; }
.rx-buy.is-got .rx-buy-name { text-decoration: line-through; text-decoration-color: var(--rx-line); }

.rx-where { animation: rx-pop-in 420ms cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.rx-where-note { font-size: 13.5px; color: var(--rx-ink-soft); margin: 0 auto 16px; line-height: 1.6; max-width: 430px; }
.rx-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

/* --- the mystery pot ---------------------------------------------------- */
.rx-pot-screen { text-align: center; padding: 26px 0 8px; }
.rx-pot-screen h2 { font-size: 25px; margin: 0 0 12px; }
.rx-pot-screen .rx-stage { font-size: 15px; color: var(--rx-ink); margin: 0 0 10px; }

/* An ellipse traced by hand, because a circular orbit on a pot seen from
   slightly above reads as a ring hovering over it rather than as stirring.
   --r scales each bit's radius so they ride at different depths. */
@keyframes rx-swirl {
  0%    { transform: translate(calc(40px * var(--r)), 0); }
  12.5% { transform: translate(calc(28px * var(--r)), calc(8px * var(--r))); }
  25%   { transform: translate(0, calc(11px * var(--r))); }
  37.5% { transform: translate(calc(-28px * var(--r)), calc(8px * var(--r))); }
  50%   { transform: translate(calc(-40px * var(--r)), 0); }
  62.5% { transform: translate(calc(-28px * var(--r)), calc(-8px * var(--r))); }
  75%   { transform: translate(0, calc(-11px * var(--r))); }
  87.5% { transform: translate(calc(28px * var(--r)), calc(-8px * var(--r))); }
  100%  { transform: translate(calc(40px * var(--r)), 0); }
}
.rx-swirl { transform-box: fill-box; transform-origin: center; animation: rx-swirl 4600ms linear infinite; }

/* Pivots on the ladle's bowl, which sits in the pot — so the handle sweeps
   and the bowl stays where the food is. */
@keyframes rx-stir { 0%, 100% { transform: rotate(-11deg); } 50% { transform: rotate(9deg); } }
.rx-spoon { transform-box: fill-box; transform-origin: 15% 88%; animation: rx-stir 2300ms ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .rx-steam, .rx-spark, .rx-way, .rx-buy, .rx-where, .rx-swirl, .rx-spoon,
  .rx-cloud, .rx-said { animation: none; }
  .rx-spark { opacity: 0; }
  .rx-way:hover, .rx-rate button:hover { transform: none; }
}

/* ===========================================================================
   THE MENU

   The ticking step is the one screen in the flow that is a LIST above all
   else, so it is set as a menu: a card of warm stock, a centred serif title,
   rules top and bottom, and every line running name .......... quantity.

   Dotted leaders are the whole trick. A menu uses them because the eye has to
   travel a long way from a dish to its price without losing the row, which is
   exactly the journey being made here — and unlike a table rule they cost no
   ink and imply no grid.

   Scoped under .rx-menu, deliberately. IngredientList is shared with the
   recipe screen, where the same rows sit beside a method and must stay quiet.
   =========================================================================== */
.rx-menu {
  background: var(--rx-card);
  border: 1px solid var(--rx-line);
  border-radius: 3px;
  padding: 34px 30px 30px;
  max-width: 620px;
  margin: 0 auto;
  /* Warm the stock towards the top so it reads as paper rather than as a
     panel, without a texture image to load. */
  background-image: linear-gradient(178deg, var(--rx-gold-wash) 0%, rgba(255,255,255,0) 42%);
}
@media (max-width: 560px) { .rx-menu { padding: 24px 18px 20px; } }

.rx-menu-head { text-align: center; margin: 0 0 24px; }
.rx-menu-rule { border: 0; border-top: 1px solid var(--rx-line); margin: 0; }
.rx-menu-rule.is-double {
  border-top: 3px double var(--rx-gold);
  opacity: 0.55;
}
.rx-menu-head h2 {
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  font-size: 26px; font-weight: 600; letter-spacing: -0.2px;
  margin: 16px 0 8px; line-height: 1.2;
}
.rx-menu-kicker {
  font-size: 10.5px; font-weight: 700; letter-spacing: 2.4px; text-transform: uppercase;
  color: var(--rx-gold); margin: 0;
}
.rx-menu-sub { font-size: 12.5px; color: var(--rx-ink-soft); margin: 8px 0 16px; line-height: 1.55; }

/* The row: tick, name, leader, amount. The leader is a repeating gradient on
   its own flex-filler, so it stretches to whatever gap the row leaves. */
.rx-menu .rx-ing {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: 0 10px;
  padding: 9px 0;
  border-bottom: 0;
  cursor: pointer;
}
.rx-menu .rx-ing-name {
  display: contents;
}
/* The name sits in the 1fr column and is itself a flex row: the words take
   the width they need and the leader takes everything left over. As an
   inline-block with width:100% it wrapped onto its own line — the leader has
   to be a flex sibling of the text, not a box inside its flow. */
.rx-menu .rx-ing-name > span:last-child {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 14.5px; min-width: 0;
}
.rx-menu .rx-ing-name > span:last-child::after {
  content: '';
  flex: 1 1 auto;
  transform: translateY(-4px);
  border-bottom: 1px dotted var(--rx-line);
}
/* NOT nowrap. A quantity is model output, and "3 medium potatoes (about 400g),
   peeled and cut into 2cm dice" is a quantity it really returns — held on one
   line that runs straight out of the card and off the screen. It wraps, right
   aligned, and never takes more than half the row. */
.rx-menu .rx-ing-qty {
  font-size: 13px; color: var(--rx-ink-soft); font-variant-numeric: tabular-nums;
  grid-column: 3; text-align: right; max-width: 15em; overflow-wrap: anywhere;
}
/* Set as a menu's dish description: the note explains the line above it, and
   italic serif says that without needing a label. */
.rx-menu .rx-ing-note {
  grid-column: 2 / -1; font-size: 12px; color: var(--rx-ink-soft);
  opacity: 0.9; margin-top: 3px; line-height: 1.45;
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  font-style: italic;
}

/* Ticked means "already in my kitchen", so the row steps back rather than
   lighting up: what stays dark is what still has to be bought. */
.rx-menu .rx-ing.is-done .rx-ing-name > span:last-child,
.rx-menu .rx-ing.is-done .rx-ing-qty { color: var(--rx-ink-soft); opacity: 0.6; }

.rx-menu .rx-box {
  width: 17px; height: 17px; border-radius: 2px; font-size: 11px; line-height: 17px;
  grid-column: 1; align-self: center;
}

.rx-menu .rx-group { margin-bottom: 22px; }
.rx-menu .rx-group-name {
  font-size: 10.5px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase;
  color: var(--rx-ink-soft); margin: 0 0 6px; padding-top: 6px;
}
.rx-menu-foot { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--rx-line); }

/* ===========================================================================
   THE COOKING SCREEN

   A link takes upwards of two minutes to become a recipe, and for most of it
   nothing observable happens. A banner over the ingest form spends that time
   saying the form is unavailable; this spends it showing something being made.

   The scene is drawn in the same ink-and-gold line art as the rest of the app
   rather than as a cartoon — it is a quiet screen someone will look at for two
   minutes, not a splash. The stage text and the second counter still carry the
   honest account of what is happening; the pan is only what makes the wait
   bearable while they read it.
   =========================================================================== */
.rx-cooking { text-align: center; padding: 30px 0 10px; }
.rx-stove { display: block; width: 100%; max-width: 300px; margin: 0 auto 30px; overflow: visible; }

/* One cycle is one toss: the pan tips away, everything in it leaves, and the
   pan comes back under it in time to catch. The bits are on the same duration
   so the catch lands where the throw started. */
@keyframes rx-toss {
  0%, 14%  { transform: rotate(0deg) translateY(0); }
  30%      { transform: rotate(-15deg) translateY(-7px); }
  48%      { transform: rotate(7deg) translateY(3px); }
  66%      { transform: rotate(-2deg) translateY(0); }
  100%     { transform: rotate(0deg) translateY(0); }
}
.rx-pan { transform-box: fill-box; transform-origin: 78% 55%; animation: rx-toss 1900ms ease-in-out infinite; }

/* Each bit carries its own arc in --dx / --dy, so one keyframe throws six
   ingredients along six different paths. */
@keyframes rx-fly {
  0%, 12%  { transform: translate(0, 0) rotate(0deg); }
  44%      { transform: translate(var(--dx, 0), var(--dy, -34px)) rotate(150deg); }
  72%      { transform: translate(calc(var(--dx, 0px) * 0.35), 4px) rotate(280deg); }
  100%     { transform: translate(0, 0) rotate(360deg); }
}
.rx-bit { transform-box: fill-box; transform-origin: center; animation: rx-fly 1900ms ease-in-out infinite; }

@keyframes rx-flicker {
  0%, 100% { transform: scaleY(0.86); opacity: 0.45; }
  50%      { transform: scaleY(1.18); opacity: 0.8; }
}
.rx-flame { transform-box: fill-box; transform-origin: center bottom; animation: rx-flicker 820ms ease-in-out infinite; }
.rx-flame-2 { animation-duration: 1150ms; animation-delay: 180ms; }
.rx-flame-3 { animation-duration: 950ms; animation-delay: 400ms; }

.rx-cooking h2 { font-size: 25px; margin: 0 0 14px; }
/* The stage line changes four or five times across a run. Fading each one in
   makes the change register as progress rather than as a flicker. */
.rx-stage { font-size: 15px; color: var(--rx-ink); margin: 0 0 10px; min-height: 21px; }
.rx-clock {
  font-size: 12.5px; color: var(--rx-ink-soft); font-variant-numeric: tabular-nums;
  letter-spacing: 0.3px; margin: 0;
}
.rx-reassure { font-size: 12.5px; color: var(--rx-ink-soft); opacity: 0.85; margin: 12px auto 0; max-width: 380px; line-height: 1.5; }
.rx-cooking .rx-warn { color: var(--rx-gold); opacity: 1; }

/* Respect the system setting rather than animating over someone who asked us
   not to — motion sickness and vestibular disorders are real. A still pan with
   the stage text and the counter loses nothing that matters. */
@media (prefers-reduced-motion: reduce) {
  .rx-in { animation: none; }
  .rx-dot, .rx-box, .rx-bar-fill, .rx-ing, .rx-step, .rx-scale button { transition-duration: 1ms; }
  .is-done .rx-box { animation: none; }
  .rx-pan, .rx-bit, .rx-flame { animation: none; }
}
`;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Ingredients in the order the model gave them, split wherever the component
 * changes. Order is never rearranged: the model is told to list groups in the
 * order they are first used, and re-sorting here would undo that.
 *
 * A single unnamed run means a simple dish — no headings. A single NAMED run
 * means the model grouped when it should not have, and one heading over the
 * whole list tells the reader nothing, so it is dropped.
 */
const groupIngredients = (list: Ingredient[]): Array<{ name?: string; items: Ingredient[] }> => {
	const out: Array<{ name?: string; items: Ingredient[] }> = [];
	for (const ing of list) {
		const name = ing.group?.trim() || undefined;
		const last = out[out.length - 1];
		if (last && last.name === name) last.items.push(ing);
		else out.push({ name, items: [ing] });
	}
	if (out.length === 1) out[0].name = undefined;
	return out;
};

/**
 * Rewrite the numbers in a quantity for a different number of servings.
 *
 * Quantities are free text a model wrote — "1.5–2 lbs (700-900 g)", "3/4 tsp",
 * "1 large or 2 medium". So this rewrites every number it finds, which is right
 * for a quantity string: both halves of a range scale, and so does the gram
 * figure in the brackets.
 *
 * It is deliberately confined to ingredient quantities and never touches step
 * text, where the numbers mean something else entirely — a 400°F oven and an
 * 8x8 dish do not double because you are cooking for four.
 *
 * Where nothing parses, the text comes back untouched rather than mangled, and
 * the caller marks the recipe as scaled so a reader knows the amounts are no
 * longer the ones that were read off the video.
 */
const NUMBER_RE = /\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+/g;

/** Back to the fractions people actually measure with. "0.75 tsp" helps nobody. */
const prettyAmount = (n: number): string => {
	if (!Number.isFinite(n) || n <= 0) return '';
	const rounded = Math.round(n * 1000) / 1000;
	const whole = Math.floor(rounded);
	const frac = rounded - whole;
	const NEAR: Array<[number, string]> = [
		[0.125, '1/8'],
		[0.25, '1/4'],
		[1 / 3, '1/3'],
		[0.5, '1/2'],
		[2 / 3, '2/3'],
		[0.75, '3/4'],
	];
	if (frac < 0.02) return String(whole);
	if (frac > 0.98) return String(whole + 1);
	for (const [value, label] of NEAR) {
		if (Math.abs(frac - value) < 0.03) return whole ? `${whole} ${label}` : label;
	}
	return String(Math.round(rounded * 10) / 10);
};

const scaleQuantity = (text: string, factor: number): string => {
	if (factor === 1 || !text) return text;
	return text.replace(NUMBER_RE, (match) => {
		const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(match);
		const fraction = /^(\d+)\/(\d+)$/.exec(match);
		let value: number;
		if (mixed) value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
		else if (fraction) value = Number(fraction[1]) / Number(fraction[2]);
		else value = Number(match);
		if (!Number.isFinite(value) || value === 0) return match;
		return prettyAmount(value * factor) || match;
	});
};

/**
 * Which ingredients a step actually uses, by name match.
 *
 * Only used in cook mode, where the ingredient list is not on screen and the
 * step says "add the spices" without saying which. A miss costs nothing — the
 * line is simply not shown — so a cheap match beats asking a model for a
 * mapping and paying for it on every recipe.
 */
const stepIngredients = (step: Step, ingredients: Ingredient[]): Ingredient[] => {
	const text = (step.instruction ?? '').toLowerCase();
	if (!text) return [];
	return ingredients.filter((ing) => {
		const name = ing.item?.toLowerCase().replace(/\(.*?\)/g, '').trim();
		if (!name || name.length < 3) return false;
		// Match the head noun: "Fresh ginger" should hit "grate the ginger".
		const head = name.split(/\s+/).filter((w) => w.length > 2);
		return head.some((word) => text.includes(word));
	});
};

/**
 * Did the cook actually say any amounts out loud?
 *
 * This decides whether reading the frames is worth paying for. A reel that says
 * "200g pasta, two tablespoons of oil, one teaspoon of salt" has already given
 * up its quantities, and OCR-ing every frame adds cost without adding much. A
 * reel that says "add some cream and the usual spices" has not — and on those,
 * the numbers are almost always sitting in an on-screen overlay, which is
 * precisely what OCR is for.
 *
 * Counts amounts that carry a unit, so a stray "12 minutes" or "step 3" does
 * not read as a quantity. Three is the bar: one or two could be times.
 */
const AMOUNT_RE =
	/\b\d+(?:[.,/]\d+)?\s*(?:g|kg|ml|l|oz|lbs?|pounds?|cups?|tsp|tbsp|teaspoons?|tablespoons?|cloves?|pinch|handful|inch|cm)\b/gi;

const statesAmounts = (text: string): boolean => (text.match(AMOUNT_RE)?.length ?? 0) >= 3;

const errText = (err: unknown): string => {
	const msg = (err as Error)?.message ?? String(err);
	if (/already running/i.test(msg)) return 'That pipeline is already running — try again in a moment.';
	if (/not connected/i.test(msg)) return 'Still connecting to RocketRide. Give it a second and retry.';
	// An unresolved ${ROCKETRIDE_*} substitution is passed through as literal
	// text, so the model provider rejects it as a malformed key. That reads as
	// a generic 401 and looks like a broken app; it is a missing server-side
	// secret, and only the operator can fix it. Say so rather than showing the
	// raw upstream string.
	if (/\$\{ROCKETRIDE_|invalid[_ ]api[_ ]key|incorrect api key|unauthoriz|\b401\b/i.test(msg)) {
		return 'The model credential is not configured on this server, so the recipe step cannot run. Everything else in the app still works — saved recipes open normally.';
	}
	return msg || 'Something went wrong.';
};

/**
 * What to say while the user waits.
 *
 * "It has not stalled" is a claim about the run, so it may only be made while
 * the run is still inside the range a healthy one occupies. Past the point
 * where every stage should have finished or timed out, saying it anyway is
 * telling the user something we do not know to be true.
 */
const waitText = (elapsed: number): string => {
	if (elapsed <= 25) return '…';
	if (elapsed <= SLOW_SECONDS) return '. Reading a reel properly takes a while; it has not stalled.';
	return '. This is longer than a reel normally takes. It will stop on its own if nothing comes back — or start again with the caption box, which is quick.';
};

/**
 * The same account as waitText, written as a standalone sentence for the
 * cooking screen rather than as a clause tacked onto a banner.
 *
 * Null before 25 seconds: nothing has gone on long enough to need explaining,
 * and reassurance offered that early only plants the doubt it answers.
 */
const summarise = (r: Recipe, extra?: string): string =>
	[r.cuisine, r.servings ? `serves ${r.servings}` : null, r.totalMinutes ? `${r.totalMinutes} min` : null, extra]
		.filter(Boolean)
		.join('  ·  ');

// =============================================================================
// SHOPPING
// =============================================================================

/**
 * What to buy, derived rather than asked for.
 *
 * The fridge check has already worked out which ingredients are missing, and
 * the recipe already holds their quantities. Joining the two costs nothing and
 * returns instantly; sending it back to a model would spend five cents and
 * thirty seconds to reproduce two lists we are already holding.
 */
export interface ShoppingItem {
	/** Index into recipe.ingredients, so a tick here is the same tick as there. */
	index: number;
	item: string;
	quantity?: string;
	why?: string;
}

/** Loose match — the substitution names an ingredient in its own words, which
 *  is rarely character-for-character what the recipe called it. */
const sameIngredient = (a?: string, b?: string): boolean => {
	const norm = (v: string) => v.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z ]/g, '').trim();
	if (!a || !b) return false;
	const x = norm(a);
	const y = norm(b);
	if (!x || !y) return false;
	return x === y || x.includes(y) || y.includes(x);
};

/**
 * Where to send someone for a wonton wrapper.
 *
 * A general supermarket is the wrong answer for half the dishes this app
 * handles — the whole premise is people cooking the food they grew up eating,
 * and the ingredient they are missing is usually the one a general store does
 * not carry. So the search is aimed at the kind of shop that stocks it.
 *
 * This hands off to the maps app rather than pretending to know the nearest
 * store: no location is collected, nothing is claimed about hours, stock or
 * price, and the device answers "nearest" with information it already has.
 */
const STORE_HINTS: Array<[RegExp, string]> = [
	[/indian|desi|punjabi|south asian|gujarati|bengali|kerala|masala|paneer|tikka/i, 'Indian grocery store'],
	[/chinese|asian|japanese|korean|thai|vietnamese|dumpling|wonton|kimchi|miso|szechuan/i, 'Asian grocery store'],
	[/mexican|latin|taqueria|tortilla|masa/i, 'Mexican grocery store'],
	[/middle eastern|lebanese|turkish|persian|arab|sumac|tahini|kefta/i, 'Middle Eastern grocery store'],
	[/greek|mediterranean/i, 'Mediterranean grocery store'],
];

const storeQuery = (recipe: Recipe, items: ShoppingItem[]): string => {
	const hay = [recipe.cuisine, recipe.title, ...items.map((i) => i.item)].filter(Boolean).join(' ');
	for (const [re, q] of STORE_HINTS) if (re.test(hay)) return q;
	return 'grocery store';
};

const mapsUrl = (query: string): string =>
	`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

const SUB_VARIANT: Record<string, 'success' | 'warning' | 'error'> = {
	have: 'success',
	substitute: 'warning',
	missing: 'error',
};

// =============================================================================
// CONTENT
// =============================================================================

const Content: React.FC<ShellAppProps> = ({ isConnected }) => {
	const {
		prewarm,
		release,
		transcribe,
		readScreenText,
		describeFrames,
		extractRecipe,
		checkFridge,
		cookAlternative,
	} = usePipelines();
	const { appState, updateAppState, loaded } = useWorkspace() as {
		appState: { saved?: SavedRecipe[] } | undefined;
		updateAppState: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
		loaded: boolean;
	};

	const [view, setView] = useState<View>('welcome');
	const [sourceMode, setSourceMode] = useState<SourceMode>('link');
	const [busy, setBusy] = useState<string | null>(null);
	const [elapsed, setElapsed] = useState(0);
	/** Length of the reel being read, once the resolver has told us. Drives the
	 *  wait estimate, which is the difference between a slow run and a hung one
	 *  as far as the person watching is concerned. */
	const [reelSeconds, setReelSeconds] = useState<number | null>(null);
	/**
	 * Headline on the transition screen.
	 *
	 * The pan stands between every pair of steps, and each wait names its own
	 * work: reading a reel is "Cooking your recipe", checking a ticked list
	 * against the dish is "Making your list". One screen, one line changed.
	 */
	const [cookingTitle, setCookingTitle] = useState('Cooking your recipe');
	/**
	 * The shopping list, frozen at the moment the shop is entered.
	 *
	 * Ticking an item there marks it as owned, and owned items are exactly the
	 * ones that drop out of "what is missing" — so a live list would delete each
	 * row as it went into the basket. A shopping list that empties as you shop
	 * is not a shopping list.
	 */
	const [shopList, setShopList] = useState<ShoppingItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	/** A caveat about a result we did produce — distinct from a failure. */
	const [notice, setNotice] = useState<string | null>(null);
	const [recipe, setRecipe] = useState<Recipe | null>(null);
	const [pasted, setPasted] = useState('');
	const [fridge, setFridge] = useState('');
	const [sub, setSub] = useState<Substitution | null>(null);
	const [savedId, setSavedId] = useState<string | null>(null);

	// --- cooking progress ---------------------------------------------------
	// Lives here rather than in RecipeView because RecipeView unmounts when you
	// switch to cook mode, and losing your ticks on the way to the stove would
	// defeat the point of having them.
	const recipeKey = useMemo(
		() =>
			recipe
				? `${recipe.title ?? 'untitled'}|${recipe.steps?.length ?? 0}|${recipe.ingredients?.length ?? 0}`
				: '',
		[recipe],
	);
	const [scale, setScale] = useState(1);
	const [doneIng, setDoneIng] = useState<number[]>([]);
	/**
	 * What was ticked when the fridge check ran.
	 *
	 * The check is a snapshot. Tick something off in the shop and its answer is
	 * out of date the moment you do — it will still be telling you to knead the
	 * dough with yogurt because you have no water, ten seconds after you bought
	 * water. Knowing what it was computed against lets the screen drop the parts
	 * that no longer apply instead of making you spend another 79 seconds.
	 */
	const [checkedAgainst, setCheckedAgainst] = useState<number[] | null>(null);
	const [doneStep, setDoneStep] = useState<number[]>([]);

	// Progress belongs to the recipe, not the session: reopening the one you
	// were halfway through should not hand you a blank page. Keyed on the recipe
	// alone — appState changes on every save, and re-reading here on that would
	// fight the user's own taps.
	useEffect(() => {
		setScale(1);
		const store = (appState as { progress?: Record<string, { ing?: unknown; step?: unknown }> } | undefined)
			?.progress;
		const mine = recipeKey ? store?.[recipeKey] : undefined;
		const nums = (v: unknown): number[] =>
			Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];

		if (mine) {
			setDoneIng(nums(mine.ing));
			setDoneStep(nums(mine.step));
		} else {
			// Fresh recipe: start the pantry basics ticked. Only on first sight —
			// once there is stored progress it is the user's answer, and re-ticking
			// something they deliberately unticked would be the app arguing with
			// them about whether they own salt.
			//
			// A recipe written FOR their ingredients is the exception: it was built
			// from what they have, so every line is already in the kitchen. Making
			// them tick the list again would be asking a question we just answered
			// ourselves.
			const all = recipe?.ingredients ?? [];
			setDoneIng(
				recipe?.origin === 'kitchen'
					? all.map((_, i) => i)
					: all.map((ing, i) => (isPantryBasic(ing) ? i : -1)).filter((i) => i >= 0),
			);
			setDoneStep([]);
		}
		setCheckedAgainst(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [recipeKey]);

	const persistProgress = useCallback(
		(ing: number[], step: number[]) => {
			if (!recipeKey) return;
			updateAppState((prev) => ({
				...prev,
				progress: { ...((prev.progress as Record<string, unknown>) ?? {}), [recipeKey]: { ing, step } },
			}));
		},
		[recipeKey, updateAppState],
	);

	const toggleIng = useCallback(
		(i: number) =>
			setDoneIng((prev) => {
				const next = prev.includes(i) ? prev.filter((n) => n !== i) : [...prev, i];
				persistProgress(next, doneStep);
				return next;
			}),
		[doneStep, persistProgress],
	);

	const toggleStep = useCallback(
		(i: number) =>
			setDoneStep((prev) => {
				const next = prev.includes(i) ? prev.filter((n) => n !== i) : [...prev, i];
				persistProgress(doneIng, next);
				return next;
			}),
		[doneIng, persistProgress],
	);

	const go = useCallback((next: string) => {
		setError(null);
		setNotice(null);
		setView(next as View);
	}, []);

	// appState is persisted server-side and survives every session, so one bad
	// write would poison the app permanently. Trust nothing that comes back.
	const saved = useMemo<SavedRecipe[]>(() => {
		const raw = appState?.saved;
		if (!Array.isArray(raw)) return [];
		return raw.filter((sv): sv is SavedRecipe => !!sv && typeof sv === 'object' && !!sv.recipe);
	}, [appState]);

	// Extraction takes ~40s. Without a moving number people assume it has hung.
	useEffect(() => {
		if (!busy) {
			setElapsed(0);
			return;
		}
		const started = Date.now();
		const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
		return () => clearInterval(id);
	}, [busy]);

	// ------------------------------------------------------------ extraction

	// `busy` drives the banner, but state updates are async — two fast drops
	// can both pass a `busy` check before either render lands. A ref closes
	// that window, which matters here because each duplicate run costs money.
	const inFlight = useRef(false);

	// Closing the app or navigating away mid-download should stop the transfer,
	// not leave it running against a component that no longer exists.
	const abortRef = useRef<AbortController | null>(null);
	useEffect(() => () => abortRef.current?.abort(), []);

	/**
	 * Download the resolved video, and re-resolve exactly once if the CDN link
	 * has already expired. Signed Instagram URLs are short-lived, so this is a
	 * routine case rather than an error — but one retry only, never a loop.
	 */
	const fetchWithOneRetry = useCallback(async (source: MediaSource, rawLink: string): Promise<File> => {
		try {
			return await fetchMediaAsFile(source, abortRef.current?.signal);
		} catch (err) {
			if (!(err instanceof ResolveError) || !err.retryable) throw err;
			// Only an expiry is worth announcing as one. Re-resolving costs an
			// actor run and several seconds, so do not tell the user their link
			// expired when the real failure was something else entirely.
			setBusy(
				err.code === 'media-expired'
					? 'That video link had expired — fetching a fresh one'
					: 'Retrying that download',
			);
			const again = await resolveMediaSource(rawLink);
			if (again.kind !== 'media') throw err;
			// Surface the FIRST failure if the retry fails too: the second error
			// is a symptom of the same cause, and the first one is the honest
			// description of what went wrong.
			try {
				return await fetchMediaAsFile(again.source, abortRef.current?.signal);
			} catch (retryErr) {
				throw retryErr instanceof ResolveError && retryErr.code !== err.code ? retryErr : err;
			}
		}
	}, []);

	const runExtract = useCallback(
		async (payload: { file?: File; text?: string; link?: string; seconds?: number | null }) => {
			if (inFlight.current) return;
			inFlight.current = true;
			abortRef.current = new AbortController();
			setError(null);
			setNotice(null);
			setSub(null);
			// A dropped file already knows its own length; a link learns it from
			// the resolver a few seconds from now.
			setReelSeconds(payload.seconds ?? null);
			setCookingTitle('Cooking your recipe');
			// Hand the screen over for the duration. Every caller of this is on
			// the ingest form, and leaving them there greys out the only control
			// on the page for two minutes; the wait deserves a screen of its own.
			setView('cooking');
			try {
				let transcript = payload.text ?? '';
				let screenText: string | undefined;
				let scenes: string | undefined;
				let file = payload.file;
				let caption: string | undefined;

				// Starting a pipeline task costs 8-11 seconds of orchestration
				// before any work begins, and this run used to pay them one after
				// another with the network idle. Start the ones this run is
				// certain to need now, so they warm up alongside the resolve and
				// the download instead of after them.
				//
				// `detectPlatform` is a synchronous URL check, so this costs
				// nothing to decide: an Instagram link is the video path and will
				// reach the transcribe task; TikTok and YouTube only ever come
				// back as text and must NOT warm it. Nothing here warms
				// screentext or vision — those are the escalated rungs, and a
				// task bills while alive whether or not it is ever climbed.
				const platform = payload.link ? detectPlatform(payload.link) : undefined;
				if (platform === 'instagram') prewarm('transcribe');
				else if (!payload.file) prewarm('ask');

				if (payload.link) {
					setBusy('Checking the link');
					const outcome = await resolveMediaSource(payload.link);

					if (outcome.kind === 'unsupported') {
						throw new ResolveError('invalid-url', outcome.message);
					}

					if (outcome.kind === 'text') {
						// The video path was predicted from the host and did not
						// happen: this reel came back as a caption. Hand the warmed
						// task back rather than paying out its idle ttl, and warm
						// the rung this run will actually reach instead.
						if (platform === 'instagram') {
							release('transcribe');
							prewarm('ask');
						}

						// A caption or title — usable, but nothing was watched or
						// heard. Say so rather than letting it pass as a full read.
						transcript = outcome.text;

						// Below the evidence bar there is no recipe in here to find.
						// A YouTube title is about thirty characters, and running
						// extraction on it costs a model call and half a minute to
						// arrive at a page that says nothing could be read — after
						// asserting a cuisine, a serving count and a total time that
						// came from nowhere. Stop at the ingest screen instead, where
						// the two things that DO work are one action away.
						if (transcript.trim().length < THIN_EVIDENCE_CHARS) {
							// The warmed ask task is deliberately NOT released here.
							// This message sends the reader to the paste box, and
							// what they paste needs that same task within seconds —
							// giving it back now just buys another cold start.
							throw new ResolveError(
								'no-media',
								outcome.source.platform === 'youtube'
									? 'YouTube only hands over the video title — “' +
											transcript.trim() +
											'” — and never the description, which is where the recipe is. Open the video, copy the description into the box below, or save the video and drop it in.'
									: 'That link only gave a few words, not enough to build a recipe from. Paste the caption into the box below, or drop the video in.',
							);
						}

						if (outcome.thin) {
							setNotice(
								'That link gave only a short caption, not a full recipe. Expect a rough result — ' +
									'pasting the full caption or dropping the video in gives a much better one.',
							);
						} else if (outcome.source.warnings.length) {
							// The resolver knows what it could not see — YouTube gives the
							// spoken track but no frames, so a quantity that only ever
							// appeared in an overlay is missing. That caveat was being
							// computed and thrown away; the reader needs it to know which
							// parts of the recipe to double-check.
							setNotice(outcome.source.warnings.join(' '));
						}
					} else {
						const length = outcome.source.durationSeconds ?? null;

						// Refused HERE, in the gap between knowing the length and
						// spending anything on it. The resolve that produced this
						// number costs no platform credits; the download and every
						// stage after it do.
						if (length && length > MAX_REEL_SECONDS) {
							release('transcribe');
							throw new ResolveError('not-a-post', tooLongMessage(length));
						}

						setBusy('Retrieving the video');
						// Say how long this will take before it takes it.
						setReelSeconds(length);
						caption = outcome.source.caption;
						try {
							file = await fetchWithOneRetry(outcome.source, payload.link);
						} catch (err) {
							// The video is gone, but the resolver already handed us the
							// post caption — and on a recipe post that is very often the
							// entire recipe in text. Dead-ending here while holding the
							// answer is the worst outcome available.
							//
							// Only fall back when the caption is substantial: a
							// three-word caption produces a worse recipe than an honest
							// error, and pretending otherwise wastes a model call.
							const usable = caption?.trim() ?? '';
							if (usable.length < THIN_EVIDENCE_CHARS) throw err;

							transcript = usable;
							caption = undefined; // now the primary source, not corroboration
							setNotice(
								`${errText(err)} Built this from the post caption instead — it is often the ` +
									'full recipe, but nothing spoken or shown only on screen made it in. ' +
									'For the complete version, save the video and drop it in below.',
							);
						}
					}
				}

				if (file) {
					// The ask task is deliberately NOT warmed here, though every
					// path through this block ends in an extraction.
					//
					// Warming it hides an 8-second cold start behind the audio —
					// but only when nothing else follows. On a reel that escalates
					// to the on-screen-text rung, extraction is more than TASK_TTL
					// away, so the warmed task is reaped for idleness before it is
					// ever used: the run pays three minutes of idle billing AND
					// still eats the cold start. Measured on a 62-second reel,
					// where the OCR stage alone outlasts the ttl.
					//
					// Eight seconds of a four-minute run is not worth that trade.
					// transcribe is still warmed at the top, where the wait it
					// hides behind is bounded by the resolve and the download.
					setBusy('Listening to the reel');
					const heard = await transcribe(file);
					transcript = heard.transcript;
					screenText = heard.screenText;

					// Reading the frames is about half the cost of a video run, and
					// on a reel where the cook says every amount out loud it buys
					// almost nothing. So it is escalated on two conditions: the reel
					// barely spoke, or it spoke without ever naming an amount — which
					// is exactly when the quantities are living in an overlay.
					if (transcript.length < THIN_EVIDENCE_CHARS || !statesAmounts(transcript)) {
						setBusy('Reading the text on screen');
						screenText = await readScreenText(file);
					}

					// Vision is the expensive stage, so escalate only when the
					// reel genuinely said nothing — silent, captionless, fast cuts.
					const words = transcript.length + screenText.length;
					if (words < THIN_EVIDENCE_CHARS) {
						setBusy('No words in this reel — watching the cooking actions');
						scenes = await describeFrames(file);
						if (!scenes) {
							throw new Error(
								'Nothing could be read from that video — no speech, no on-screen text, no usable frames. Try pasting the caption instead.',
							);
						}
					}
					// The caption is evidence, never the authority — the video wins.
					if (caption) {
						screenText = [screenText, `POST CAPTION (secondary to the video):\n${caption}`]
							.filter(Boolean)
							.join('\n\n');
					}
				}

				setBusy(
					transcript.trim() || screenText?.trim()
						? 'Building your recipe'
						: 'No words in this reel — building the recipe from what the frames show',
				);
				// Describing a dish and reading a reel are different jobs, and the
				// prompt has to know which one it is being asked to do.
				const describedByUser = !payload.link && !payload.file && sourceMode === 'describe';
				const parsed = await extractRecipe(
					transcript,
					screenText,
					scenes,
					describedByUser ? 'described' : 'reel',
				);

				// A recipe with neither ingredients nor steps is not a recipe, and
				// the recipe view is the wrong place to say so: it offers "Start
				// cooking" on nothing to cook, "Save to my book" on an empty shell,
				// and a fridge box that would spend another model call comparing
				// your kitchen against no ingredients. The model is instructed not
				// to produce this, but model output is data rather than a contract,
				// so the UI must not depend on it having complied.
				const hasBody = Boolean(parsed.ingredients?.length) || Boolean(parsed.steps?.length);
				if (!hasBody) {
					const why = parsed.missingInfo?.length
						? ` Here is what was missing: ${parsed.missingInfo.slice(0, 3).join(' ')}`
						: '';
					throw new Error(
						`There was not enough in that ${payload.link ? 'link' : payload.file ? 'video' : 'text'} to build a recipe from.${why} Paste the recipe text below, or drop the video in.`,
					);
				}

				setRecipe({ ...parsed, origin: describedByUser ? 'described' : 'reel' });
				setSavedId(null);
				// Straight to "what have you got" rather than the method. The
				// method is the last question, not the first.
				setView('ingredients');
			} catch (err) {
				setError(errText(err));
				// Back to the form, because every one of these errors ends in
				// "paste the caption" or "drop the video in" — and the thing it
				// names has to be on screen under the message that names it.
				setView('ingest');
			} finally {
				inFlight.current = false;
				setBusy(null);
			}
		},
		[describeFrames, extractRecipe, prewarm, readScreenText, release, sourceMode, transcribe],
	);

	/** DropZone never filters by type — the host validates. Do it before the
	 *  upload so a mis-drop fails instantly instead of after a long transfer. */
	const onFiles = useCallback(
		async (files: FileList) => {
			if (inFlight.current) {
				setError('Still working on the last one — give it a moment.');
				return;
			}
			const file = Array.from(files)[0];
			if (!file) return;
			if (!VIDEO_RE.test(file.name) && !file.type.startsWith('video/')) {
				setError(`"${file.name}" is not a video. Drop the reel itself, or paste its caption below.`);
				return;
			}
			if (file.size > MAX_VIDEO_BYTES) {
				setError(`That file is ${Math.round(file.size / 1e6)} MB — too big for a reel. Trim it first.`);
				return;
			}

			// The same competition cap the link path applies, read off the file
			// itself. Takes a moment and no network, and it happens before the
			// upload rather than after — which is the entire point of it.
			const length = await readVideoSeconds(file);
			if (length && length > MAX_REEL_SECONDS) {
				setError(tooLongMessage(length));
				return;
			}
			// Handed to the run rather than set here: runExtract clears this on
			// entry, so anything set before the call is wiped by it.
			void runExtract({ file, seconds: length });
		},
		[runExtract],
	);

	// ---------------------------------------------------------- substitution

	/**
	 * What is not ticked, ready to be shopped for.
	 *
	 * Derived, never asked for: the recipe already holds the amounts and the
	 * ticks already say what is missing, so joining them costs nothing. If a
	 * substitution has been run it contributes a swap note, but it is not
	 * required — the grocery road never runs one.
	 */
	const missingItems = useMemo<ShoppingItem[]>(() => {
		const all = recipe?.ingredients ?? [];
		return all
			.map((ing, index) => ({ ing, index }))
			.filter(({ ing, index }) => !doneIng.includes(index) && ing.item?.trim())
			.map(({ ing, index }) => {
				const swap = sub?.lines?.find(
					(ln) => ln.status === 'substitute' && sameIngredient(ln.item, ing.item),
				)?.useInstead;
				return {
					index,
					item: ing.item!.trim(),
					quantity: ing.quantity ? scaleQuantity(ing.quantity, scale) : undefined,
					why: swap ? `Or swap: ${swap}` : undefined,
				};
			});
	}, [doneIng, recipe, scale, sub]);

	/**
	 * The fork out of the menu.
	 *
	 * Nothing missing means there is nothing to ask a model — no substitution
	 * to work out, no list to build — so that branch costs nothing, waits for
	 * nothing, and goes straight to the good news. Anything missing goes to the
	 * choice, and the model is only troubled if they choose to improvise.
	 *
	 * This is why neither branch shows a transition screen: there is no work
	 * behind either of them to wait for.
	 */
	const onMakeList = useCallback(() => {
		if (!recipe) return;
		const total = (recipe.ingredients ?? []).length;
		setError(null);
		setView(doneIng.length >= total ? 'celebrate' : 'fork');
	}, [doneIng.length, recipe]);

	const runSubstitute = useCallback(async () => {
		// The ticks are the answer now, so an empty free-text box is fine — but
		// having ticked nothing at all is not an answer, it is an unanswered form.
		if (!recipe || inFlight.current || doneIng.length === 0) return;
		inFlight.current = true;
		setError(null);
		setBusy('Checking what you can swap');

		// Chosen from the fork, this is a step change like any other, so it gets
		// a screen — the pan, not the pot. This road keeps the dish and changes
		// what goes in it; the pot is for the road where the dish itself is
		// abandoned. Re-running it from the verdict screen keeps the banner:
		// there the reader is mid-page with something to look at, and taking the
		// screen away would be the intrusion, not the courtesy.
		const fromFork = view === 'fork';
		if (fromFork) {
			setCookingTitle('Working out your swaps');
			setReelSeconds(null);
			setView('adjusting');
		}

		try {
			const all = recipe.ingredients ?? [];
			const named = (list: Ingredient[]) =>
				list.map((i) => (i.item ?? '').trim()).filter(Boolean);
			const answer = await checkFridge(
					recipe,
					fridge,
				named(all.filter((_, i) => doneIng.includes(i))),
				named(all.filter((_, i) => !doneIng.includes(i))),
			);
			setSub(answer);
			setCheckedAgainst(doneIng);
			setView('verdict');
		} catch (err) {
			setError(errText(err));
			// Back to the choice they came from, with the error above it — never
			// stranded on a transition screen for work that has stopped. The
			// other road out of that screen still works.
			if (fromFork) setView('fork');
		} finally {
			inFlight.current = false;
			setBusy(null);
		}
	}, [checkFridge, doneIng, fridge, recipe, view]);

	/**
	 * Cook the fallback the substitution named instead.
	 *
	 * When the dish is impossible tonight, the app already works out what they
	 * COULD make — and then left them holding a sentence with nothing to press.
	 * This turns that sentence into a recipe.
	 *
	 * It replaces the recipe on screen, so it clears the substitution with it:
	 * those swap lines were computed against the dish being navigated away from,
	 * and leaving them under a different recipe would attach them to the wrong
	 * one. savedId clears too — this is a new recipe, not an edit of a saved one.
	 */
	const runCookAlternative = useCallback(async () => {
		// The ticked ingredients ARE a pantry, and usually a better one than the
		// optional box: nine confirmed items beat a sentence nobody bothered to
		// write. Both go in.
		const ticked = (recipe?.ingredients ?? [])
			.filter((_, i) => doneIng.includes(i))
			.map((ing) => [ing.item, ing.quantity].filter(Boolean).join(' — '))
			.filter(Boolean);
		const pantry = [ticked.join('\n'), fridge.trim()].filter(Boolean).join('\n');

		// A suggestion when the fridge check made one; otherwise the prompt picks
		// a dish itself. Either way this is answerable — which is why the button
		// no longer waits on the model having volunteered an alternative.
		const dish = sub?.alternative?.trim() ?? '';
		if (!pantry || inFlight.current) return;
		inFlight.current = true;
		setError(null);
		setNotice(null);
		setBusy(dish ? 'Writing that recipe for what you have' : 'Finding something you can make tonight');

		// The pot belongs to THIS road: the dish is being abandoned and what
		// comes back is genuinely unknown until it arrives. Reached from the
		// verdict screen instead, it keeps the banner.
		const fromFork = view === 'fork';
		if (fromFork) setView('improvising');

		try {
			const parsed = await cookAlternative(dish, pantry);
			if (!parsed.ingredients?.length && !parsed.steps?.length) {
					throw new Error(
					'Nothing could be built from that. Tick a few more ingredients, or add what else is in your kitchen.',
				);
			}
			setRecipe({ ...parsed, origin: 'kitchen' });
			setSub(null);
			setSavedId(null);
			setDoneIng([]);
			setNotice(
				'This one is not from a video — it was written for what you said is in your kitchen. ' +
					'Every quantity is an estimate.',
			);
			// Straight past the tick step — it is made of things they told us they
			// have — but not straight past the verdict, which is the screen that
			// says so. Skipping it dropped the user onto a recipe with no
			// acknowledgement that the problem they came with had been solved.
			setView('verdict');
		} catch (err) {
			setError(errText(err));
			// Never stranded on the pot for work that has stopped; the other two
			// roads off that screen still work.
			if (fromFork) setView('fork');
		} finally {
			inFlight.current = false;
			setBusy(null);
		}
	}, [cookAlternative, doneIng, fridge, recipe, sub, view]);

	// ----------------------------------------------------------- recipe book

	const saveRecipe = useCallback(() => {
		// Saving before the workspace has loaded would write on top of seeded
		// defaults and lose whatever is already persisted.
		if (!recipe || !loaded) return;
		const entry: SavedRecipe = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			savedAt: Date.now(),
			cookedCount: 0,
			recipe,
		};
		updateAppState((prev) => {
			const existing = Array.isArray(prev.saved) ? (prev.saved as SavedRecipe[]) : [];
			return { ...prev, saved: [entry, ...existing].slice(0, 100) };
		});
		setSavedId(entry.id);
	}, [loaded, recipe, updateAppState]);

	/**
	 * How many dishes this person has actually cooked, not how many they saved.
	 * cookedCount existed on SavedRecipe from the start and was never once
	 * incremented — finishing a cook is the only event that should touch it.
	 */
	const cooksSoFar = useMemo(
		() => saved.reduce((n, sv) => n + (Number(sv.cookedCount) || 0), 0),
		[saved],
	);

	const deleteRecipe = useCallback(
		(id: string) => {
			updateAppState((prev) => {
				const existing = Array.isArray(prev.saved) ? (prev.saved as SavedRecipe[]) : [];
				return { ...prev, saved: existing.filter((sv) => sv.id !== id) };
			});
			// If the open recipe was the one deleted, it is no longer saved — leave
			// it on screen but stop claiming it lives in the book.
			setSavedId((cur) => (cur === id ? null : cur));
		},
		[updateAppState],
	);

	const finishCooking = useCallback(() => {
		if (savedId) {
			updateAppState((prev) => {
				const existing = Array.isArray(prev.saved) ? (prev.saved as SavedRecipe[]) : [];
				return {
					...prev,
					saved: existing.map((sv) =>
						sv.id === savedId ? { ...sv, cookedCount: (Number(sv.cookedCount) || 0) + 1 } : sv,
					),
				};
			});
		}
		setView('done');
	}, [savedId, updateAppState]);

	const alreadySaved = !!savedId && saved.some((sv) => sv.id === savedId);

	// -------------------------------------------------------------- rendering

	const menu = {
		entries: [
			{ id: 'welcome', label: 'New recipe' },
			{ id: 'recipe', label: 'Recipe' },
			{ id: 'cook', label: 'Cook' },
			{ id: 'book', label: 'My book', count: saved.length || undefined },
		],
	};

	return (
		<div style={s.scroll} className="rx-page">
			<div style={s.page}>
				<div style={s.sticky}>
					<TabControl menu={menu} activeId={view} onSelect={go} />
				</div>

				<ContentHeader
					title="Recipe Rescue"
					subtitle="Turn a cooking reel into something you can actually follow."
				/>

				<div style={{ marginTop: 14, ...s.stack }}>
					{!isConnected && <Banner variant="warning">Connecting to RocketRide…</Banner>}
					{error && <Banner variant="error">{error}</Banner>}
					{notice && !busy && <Banner variant="warning">{notice}</Banner>}
					{/* The cooking screen states its own stage and second count, so
					    the banner would be saying it twice. Substitution and the
					    alternative dish still run behind the verdict screen, and
					    those keep the banner. */}
					{busy && view !== 'cooking' && view !== 'adjusting' && view !== 'improvising' && (
						<Banner variant={elapsed > SLOW_SECONDS ? 'warning' : 'info'}>
							{busy} — {elapsed}s{waitText(elapsed)}
						</Banner>
					)}

					<StepPips view={view} />

					{view === 'welcome' && (
						<WelcomeScreen
							savedCount={saved.length}
							onStart={() => setView('source')}
							onBook={() => setView('book')}
						/>
					)}

					{view === 'source' && (
						<SourceView
							onPick={(mode) => {
								setSourceMode(mode);
								setView('ingest');
							}}
						/>
					)}

					{view === 'ingest' && (
						<IngestView
							mode={sourceMode}
							onBack={() => setView('source')}
							busy={!!busy}
							pasted={pasted}
							setPasted={setPasted}
							onFiles={onFiles}
							onPaste={() => void runExtract({ text: pasted.trim() })}
							onLink={(link) => void runExtract({ link })}
						/>
					)}

					{view === 'cooking' && (
						<CookingScreen
							title={cookingTitle}
							stage={busy ?? 'Getting started'}
							elapsed={elapsed}
							seconds={reelSeconds}
						/>
					)}

					{view === 'ingredients' && recipe && (
						<section className="rx-menu rx-in">
							<div className="rx-menu-head">
								<hr className="rx-menu-rule is-double" />
								<p className="rx-menu-kicker" style={{ marginTop: 14 }}>
									What this needs
								</p>
								<h2>{recipe.title || 'Your recipe'}</h2>
								<hr className="rx-menu-rule" />
							</div>

							<p className="rx-menu-sub" style={{ textAlign: 'center' }}>
								Tick everything you already have. Salt, oil and water are ticked for you —
								untick them if you have actually run out. What stays unticked becomes your
								shopping list.
							</p>

							<IngredientList
								ingredients={recipe.ingredients ?? []}
								grouped={groupIngredients(recipe.ingredients ?? [])}
								servings={recipe.servings}
								doneIng={doneIng}
								onToggleIng={toggleIng}
								scale={scale}
								onScale={setScale}
								mostlyEstimated={
									(recipe.ingredients ?? []).filter((i) => i.inferred).length /
										Math.max(1, (recipe.ingredients ?? []).length) >=
									MOSTLY_ESTIMATED
								}
							/>

							<div className="rx-menu-foot" style={{ ...s.row, justifyContent: 'center' }}>
								<Button disabled={!!busy || doneIng.length === 0} onClick={onMakeList}>
									{doneIng.length === 0 ? 'Tick what you have' : 'Make my list'}
								</Button>
							</div>
						</section>
					)}

					{view === 'celebrate' && recipe && (
						<CelebrateScreen
							title={recipe.title}
							count={doneIng.length}
							onShowRecipe={() => setView('recipe')}
						/>
					)}

					{view === 'fork' && recipe && (
						<ForkScreen
							missingCount={(recipe.ingredients ?? []).length - doneIng.length}
							missingNames={missingItems.map((m) => m.item)}
							busy={!!busy}
							onShop={() => {
								// Snapshot before entering, not while inside it.
								setShopList(missingItems);
								setView('grocery');
							}}
							onAdjust={() => void runSubstitute()}
							onImprovise={() => void runCookAlternative()}
						/>
					)}

					{view === 'adjusting' && (
						<CookingScreen
							title={cookingTitle}
							stage={busy ?? 'Checking what you can swap'}
							elapsed={elapsed}
							seconds={null}
						/>
					)}

					{view === 'improvising' && (
						<PotScreen stage={busy ?? 'Working out what you can make'} elapsed={elapsed} />
					)}

					{view === 'grocery' && recipe && (
						<GroceryScreen
							items={shopList}
							doneIng={doneIng}
							onToggle={toggleIng}
							storeKind={storeQuery(recipe, shopList)}
							storeUrl={mapsUrl(storeQuery(recipe, shopList))}
							onBack={() => setView('fork')}
							// Walking out of the shop with everything is the same state the
							// menu would have produced, so it lands in the same place.
							onDone={() => setView('celebrate')}
							onShowRecipe={() => setView('recipe')}
						/>
					)}

					{view === 'verdict' && recipe && (
						<VerdictView
							missingCount={(recipe.ingredients ?? []).length - doneIng.length}
							verdict={sub?.verdict}
							onShowRecipe={() => setView('recipe')}
						>
							<RecipeView
								recipe={recipe}
								fridge={fridge}
								setFridge={setFridge}
								sub={sub}
								busy={!!busy}
								onSubstitute={() => void runSubstitute()}
								onCookAlternative={() => void runCookAlternative()}
								doneIng={doneIng}
								doneStep={doneStep}
								onToggleIng={toggleIng}
								onToggleStep={toggleStep}
								scale={scale}
								onScale={setScale}
								checkedAgainst={checkedAgainst}
								onSave={saveRecipe}
								isSaved={!!savedId}
								canSave={loaded}
								onCook={() => setView('cook')}
								stage="verdict"
								onContinue={() => setView('recipe')}
							/>
						</VerdictView>
					)}

					{view === 'recipe' &&
						(recipe ? (
							<RecipeView
								recipe={recipe}
								fridge={fridge}
								setFridge={setFridge}
								sub={sub}
								busy={!!busy}
								onSubstitute={() => void runSubstitute()}
							onCookAlternative={() => void runCookAlternative()}
							doneIng={doneIng}
							doneStep={doneStep}
							onToggleIng={toggleIng}
							onToggleStep={toggleStep}
							scale={scale}
							onScale={setScale}
							checkedAgainst={checkedAgainst}
								onSave={saveRecipe}
								isSaved={alreadySaved}
								canSave={loaded}
								onCook={() => go('cook')}
							/>
						) : (
							<EmptyState
								title="No recipe yet"
								description="Drop a reel or paste a caption and it will appear here."
								action={<Button onClick={() => go('ingest')}>Start one</Button>}
							/>
						))}

					{view === 'cook' &&
						(recipe?.steps?.length ? (
							<CookView
								recipe={recipe}
								doneStep={doneStep}
								onToggleStep={toggleStep}
								onFinish={finishCooking}
							/>
						) : (
							<EmptyState title="Nothing to cook yet" description="Build a recipe first." />
						))}

					{view === 'done' && (
						<DoneView
							title={recipe?.title}
							first={cooksSoFar <= 1}
							isSaved={!!savedId}
							canSave={loaded}
							// The improvised road ends here too, and the sentence should
							// know which road it was: cooking the dish you set out to cook
							// and rescuing dinner from what was in the fridge are not the
							// same achievement, and only one of them is worth naming.
							improvised={recipe?.origin === 'kitchen'}
							onSave={saveRecipe}
							onBook={() => go('book')}
							onAnother={() => {
								setRecipe(null);
								setSub(null);
								setSavedId(null);
								go('welcome');
							}}
						/>
					)}

					{view === 'book' && (
						<BookView
							loaded={loaded}
							saved={saved}
							onOpen={(sv) => {
								setRecipe(sv.recipe);
								setSavedId(sv.id);
								setSub(null);
								go('recipe');
							}}
							onStart={() => go('source')}
							onDelete={deleteRecipe}
						/>
					)}
				</div>
			</div>
		</div>
	);
};

// =============================================================================
// INGEST
// =============================================================================

const IngestView: React.FC<{
	/** Which half of this screen the user asked for on the previous one. */
	mode: SourceMode;
	busy: boolean;
	pasted: string;
	setPasted: (v: string) => void;
	onFiles: (files: FileList) => void;
	onPaste: () => void;
	onLink: (link: string) => void;
	onBack: () => void;
}> = ({ mode, busy, pasted, setPasted, onFiles, onPaste, onLink, onBack }) => {
	const [link, setLink] = useState('');
	const submitLink = () => {
		if (link.trim()) onLink(link.trim());
	};

	// Making someone choose the right box before they paste is friction for no
	// reason — we can tell a link from recipe text ourselves.
	const pastedIsLink = looksLikeLink(pasted);

	return (
		<div style={s.stack} className="rx-in">
			<div>
				<Button variant="secondary" small onClick={onBack}>
					Back
				</Button>
			</div>

			{mode === 'link' && (
				<>
			<Card header="Paste a cooking video or recipe link">
				<p style={{ ...s.muted, marginTop: 0 }}>
					Verified for {verifiedProviders().join(', ')}. Anything else — paste the recipe
					text below, or drop the video file in.
				</p>
				<p style={{ ...s.muted, marginTop: 0 }}>
					Reels of <strong>{SUGGESTED_REEL_RANGE}</strong> work best, and during the
					competition anything over {MAX_REEL_SECONDS} seconds is turned away — reading a
					video costs credits for every second of it.
				</p>
				<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
					<input
						style={{ ...s.textarea, minHeight: 0, flex: '1 1 22rem', padding: '10px 12px' }}
						value={link}
						placeholder="https://www.instagram.com/reel/… or a TikTok link"
						onChange={(e) => setLink(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') submitLink();
						}}
					/>
					<Button disabled={busy || !link.trim()} onClick={submitLink}>
						Get the recipe
					</Button>
				</div>
			</Card>

			<DropZone
				title="Or drop the video here"
				hint={`One at a time — MP4, MOV or WEBM, up to ${MAX_REEL_SECONDS} seconds. Works even when the reel has no words at all.`}
				onFiles={onFiles}
			/>
				</>
			)}

			{mode === 'describe' && (
			<Card header="Tell me what you want to make">
				<p style={{ ...s.muted, marginTop: 0 }}>
					Describe the dish, or paste a caption or your own notes. The more you tell me, the
					less I have to guess — but a name and a few lines is enough to start.
				</p>
				<textarea
					style={s.textarea}
					value={pasted}
					placeholder="Paste the recipe caption, a voice note transcript, or your own notes…"
					onChange={(e) => setPasted(e.target.value)}
				/>
				<div style={{ marginTop: 12, ...s.row }}>
					<Button
						disabled={busy || (!pastedIsLink && pasted.trim().length < 20)}
						onClick={() => (pastedIsLink ? onLink(pasted.trim()) : onPaste())}
					>
						{pastedIsLink ? 'Get the recipe from that link' : 'Build the recipe'}
					</Button>
					{pastedIsLink && <span style={s.meta}>That is a link — I will fetch it.</span>}
				</div>
			</Card>
			)}
		</div>
	);
};

// =============================================================================
// RECIPE
// =============================================================================

// =============================================================================
// THE GUIDED FLOW
//
// One question per screen, in the order someone actually decides: what am I
// cooking, do I have it, what do I do about what I am missing, and only then
// how is it made. The method used to be the first thing on screen and the
// decision the last, which is backwards — nobody needs step seven while
// working out whether tonight is even possible.
// =============================================================================

const STEP_ORDER: View[] = ['source', 'ingest', 'ingredients', 'verdict', 'recipe'];

const StepPips: React.FC<{ view: View }> = ({ view }) => {
	const at = STEP_ORDER.indexOf(view);
	if (at < 0) return null;
	return (
		<div className="rx-steps">
			{STEP_ORDER.map((_, i) => (
				<span key={i} className={`rx-pip${i === at ? ' is-on' : i < at ? ' is-past' : ''}`} />
			))}
		</div>
	);
};

const SourceView: React.FC<{ onPick: (mode: SourceMode) => void }> = ({ onPick }) => (
	<div className="rx-in">
		<div className="rx-hero" style={{ paddingBottom: 22 }}>
			<h1 style={{ fontSize: 24 }}>What are we making?</h1>
			<p style={{ marginBottom: 0 }}>Two ways in. Both end up in the same place.</p>
		</div>
		<div className="rx-choices">
			<button type="button" className="rx-choice" onClick={() => onPick('link')}>
				<b>I have a link</b>
				<span>
					Paste a reel from Instagram, TikTok or YouTube — or drop the video file straight in.
					This is the one that reads what the cook actually did.
				</span>
			</button>
			<button type="button" className="rx-choice" onClick={() => onPick('describe')}>
				<b>Let me describe it</b>
				<span>
					Tell me the dish, or paste a caption or your own notes. Good for the thing your mum
					makes that was never filmed.
				</span>
			</button>
		</div>
	</div>
);

const VerdictView: React.FC<{
	missingCount: number;
	verdict?: string;
	onShowRecipe: () => void;
	children?: React.ReactNode;
}> = ({ missingCount, verdict, onShowRecipe, children }) => (
	<div className="rx-in">
		<div className="rx-verdict">
			<h2>
				{missingCount === 0
					? 'Woohoo — you have everything'
					: `Looks like you are missing ${missingCount} thing${missingCount > 1 ? 's' : ''}`}
			</h2>
			<p>
				{verdict ||
					(missingCount === 0
						? 'Nothing stands between you and dinner. Here is how it is made.'
						: 'Two ways forward. Neither of them is giving up.')}
			</p>
			{missingCount === 0 && (
				<div style={{ ...s.row, justifyContent: 'center', marginTop: 20 }}>
					<Button onClick={onShowRecipe}>Show me the recipe</Button>
				</div>
			)}
		</div>
		{children}
	</div>
);

/**
 * The end of a cook.
 *
 * Marking the last step done used to do nothing at all — the advance was
 * guarded against running past the end, and there was nothing on the other
 * side of it. Finishing a dish is the moment this whole app exists for, and it
 * is also the only honest moment to ask someone to keep the recipe: they know
 * now whether it was any good.
 */
/**
 * How it turned out, in the only three answers anyone actually gives.
 *
 * Asked here because here is the only place the answer exists. Before the
 * cooking it would be a guess; on the recipe screen it would be a rating of a
 * document. Standing over the finished pan, it is a fact.
 *
 * It is also the one honest reason to press save: "keep it" means something
 * different when you already know it worked.
 */
const VERDICTS: Array<{ id: string; label: string; line: string }> = [
	{
		id: 'nailed',
		label: 'Nailed it',
		line: 'Then it is worth keeping — that is the whole point of a cookbook.',
	},
	{
		id: 'close',
		label: 'Close enough',
		line: 'Close enough is how every dish starts. The second time is always better, and you will have the amounts.',
	},
	{
		id: 'off',
		label: 'Not quite',
		line: 'Worth keeping anyway. Knowing which step went sideways is most of what you need for the next attempt.',
	},
];

const DoneView: React.FC<{
	title?: string;
	first: boolean;
	isSaved: boolean;
	canSave: boolean;
	/** True when this dish was built from what was in the kitchen, not a reel. */
	improvised: boolean;
	onSave: () => void;
	onBook: () => void;
	onAnother: () => void;
}> = ({ title, first, isSaved, canSave, improvised, onSave, onBook, onAnother }) => {
	const [rated, setRated] = useState<string | null>(null);
	const chosen = VERDICTS.find((v) => v.id === rated);

	return (
		<div className="rx-finish rx-in">
			<svg
				className="rx-scene"
				style={{ maxWidth: 230 }}
				viewBox="0 0 300 190"
				role="img"
				aria-label="A finished dish"
			>
				{/* The same burst as the celebration screen, because this is the
				    same feeling arriving for the second and better reason. */}
				<g>
					{[
						[-70, -44, 60, 3.5],
						[-40, -70, 0, 2.5],
						[-8, -82, 120, 4],
						[28, -74, 40, 3],
						[60, -54, 150, 3.5],
						[84, -24, 90, 2.5],
						[-86, -8, 180, 3],
					].map(([x, y, d, r], i) => (
						<circle
							key={i}
							className="rx-spark"
							cx="150"
							cy="112"
							r={r}
							fill={i % 3 === 0 ? 'var(--rx-gold)' : 'var(--rx-gold-soft)'}
							style={{ '--bx': `${x}px`, '--by': `${y}px`, animationDelay: `${d}ms` } as React.CSSProperties}
						/>
					))}
				</g>

				<g fill="none" stroke="var(--rx-ink-soft)" strokeWidth="2.2" strokeLinecap="round" opacity="0.45">
					<path className="rx-steam" d="M130 96c-7-9 7-13 0-23" />
					<path className="rx-steam rx-steam-2" d="M152 90c-8-11 8-15 0-26" />
					<path className="rx-steam rx-steam-3" d="M174 96c-7-9 7-13 0-23" />
				</g>

				<path d="M110 124c8-17 25-26 42-26s34 9 42 26z" fill="var(--rx-gold-wash)" />
				<circle cx="136" cy="115" r="4.5" fill="var(--rx-gold-soft)" />
				<circle cx="153" cy="108" r="5" fill="var(--rx-gold)" />
				<circle cx="170" cy="116" r="4" fill="var(--rx-gold-soft)" />
				<g fill="none" stroke="var(--rx-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
					<path d="M104 124h92c-3 25-21 39-46 39s-43-14-46-39z" />
					<path d="M96 124h108" />
					<path d="M84 172h132" stroke="var(--rx-ink-soft)" strokeWidth="2" opacity="0.3" />
				</g>
			</svg>

			<h2>{first ? 'Congratulations on your first dish' : 'Congratulations, chef'}</h2>
			<p>
				{title ? `You cooked ${title}` : 'You cooked it'}
				{improvised ? ', out of what was already in your kitchen. ' : '. '}
				{first
					? 'That is the hard one over with — the next is easier, and the one after that is just dinner.'
					: 'Every one of these gets faster.'}
			</p>

			{/* The question, and then what the answer means. Nothing is gated on
			    it: the actions below are there whether or not it is answered. */}
			<p className="rx-ask">How did it turn out?</p>
			<div className="rx-rate">
				{VERDICTS.map((v) => (
					<button
						key={v.id}
						type="button"
						className={rated === v.id ? 'is-on' : undefined}
						aria-pressed={rated === v.id}
						onClick={() => setRated((prev) => (prev === v.id ? null : v.id))}
					>
						{v.label}
					</button>
				))}
			</div>

			{chosen && (
				<p className="rx-said" key={chosen.id}>
					{chosen.line}
				</p>
			)}

			<div style={{ ...s.row, justifyContent: 'center' }}>
				{!isSaved && (
					<Button disabled={!canSave} onClick={onSave}>
						Keep it in my cookbook
					</Button>
				)}
				{isSaved && (
					<Button variant="secondary" onClick={onBook}>
						Open my cookbook
					</Button>
				)}
				<Button variant="secondary" onClick={onAnother}>
					Cook something else
				</Button>
			</div>
		</div>
	);
};

// =============================================================================
// INGREDIENTS — shared by the tick step and the finished recipe, so the two
// can never drift into showing the same list differently.
// =============================================================================

interface IngredientListProps {
	ingredients: Ingredient[];
	grouped: Array<{ name?: string; items: Ingredient[] }>;
	servings?: number;
	doneIng: number[];
	onToggleIng: (i: number) => void;
	scale: number;
	onScale: (factor: number) => void;
	mostlyEstimated: boolean;
}

const IngredientList: React.FC<IngredientListProps> = ({
	ingredients,
	grouped,
	servings,
	doneIng,
	onToggleIng,
	scale,
	onScale,
	mostlyEstimated,
}) => (
	<>
						{ingredients.length > 0 && (
							<>
								{servings ? (
									<div style={{ ...s.row, marginBottom: 14, justifyContent: 'space-between' }}>
										<span style={{ fontSize: 12, color: 'var(--rx-ink-soft)' }}>
											Serves {Math.round(servings * scale)}
										</span>
										<span className="rx-scale">
											{SCALES.map(([factor, label]) => (
												<button
													key={label}
													type="button"
													className={scale === factor ? 'is-on' : undefined}
													onClick={() => onScale(factor)}
												>
													{label}
												</button>
											))}
										</span>
									</div>
								) : null}

								<div className="rx-progress">
									<div className="rx-bar">
										<div
											className="rx-bar-fill"
											style={{ width: `${(doneIng.length / ingredients.length) * 100}%` }}
										/>
									</div>
									<span className="rx-count">
										{doneIng.length}/{ingredients.length} in your kitchen
									</span>
								</div>
							</>
						)}

						{ingredients.length ? (
							grouped.map((g, gi) => (
								<div className="rx-group" key={gi}>
									{g.name && <div className="rx-group-name">{g.name}</div>}
									{g.items.map((ing) => {
										const i = ingredients.indexOf(ing);
										const done = doneIng.includes(i);
										return (
											<div
												className={`rx-ing${done ? ' is-done' : ''}`}
												key={i}
												onClick={() => onToggleIng(i)}
												role="checkbox"
												aria-checked={done}
												tabIndex={0}
												onKeyDown={(e) => {
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														onToggleIng(i);
													}
												}}
											>
												<div className="rx-ing-name">
													<span className="rx-box">✓</span>
													<span>
														{ing.item ?? '—'}
														{ing.inferred && !mostlyEstimated && <span className="rx-est">est</span>}
													</span>
												</div>
												<div className="rx-ing-qty">
													{ing.quantity ? scaleQuantity(ing.quantity, scale) : '—'}
												</div>
												{ing.note && <div className="rx-ing-note">{ing.note}</div>}
											</div>
										);
									})}
								</div>
							))
						) : (
							<p style={s.muted}>Nothing could be read from this one.</p>
						)}
	</>
);

interface RecipeViewProps {
	recipe: Recipe;
	fridge: string;
	setFridge: (v: string) => void;
	sub: Substitution | null;
	busy: boolean;
	onSubstitute: () => void;
	onSave: () => void;
	isSaved: boolean;
	/** False until the workspace has loaded; saving before then would write
	 *  over seeded defaults and lose what is already persisted. */
	canSave: boolean;
	onCook: () => void;
	/** Build a recipe for the dish the substitution suggested instead. */
	onCookAlternative: () => void;
	doneIng: number[];
	doneStep: number[];
	onToggleIng: (i: number) => void;
	onToggleStep: (i: number) => void;
	scale: number;
	onScale: (factor: number) => void;
	checkedAgainst: number[] | null;
	/** 'verdict' shows only the can-I-make-this answer; 'recipe' shows the dish. */
	stage?: 'verdict' | 'recipe';
	onContinue?: () => void;
}

const RecipeView: React.FC<RecipeViewProps> = ({
	recipe,
	fridge,
	setFridge,
	sub,
	busy,
	onSubstitute,
	onCookAlternative,
	doneIng,
	doneStep,
	onToggleIng,
	onToggleStep,
	scale,
	onScale,
	checkedAgainst,
	stage = 'recipe',
	onContinue,
	onSave,
	isSaved,
	canSave,
	onCook,
}) => {
	const ingredients = recipe.ingredients ?? [];
	const estimatedCount = ingredients.filter((i) => i.inferred).length;
	// When nearly everything is an estimate the per-row badge stops carrying
	// information, so say it once and drop the badges.
	const mostlyEstimated = ingredients.length > 0 && estimatedCount / ingredients.length >= MOSTLY_ESTIMATED;
	// A recipe written for someone's ingredients has no reel behind it, so the
	// reel-shaped copy below would contradict the recipe's own first caveat.
	// Anything we wrote rather than read. Old saved recipes carry no origin at
	// all and were all reel readings, so an absent origin stays a reel.
	const written = recipe.origin === 'kitchen' || recipe.origin === 'described';
	/** Written for the ingredients on hand, as opposed to from a dish they named. */
	const fromKitchen = recipe.origin === 'kitchen';


	const grouped = useMemo(() => groupIngredients(ingredients), [ingredients]);

	// A tick means "I have this". Everything unticked is what you would have to
	// buy, which makes the shopping list exact rather than something a model
	// inferred from a sentence you typed.
	const haveCount = doneIng.length;
	const lacking = useMemo(
		() => ingredients.filter((_, i) => !doneIng.includes(i)),
		[ingredients, doneIng],
	);
	// The check answered a question about a kitchen that has since changed.
	const stale =
		!!checkedAgainst &&
		(checkedAgainst.length !== doneIng.length ||
			checkedAgainst.some((i) => !doneIng.includes(i)));

	// Only the swaps that still matter. Buying the water retires the line
	// telling you to use yogurt instead of it, without asking a model again.
	const liveLines = useMemo(
		() =>
			(sub?.lines ?? []).filter(
				(ln) => ln.status !== 'have' && lacking.some((ing) => sameIngredient(ln.item, ing.item)),
			),
		[sub, lacking],
	);

	// Cuisine, servings and time were 12.5px muted text — the smallest thing on
	// screen, holding the only two numbers anyone plans an evening around.
	const chips = [
		recipe.cuisine,
		recipe.servings ? `Serves ${Math.round(recipe.servings * scale)}` : null,
		recipe.totalMinutes ? `${recipe.totalMinutes} min` : null,
	].filter(Boolean) as string[];

	// One banner, chosen, rather than however many happen to be true at once.
	const estimateNote = mostlyEstimated
		? written
			? 'Nobody cooked this on camera, so every quantity is a sensible starting point rather than a cook’s recipe. Taste as you go.'
			: 'The cook never gave amounts, so every quantity is a sensible starting point rather than theirs. Taste as you go.'
		: recipe.confidence === 'low'
			? written
				? fromKitchen
					? 'Written for your ingredients rather than read from a video, so the amounts are estimates. Taste as you go.'
					: 'Written from what you described rather than read from a video, so the amounts are estimates. Taste as you go.'
				: 'The reel was vague in places, so parts of this are inferred. Taste as you go.'
			: null;

	// Shopping is derived from data already on screen, so it needs no request
	// and no spinner — the panel is just hidden until asked for.
	const [shopping, setShopping] = useState(false);
	const [copied, setCopied] = useState(false);
	const missing = useMemo<ShoppingItem[]>(
		() =>
			lacking
				.filter((ing) => ing.item?.trim())
				.map((ing) => ({
					index: ingredients.indexOf(ing),
					item: ing.item!.trim(),
					quantity: ing.quantity ? scaleQuantity(ing.quantity, scale) : undefined,
					// If the fridge check found a swap for it, that is worth knowing
					// while standing in the aisle deciding whether to bother.
					why: sub?.lines?.find((ln) => ln.status === 'substitute' && sameIngredient(ln.item, ing.item))
						?.useInstead
						? `Or swap: ${sub.lines.find((ln) => sameIngredient(ln.item, ing.item))?.useInstead}`
						: undefined,
				})),
		[ingredients, lacking, scale, sub],
	);

	// A new fridge answer invalidates the old list; leaving the panel open would
	// show items worked out against the previous one.
	useEffect(() => {
		setShopping(false);
		setCopied(false);
	}, [sub]);

	const copyList = useCallback(() => {
		const text = missing.map((m) => (m.quantity ? `${m.item} — ${m.quantity}` : m.item)).join('\n');
		// Clipboard access can be refused outright inside an embedded frame, and
		// a rejected promise here must not take the panel down with it.
		void navigator.clipboard
			?.writeText(text)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			})
			.catch(() => undefined);
	}, [missing]);

	return (
		<div style={s.stack}>
			<Card
				header={recipe.title || 'Untitled recipe'}
				headerActions={
					<div style={s.row}>
						<Button variant="secondary" small disabled={isSaved || !canSave} onClick={onSave}>
							{isSaved ? 'Saved' : 'Save to my book'}
						</Button>
						<Button small disabled={!recipe.steps?.length} onClick={onCook}>
							Start cooking
						</Button>
					</div>
				}
			>
				{stage === 'recipe' && (
				<div className="rx-head rx-in">
					<div className="rx-chips">
						{chips.length ? (
							chips.map((c, i) => (
								<span key={i} className="rx-chip">
									{c}
								</span>
							))
						) : (
							<span className="rx-chip">
							{fromKitchen
										? 'Written for what you have'
										: written
											? 'Written from what you described'
											: 'No serving size given'}
							</span>
						)}
					</div>
				</div>

			)}

				{stage === 'recipe' && estimateNote && <Banner variant="warning">{estimateNote}</Banner>}

				<div className={`rx-split${stage === 'verdict' ? ' rx-solo' : ''}`}>
					<aside className="rx-aside rx-in rx-in-2">
						{stage === 'recipe' && <div className="rx-label">Ingredients</div>}

						{stage === 'recipe' && (
						<IngredientList
							ingredients={ingredients}
							grouped={grouped}
							servings={recipe.servings}
							doneIng={doneIng}
							onToggleIng={onToggleIng}
							scale={scale}
							onScale={onScale}
							mostlyEstimated={mostlyEstimated}
						/>
						)}

						{/* Opening a saved recipe lands here, where the list is tickable
						    and, until now, ticking did nothing at all — no button, no
						    re-check, just a control that moved and changed nothing.
						    Unticking something is a statement that you have run out, so
						    it needs to lead somewhere.

						    Deliberately worded as unticked rather than missing: a recipe
						    opened from the book starts with only the pantry basics ticked,
						    which means the question has not been answered yet, not that
						    twelve things are absent from the kitchen. */}
						{stage === 'recipe' && lacking.length > 0 && (
							<div className="rx-panel">
								<p style={{ ...s.muted, marginTop: 0, marginBottom: 10 }}>
									{lacking.length} {lacking.length === 1 ? 'ingredient is' : 'ingredients are'} not
									ticked. Check whether you can still make this tonight?
								</p>
								<Button small disabled={busy || haveCount === 0} onClick={onSubstitute}>
									{sub ? 'Check again' : 'Check what I can make'}
								</Button>
							</div>
						)}

						{stage === 'verdict' && sub && (
						<div className="rx-panel">
							<div className="rx-label">Can you make this tonight?</div>
				<p style={{ ...s.muted, marginTop: 0 }}>
					{haveCount === 0
						? 'Tick the ingredients you already have in the list above, then check here.'
						: `You have ${haveCount} of ${ingredients.length}. ${
								lacking.length
									? `Missing: ${lacking
											.slice(0, 4)
											.map((i) => i.item)
											.join(', ')}${lacking.length > 4 ? `, and ${lacking.length - 4} more` : ''}.`
									: 'That is everything the recipe asks for.'
							}`}
				</p>

				{/* Optional, and second. The ticks say what you have OF THIS RECIPE,
				    which is what the shopping list needs. This says what else is in
				    the kitchen, which is the only way to suggest a different dish —
				    knowing you are out of wonton wrappers says nothing about whether
				    you own rice. */}
				<p style={{ ...s.muted, marginBottom: 6 }}>
					Anything else in your kitchen? Optional, and only used to suggest something else
					if this one is off.
				</p>
				<textarea
					style={{ ...s.textarea, minHeight: 80 }}
					value={fridge}
					placeholder="rice, eggs, pasta, whatever spices came in the starter pack…"
					onChange={(e) => setFridge(e.target.value)}
				/>
				<div style={{ marginTop: 12 }}>
					<Button disabled={busy || haveCount === 0} onClick={onSubstitute}>
						{lacking.length ? `Check the ${lacking.length} I am missing` : 'Check what I can make'}
					</Button>
				</div>

				{sub && (
					<div style={{ marginTop: 20 }}>
						<Banner variant={sub.canCookTonight ? 'info' : 'warning'}>
							{sub.verdict || (sub.canCookTonight ? 'You can make this.' : 'Not tonight.')}
						</Banner>
						<div style={{ marginTop: 12 }}>
							{sub.lines?.map((ln, i) => (
								<SubRow key={i} line={ln} />
							))}
						</div>
					{(missing.length > 0 || sub.alternative || shopping) && (
							<div style={{ marginTop: 18 }}>
								{/* Count what is actually rendered. The old copy said "Two ways
								    forward" whenever anything was missing, but the second button
								    was gated on the model having volunteered an alternative — so
								    a cookable dish printed a promise of two and showed one. */}
								<div style={{ ...s.muted, marginBottom: 10 }}>
									{missing.length > 0
										? `You are missing ${missing.length} thing${missing.length > 1 ? 's' : ''}. Two ways forward:`
										: 'Or, if you would rather not:'}
								</div>

								<div style={s.row}>
									{missing.length > 0 && (
										<Button small variant="secondary" onClick={() => setShopping((v) => !v)}>
											{shopping ? 'Hide the shopping list' : 'Get it today — shopping list'}
										</Button>
									)}
									{/* Always offered. The ticked ingredients are a pantry, so this
									    is answerable whether or not a suggestion came back. */}
									<Button small disabled={busy} onClick={onCookAlternative}>
										{sub.alternative ? 'Cook something else tonight' : 'Cook something else with these'}
									</Button>
								</div>

								{sub.alternative && (
									<div style={{ ...s.doneWhen, marginTop: 12 }}>
										<strong>Instead: </strong>
										{sub.alternative}
									</div>
								)}

								{shopping && (
									<div style={{ ...s.doneWhen, marginTop: 12 }}>
										{missing.length > 0 ? (
											<>
										<strong>Buy these {missing.length}:</strong>
										<p style={{ ...s.muted, marginTop: 6, marginBottom: 8 }}>
											Tick them off as they go in the basket — the answer above updates as you shop.
										</p>
										<div>
											{missing.map((m) => (
												<div
													key={m.index}
													className="rx-ing"
													onClick={() => onToggleIng(m.index)}
													role="checkbox"
													aria-checked={false}
													tabIndex={0}
													onKeyDown={(e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault();
															onToggleIng(m.index);
														}
													}}
												>
													<div className="rx-ing-name">
														<span className="rx-box">✓</span>
														<span>{m.item}</span>
													</div>
													<div className="rx-ing-qty">{m.quantity ?? '—'}</div>
													{m.why && <div className="rx-ing-note">{m.why}</div>}
												</div>
											))}
										</div>
										<div style={{ ...s.row, marginTop: 12 }}>
											<Button small variant="secondary" onClick={copyList}>
												{copied ? 'Copied' : 'Copy the list'}
											</Button>
											{/* A handoff, not a claim: the maps app knows where the user is, so
											    nothing here collects a location or asserts anything about stock,
											    hours or price. */}
											<a
												href={mapsUrl(storeQuery(recipe, missing))}
												target="_blank"
												rel="noopener noreferrer"
												style={{ fontSize: 13, color: 'var(--rx-gold)' }}
											>
												Find a {storeQuery(recipe, missing).replace(' grocery store', '')} grocery store near you
											</a>
										</div>
											</>
										) : (
											<div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
												<strong>That is everything.</strong>
												<p style={{ ...s.muted, marginTop: 6, marginBottom: 12 }}>
													Nothing left to buy — you can cook this now.
												</p>
												<Button small onClick={onContinue}>
													Show me the recipe
												</Button>
											</div>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				)}
						</div>
						)}
					</aside>

					{stage === 'recipe' && (
					<section className="rx-in rx-in-3">
						<div className="rx-label">Method</div>

						{!!recipe.steps?.length && (
							<div className="rx-progress">
								<div className="rx-bar">
									<div
										className="rx-bar-fill"
										style={{ width: `${(doneStep.length / recipe.steps.length) * 100}%` }}
									/>
								</div>
								<span className="rx-count">
									{doneStep.length}/{recipe.steps.length} done
								</span>
							</div>
						)}

						{recipe.steps?.length ? (
							recipe.steps.map((st, i) => (
								<StepRow
									key={i}
									step={st}
									index={i}
									done={doneStep.includes(i)}
									onToggle={() => onToggleStep(i)}
								/>
							))
						) : (
							<p style={s.muted}>No steps could be read from this one.</p>
						)}

						{!!recipe.finishingTouches?.length && (
							<div className="rx-touches">
								<div className="rx-label" style={{ marginBottom: 10 }}>
									To make it taste like home
								</div>
								<p style={{ ...s.muted, marginTop: 0, marginBottom: 10 }}>
									None of this was in the video — it is what someone who has made this a
									hundred times would add. The recipe works without them.
								</p>
								<ul>
									{recipe.finishingTouches.map((t, i) => (
										<li key={i}>{t}</li>
									))}
								</ul>
							</div>
						)}

						{!!recipe.missingInfo?.length && (
							<div className="rx-caveats">
								<div className="rx-label">{written ? 'Worth knowing' : 'The reel never said'}</div>
								<ul>
									{recipe.missingInfo.map((m, i) => (
										<li key={i}>{m}</li>
									))}
								</ul>
							</div>
						)}
					</section>
					)}
				</div>
			</Card>
		</div>
	);
};

const StepRow: React.FC<{ step: Step; index: number; done: boolean; onToggle: () => void }> = ({
	step,
	index,
	done,
	onToggle,
}) => (
	<div
		className={`rx-step${done ? ' is-done' : ''}`}
		onClick={onToggle}
		role="checkbox"
		aria-checked={done}
		tabIndex={0}
		onKeyDown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				onToggle();
			}
		}}
	>
		<div className="rx-step-n">
			<span className="rx-box">✓</span>
		</div>
		<div>
			<div className="rx-step-top">
				<div className="rx-step-text">
					<b style={{ color: 'var(--rx-ink-soft)', fontWeight: 700, marginRight: 8 }}>
						{step.n ?? index + 1}
					</b>
					{step.instruction ?? ''}
				</div>
				{!!step.minutes && <div className="rx-step-time">{step.minutes} min</div>}
			</div>
			{step.doneWhen && (
				<div className="rx-cue">
					<b>Ready when</b> {step.doneWhen}
				</div>
			)}
		</div>
	</div>
);

const SubRow: React.FC<{ line: SubLine }> = ({ line }) => (
	<div style={s.ingRow}>
		<div style={s.ingName}>
			<span>{line.item ?? '—'}</span>
			<StatusBadge variant={SUB_VARIANT[line.status ?? 'missing'] ?? 'muted'}>
				{line.status ?? 'unknown'}
			</StatusBadge>
		</div>
		<div style={s.ingQty}>{line.useInstead || ''}</div>
		{line.tradeoff && <div style={s.ingNote}>{line.tradeoff}</div>}
	</div>
);

// =============================================================================
// COOK — timers are pure client state; no model call at cook time.
// =============================================================================

const CookView: React.FC<{
	recipe: Recipe;
	doneStep: number[];
	onToggleStep: (i: number) => void;
	onFinish: () => void;
}> = ({ recipe, doneStep, onToggleStep, onFinish }) => {
	const steps = recipe.steps ?? [];
	const [index, setIndex] = useState(0);
	const [left, setLeft] = useState<number | null>(null);
	const tick = useRef<ReturnType<typeof setInterval> | null>(null);

	const step = steps[Math.min(index, steps.length - 1)];
	const total = (step?.minutes ?? 0) * 60;
	const needed = useMemo(
		() => (step ? stepIngredients(step, recipe.ingredients ?? []) : []),
		[step, recipe.ingredients],
	);

	// Hands are busy and often wet. Arrow keys and space are reachable with a
	// knuckle; hunting for a small button is not.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const typing = (e.target as HTMLElement | null)?.tagName;
			if (typing === 'INPUT' || typing === 'TEXTAREA') return;
			if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, steps.length - 1));
			if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [steps.length]);

	const stop = useCallback(() => {
		if (tick.current) clearInterval(tick.current);
		tick.current = null;
	}, []);

	// Cancel any running timer when the step changes or the view unmounts,
	// otherwise step 2's timer keeps counting down over step 3.
	useEffect(() => {
		setLeft(null);
		stop();
		return stop;
	}, [index, stop]);

	const start = useCallback(() => {
		if (!total) return;
		stop();
		setLeft(total);
		tick.current = setInterval(() => {
			setLeft((prev) => {
				if (prev === null) return null;
				if (prev <= 1) {
					stop();
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
	}, [stop, total]);

	if (!step) return <EmptyState title="Nothing to cook" description="Build a recipe first." />;

	const pct = total && left !== null ? ((total - left) / total) * 100 : 0;

	return (
		<div className="rx-steamy">
			{/* Behind everything, and behind the card the step sits on. Cook mode
			    is the one screen someone stands in front of for half an hour with
			    a pan going; it is the one screen that gets an atmosphere. */}
			<div className="rx-clouds" aria-hidden="true">
				<span className="rx-cloud" />
				<span className="rx-cloud" />
				<span className="rx-cloud" />
			</div>
			{/* And two more over the top, so the steam crosses the step rather
			    than politely stopping at the edge of the card. */}
			<div className="rx-drifting" aria-hidden="true">
				<span className="rx-cloud" />
				<span className="rx-cloud" />
			</div>
		<Card
			header={`Step ${step.n ?? index + 1} of ${steps.length}`}
			headerActions={
				<div style={s.row}>
					<Button variant="secondary" small disabled={index === 0} onClick={() => setIndex(index - 1)}>
						Back
					</Button>
					<Button small disabled={index >= steps.length - 1} onClick={() => setIndex(index + 1)}>
						Next
					</Button>
				</div>
			}
		>
			<div className="rx-cook">
				<p className="rx-cook-step rx-in" key={`t${index}`}>
					{step.instruction}
				</p>

				{step.doneWhen && (
					<div className="rx-cook-cue rx-in rx-in-2" key={`c${index}`}>
						<b>Ready when</b> {step.doneWhen}
					</div>
				)}

				{/* The ingredient list is a whole screen away in cook mode, and a
				    step that says "add the spices" is no use without the amounts. */}
				{!!needed.length && (
					<div className="rx-cook-ing rx-in rx-in-2" key={`i${index}`}>
						{needed.map((ing, i) => (
							<span key={i}>
								{i > 0 && ' · '}
								<b>{ing.item}</b>
								{ing.quantity ? ` ${ing.quantity}` : ''}
							</span>
						))}
					</div>
				)}
			</div>

			{!!step.minutes && (
				<div style={{ marginTop: 22 }}>
					<div style={s.row}>
						<span
								className="rx-timer"
								style={{ color: left === 0 ? 'var(--rx-gold)' : undefined }}
							>
							{mmss(left === null ? total : left)}
						</span>
						{left === null ? (
							<Button onClick={start}>Start {step.minutes} min timer</Button>
						) : (
							<Button
								variant="secondary"
								onClick={() => {
									stop();
									setLeft(null);
								}}
							>
								Reset
							</Button>
						)}
					</div>
					{left !== null && (
						<div style={s.progressTrack}>
							<div style={{ ...s.progressFill, width: `${pct}%` }} />
						</div>
					)}
					{left === 0 && (
						<div style={{ marginTop: 12 }}>
							<Banner variant="info">Time is up — check it against the cue above.</Banner>
						</div>
					)}
				</div>
			)}

			<div className="rx-cook">
				<div style={{ ...s.row, marginTop: 26 }}>
					<Button
						variant={doneStep.includes(index) ? 'secondary' : undefined}
						onClick={() => {
							const wasDone = doneStep.includes(index);
							onToggleStep(index);
							if (wasDone) return;
							// Every step ticked means the dish is cooked. Marking the last
							// one used to do nothing whatsoever, which is a strange way to
							// end the one journey the app is named after.
							const remaining = steps.filter((_, i) => i !== index && !doneStep.includes(i));
							if (remaining.length === 0) {
								onFinish();
								return;
							}
							// Otherwise carry on to the next step, saving the second tap.
							if (index < steps.length - 1) setIndex(index + 1);
						}}
					>
						{doneStep.includes(index) ? 'Done — tap to undo' : 'Mark done'}
					</Button>
				</div>

				{/* Where you are, and how much is left, without counting. */}
				<div className="rx-dots">
					{steps.map((_, i) => (
						<button
							key={i}
							type="button"
							aria-label={`Step ${i + 1}`}
							className={`rx-dot${i === index ? ' is-on' : doneStep.includes(i) ? ' is-past' : ''}`}
							onClick={() => setIndex(i)}
						/>
					))}
				</div>

				<div className="rx-hint">Arrow keys move between steps.</div>
			</div>
		</Card>
		</div>
	);
};

// =============================================================================
// BOOK — persisted per user via the shell workspace, never localStorage.
// =============================================================================

const BookView: React.FC<{
	loaded: boolean;
	saved: SavedRecipe[];
	onOpen: (sv: SavedRecipe) => void;
	onStart: () => void;
	onDelete: (id: string) => void;
}> = ({ loaded, saved, onOpen, onStart, onDelete }) => {
	// Saved recipes live server-side and there is no undo, so deleting asks
	// once. The confirm lapses on its own — an armed delete button left sitting
	// on the screen is a trap for whoever taps next.
	const [confirming, setConfirming] = useState<string | null>(null);
	useEffect(() => {
		if (!confirming) return;
		const t = setTimeout(() => setConfirming(null), 4000);
		return () => clearTimeout(t);
	}, [confirming]);

	if (!loaded) return <p style={s.muted}>Loading your book…</p>;
	if (!saved.length) {
		return (
			<EmptyState
				title="Your recipe book is empty"
				description="Recipes you save show up here, ready to cook again."
				action={<Button onClick={onStart}>Add your first</Button>}
			/>
		);
	}
	return (
		<div style={s.stack}>
			{saved.map((sv) => (
				<Card
					key={sv.id}
					header={sv.recipe.title || 'Untitled'}
					headerActions={
						<div style={s.row}>
							<Button
								variant="secondary"
								small
								onClick={() => (confirming === sv.id ? onDelete(sv.id) : setConfirming(sv.id))}
							>
								{confirming === sv.id ? 'Tap again to delete' : 'Delete'}
							</Button>
							<Button variant="secondary" small onClick={() => onOpen(sv)}>
								Open
							</Button>
						</div>
					}
				>
					<div style={s.meta}>
						{summarise(
							sv.recipe,
							[
								`saved ${new Date(sv.savedAt).toLocaleDateString()}`,
								sv.cookedCount ? `cooked ${sv.cookedCount}x` : null,
							]
								.filter(Boolean)
								.join('  ·  '),
						)}
					</div>
				</Card>
			))}
		</div>
	);
};

// =============================================================================
// ROOT
// =============================================================================

const App: React.FC<ShellAppProps> = (props) => (
	<AppLayout>
		{/* Mounted with the app rather than injected into document.head, so it
		    leaves with the app instead of outliving it in the shell. */}
		<style>{CSS}</style>
		<Content {...props} />
	</AppLayout>
);

export default App;
