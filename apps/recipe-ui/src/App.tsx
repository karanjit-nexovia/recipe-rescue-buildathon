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
.rx-split { display: grid; grid-template-columns: 1fr; gap: 30px; }
@media (min-width: 880px) {
  .rx-split { grid-template-columns: minmax(260px, 330px) 1fr; gap: 44px; align-items: start; }
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

const mmss = (secs: number): string => {
	const safe = Math.max(0, Math.round(secs));
	return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

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

/** Past this, a run is slower than any measured reel and worth flagging. */
const SLOW_SECONDS = 240;

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
const waitNote = (elapsed: number): string | null => {
	if (elapsed <= 25) return null;
	if (elapsed <= SLOW_SECONDS) return 'Reading a reel properly takes a while. It has not stalled.';
	return 'This is longer than a reel normally takes. It will stop on its own if nothing comes back — or start again with the caption box, which is quick.';
};

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
		async (payload: { file?: File; text?: string; link?: string }) => {
			if (inFlight.current) return;
			inFlight.current = true;
			abortRef.current = new AbortController();
			setError(null);
			setNotice(null);
			setSub(null);
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
						setBusy('Retrieving the video');
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
					// Every path through this block ends in an extraction, so the
					// ask task is certain to be needed. Started here, its 8-second
					// cold start happens while the audio is being read rather than
					// after it — the one stage long enough to hide it completely.
					prewarm('ask');

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
		(files: FileList) => {
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
			void runExtract({ file });
		},
		[runExtract],
	);

	// ---------------------------------------------------------- substitution

	const runSubstitute = useCallback(async () => {
		// The ticks are the answer now, so an empty free-text box is fine — but
		// having ticked nothing at all is not an answer, it is an unanswered form.
		if (!recipe || inFlight.current || doneIng.length === 0) return;
		inFlight.current = true;
		setError(null);
		setBusy('Checking what you can swap');
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
		} finally {
			inFlight.current = false;
			setBusy(null);
		}
	}, [checkFridge, doneIng, fridge, recipe]);

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
		} finally {
			inFlight.current = false;
			setBusy(null);
		}
	}, [cookAlternative, doneIng, fridge, recipe, sub]);

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
					{busy && view !== 'cooking' && (
						<Banner variant={elapsed > SLOW_SECONDS ? 'warning' : 'info'}>
							{busy} — {elapsed}s{waitText(elapsed)}
						</Banner>
					)}

					<StepPips view={view} />

					{view === 'welcome' && (
						<WelcomeView
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

					{view === 'cooking' && <CookingView stage={busy ?? 'Getting started'} elapsed={elapsed} />}

					{view === 'ingredients' && recipe && (
						<Card
							header={recipe.title || 'Your recipe'}
							headerActions={
								<Button
									disabled={!!busy || doneIng.length === 0}
									onClick={() => void runSubstitute()}
								>
									{doneIng.length === 0 ? 'Tick what you have' : 'Next'}
								</Button>
							}
						>
							<p style={{ ...s.muted, marginTop: 0 }}>
								Tick everything you already have. Salt, oil and water are ticked for you —
								untick them if you have actually run out.
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
						</Card>
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
				hint="One at a time — MP4, MOV or WEBM. Works even when the reel has no words at all."
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

/**
 * What is in the pan.
 *
 * Each bit carries its own arc rather than sharing one: five things thrown
 * along an identical path read as one object drawn five times. The delays are
 * small and uneven for the same reason.
 */
const PAN_BITS: Array<{ dx: number; dy: number; delay: number; shape: React.ReactNode }> = [
	{ dx: -40, dy: -58, delay: 0, shape: <circle cx="102" cy="131" r="5.5" fill="var(--rx-gold)" /> },
	{
		dx: -18,
		dy: -72,
		delay: 70,
		shape: <rect x="114" y="125" width="10" height="10" rx="2" fill="var(--rx-gold-soft)" />,
	},
	{ dx: 2, dy: -78, delay: 130, shape: <circle cx="136" cy="130" r="4.5" fill="var(--rx-ink-soft)" opacity="0.5" /> },
	{
		dx: 24,
		dy: -70,
		delay: 55,
		shape: <rect x="146" y="127" width="14" height="7" rx="3.5" fill="var(--rx-gold)" />,
	},
	{ dx: 44, dy: -54, delay: 20, shape: <circle cx="170" cy="132" r="6" fill="var(--rx-gold-soft)" /> },
];

/**
 * The waiting screen.
 *
 * Two minutes is a long time to hold someone on a form that has gone
 * unavailable, which is what a banner over the ingest page amounts to. This
 * takes the whole screen and shows the thing being made instead.
 *
 * The animation is the smaller half of it. The stage line and the counter are
 * what actually stop a long wait reading as a hang, so they stay exactly as
 * honest here as they were in the banner — the pan is what makes it bearable
 * to sit and read them.
 */
const CookingView: React.FC<{ stage: string; elapsed: number }> = ({ stage, elapsed }) => {
	const note = waitNote(elapsed);
	return (
		<div className="rx-cooking rx-in">
			<svg
				className="rx-stove"
				viewBox="0 0 300 210"
				role="img"
				aria-label="A pan on the heat, tossing its ingredients"
			>
				{/* The burner and its heat, under everything. The flame tips stop
				    just short of the pan base so they read as licking it rather
				    than burning through it. */}
				<g>
					<path
						d="M98 203h68"
						stroke="var(--rx-ink-soft)"
						strokeWidth="3"
						strokeLinecap="round"
						opacity="0.26"
						fill="none"
					/>
					<path className="rx-flame" d="M116 201c-6-14 6-18 1-30 11 8 9 22-1 30z" fill="var(--rx-gold-soft)" />
					<path
						className="rx-flame rx-flame-2"
						d="M134 202c-7-17 7-22 1-36 13 10 11 26-1 36z"
						fill="var(--rx-gold)"
					/>
					<path
						className="rx-flame rx-flame-3"
						d="M152 201c-6-14 6-18 1-30 11 8 9 22-1 30z"
						fill="var(--rx-gold-soft)"
					/>
				</g>

				{/* The pan: line art, in the same ink as the type. */}
				<g
					className="rx-pan"
					fill="none"
					stroke="var(--rx-ink)"
					strokeWidth="2.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<ellipse cx="132" cy="126" rx="56" ry="12" />
					<path d="M76 126c2 30 30 42 56 42s54-12 56-42" />
					<path d="M188 122l68-19" strokeWidth="5" />
					<path d="M252 105l14-4" strokeWidth="7" stroke="var(--rx-ink-soft)" opacity="0.55" />
				</g>

				{/* Painted after the pan so the toss passes in front of its rim. */}
				<g>
					{PAN_BITS.map((bit, i) => (
						<g
							key={i}
							className="rx-bit"
							style={
								{
									'--dx': `${bit.dx}px`,
									'--dy': `${bit.dy}px`,
									animationDelay: `${bit.delay}ms`,
								} as React.CSSProperties
							}
						>
							{bit.shape}
						</g>
					))}
				</g>
			</svg>

			<h2>Cooking your recipe</h2>
			<p className="rx-stage">{stage}</p>
			<p className={`rx-clock${elapsed > SLOW_SECONDS ? ' rx-warn' : ''}`}>{mmss(elapsed)}</p>
			{note && <p className="rx-reassure">{note}</p>}
		</div>
	);
};

const WelcomeView: React.FC<{ onStart: () => void; savedCount: number; onBook: () => void }> = ({
	onStart,
	savedCount,
	onBook,
}) => (
	<div className="rx-hero rx-in">
		<h1>Welcome to the journey of being a master chef</h1>
		<p>
			Send me a cooking reel, or just tell me what you want to eat. I will turn it into a
			recipe you can actually follow — real amounts, the right order, and what it should look
			like when it is ready.
		</p>
		<div style={{ ...s.row, justifyContent: 'center' }}>
			<Button onClick={onStart}>Let us cook</Button>
			{savedCount > 0 && (
				<Button variant="secondary" onClick={onBook}>
					Open my book ({savedCount})
				</Button>
			)}
		</div>
	</div>
);

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
const DoneView: React.FC<{
	title?: string;
	first: boolean;
	isSaved: boolean;
	canSave: boolean;
	onSave: () => void;
	onBook: () => void;
	onAnother: () => void;
}> = ({ title, first, isSaved, canSave, onSave, onBook, onAnother }) => (
	<div className="rx-done">
		<div className="rx-mark">✓</div>
		<h2>
			{first ? 'Congratulations on your first dish' : 'Another one down'}
		</h2>
		<p>
			{title ? `You cooked ${title}.` : 'You cooked it.'}{' '}
			{first
				? 'That is the hard one over with — the next is easier, and the one after that is just dinner.'
				: 'Keep it in your book and it is one tap away next time.'}
		</p>
		<div style={{ ...s.row, justifyContent: 'center' }}>
			{!isSaved && (
				<Button disabled={!canSave} onClick={onSave}>
					Save it to my cookbook
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
