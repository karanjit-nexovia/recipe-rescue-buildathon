// =============================================================================
// Pipeline lifecycle and the calls the app makes.
//
// Four pipelines, but only one of them reasons. The other three are a cost
// ladder: each rung is only climbed when the one below came back short.
//   transcribe — audio to text. The cheap rung, always run.
//   screentext — frames to OCR. Escalated when the reel barely spoke, or
//                spoke without ever naming an amount.
//   vision     — frames described by an image model. The dear rung, escalated
//                only when speech and screen text together come back empty.
//   ask        — one generic chat pipeline. All prompting lives in the
//                Question object (see prompts.ts), so a single pipeline
//                serves extraction, substitution, and the fallback dish.
//
// client.use() is expensive, so each is started once per session and its
// token reused. Config changes apply at task start only, so editing a .pipe
// during development requires terminating the running task — attaching to it
// silently keeps the old definition.
// =============================================================================

import { useCallback, useEffect, useRef } from 'react';
import { useShellConnection } from 'shell';

import transcribePipe from './transcribe.pipe';
import screentextPipe from './screentext.pipe';
import askPipe from './ask.pipe';
import visionPipe from './vision.pipe';
import {
	buildAlternativeRecipeQuestion,
	buildExtractionQuestion,
	buildSubstitutionQuestion,
} from './prompts';
import { firstAnswer, extractJson } from './parse';
import type { Recipe, Substitution } from './types';

/**
 * Idle shutdown window for a started task, in seconds.
 *
 * A task bills for as long as it is ALIVE, not just while it is serving a
 * request, so this is a direct cost lever. Three minutes covers the gap
 * between extracting a recipe and asking the fridge question; anything longer
 * just burns credits while the user reads. Restarting costs a few seconds.
 */
const TASK_TTL = 180;

type PipeName = 'transcribe' | 'screentext' | 'vision' | 'ask';

const PIPELINES = {
	transcribe: transcribePipe,
	screentext: screentextPipe,
	vision: visionPipe,
	ask: askPipe,
} satisfies Record<PipeName, typeof askPipe>;

/** Reels are short; anything larger is a mis-drop. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Ceilings on how long the UI will wait. Judges run this unattended, with
 *  nobody to restart anything, so a hung pipeline must surface as an error
 *  the user can act on rather than a spinner that never resolves. */
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;
const ASK_TIMEOUT_MS = 2 * 60 * 1000;
/**
 * Starting a task is orchestration, not work — it should take seconds. A start
 * that has not returned in ninety of them is not slow, it is stuck, and every
 * later ceiling is unreachable until this one fires.
 */
const USE_TIMEOUT_MS = 90 * 1000;

/**
 * What a dead task looks like from the client side.
 *
 * The platform reports it as a failure to open a data pipe rather than as a
 * missing task, so matching on the message is the only signal available.
 */
const DEAD_TASK =
	/failed to open a data pipe|isn't running|is not running|task terminated|no such task|invalid token|unknown token|token .*(expired|invalid)/i;

/**
 * Reject if `work` outruns `ms`.
 *
 * This frees the UI; it cannot cancel the server-side run, which keeps going
 * and may still bill. That is the right trade: a stuck screen is worse than a
 * wasted run, and the task's own ttl reaps it.
 */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s. Try again, or use the paste box.`)),
			ms,
		);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

export interface TranscribeResult {
	/** What the cook said out loud. */
	transcript: string;
	/** Text burned into the video — captions, quantity overlays. */
	screenText: string;
}

/** Below this, a reel has effectively told us nothing in words. */
export const THIN_EVIDENCE_CHARS = 80;

export function usePipelines() {
	const { client, isConnected } = useShellConnection();
	// Cache the in-flight promise, not just the token, so two rapid calls
	// cannot start the same pipeline twice.
	const tokens = useRef<Partial<Record<PipeName, Promise<string>>>>({});

	// A cached token belongs to one connection. After a reconnect — a laptop
	// waking, a dropped socket — the old token is dead, and reusing it fails
	// every request until the page is reloaded. Drop the cache instead.
	useEffect(() => {
		tokens.current = {};
	}, [client]);

	useEffect(() => {
		if (!isConnected) tokens.current = {};
	}, [isConnected]);

	// Closing the app should stop paying for it. Without this, every task the
	// session started keeps billing until its ttl expires, even though nobody
	// is there to use it.
	useEffect(() => {
		const started = tokens.current;
		return () => {
			for (const pending of Object.values(started)) {
				void pending
					?.then((token) => client?.terminate(token))
					// The task may already be gone, or the socket already closed —
					// there is nothing useful to do on teardown either way.
					.catch(() => undefined);
			}
		};
	}, [client]);

	const tokenFor = useCallback(
		(name: PipeName): Promise<string> => {
			if (!client || !isConnected) {
				return Promise.reject(new Error('Not connected to RocketRide yet.'));
			}
			const cached = tokens.current[name];
			if (cached) return cached;

			// The ceiling belongs HERE, not only on the request that follows.
			// use() starts a server-side task and has no timeout of its own, so
			// without this a hung start is unbounded: the caller sits at
			// "Reading the speech and on-screen text" past every other limit in
			// this file, and the spinner never resolves. That is precisely the
			// failure the timeouts exist to prevent.
			const started = withTimeout(
				client
					.use({ pipeline: PIPELINES[name], useExisting: true, ttl: TASK_TTL })
					.then((res: { token: string }) => res.token),
				USE_TIMEOUT_MS,
				'Starting the pipeline',
			).catch((err: unknown) => {
				// Never cache a failed start — the next attempt should retry.
				// This covers the timeout too, so a slow start does not poison
				// the cache with a promise that already rejected.
				delete tokens.current[name];
				throw err;
			});

			tokens.current[name] = started;
			return started;
		},
		[client, isConnected],
	);

	/**
	 * Run something against a live task, starting a new one if the cached token
	 * points at a corpse.
	 *
	 * TASK_TTL reaps a task after three minutes idle and the token cache has no
	 * idea it happened — so reading a recipe for a few minutes and then asking
	 * anything at all failed with "Failed to open a data pipe". The cache is
	 * cleared on reconnect and on disconnect, but neither of those is what
	 * happens here: the socket is fine, the task is gone.
	 *
	 * Retried exactly once. If a fresh task fails the same way the problem is
	 * not staleness and the error should reach the user.
	 */
	const withLiveTask = useCallback(
		async <T,>(name: PipeName, run: (token: string) => Promise<T>): Promise<T> => {
			try {
				return await run(await tokenFor(name));
			} catch (err) {
				if (!DEAD_TASK.test((err as Error)?.message ?? '')) throw err;
				delete tokens.current[name];
				return run(await tokenFor(name));
			}
		},
		[tokenFor],
	);

	/** Upload a video and pull back its spoken transcript and on-screen text. */
	const transcribe = useCallback(
		async (file: File): Promise<TranscribeResult> => {
			return withLiveTask('transcribe', async (token) => {
			const uploads = await withTimeout(
				client!.sendFiles([{ file, mimetype: file.type || 'video/mp4' }], token),
				TRANSCRIBE_TIMEOUT_MS,
				'Reading that video',
			);

			const done = uploads.find((u: { action: string; result?: unknown }) => u.action === 'complete' && u.result);
			if (!done) {
				const failed = uploads.some((u: { action: string }) => u.action === 'error');
				throw new Error(
					failed
						? 'The upload failed before the pipeline saw it. Check the file and try again.'
						: 'The video uploaded but the pipeline returned nothing.',
				);
			}

			const result = (done as { result: Record<string, unknown> }).result;
			// response_text nodes were given laneName transcript / screentext, so
			// each arrives as its own top-level key holding an array of strings.
			const join = (key: string): string => {
				const v = result[key];
				if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join('\n').trim();
				return typeof v === 'string' ? v.trim() : '';
			};

			return { transcript: join('transcript'), screenText: '' };
			});
		},
		[client, withLiveTask],
	);

	/**
	 * Read the text burned into the video — caption overlays, the quantity
	 * cards creators put on screen.
	 *
	 * This used to run on every upload, in parallel with the audio, inside
	 * transcribe.pipe. It was roughly half the cost of a video run: grabbing
	 * frames and OCR-ing each one is the 71-second bottleneck, and it was being
	 * paid for on reels where the cook says every amount out loud and the
	 * overlay adds nothing. It is now escalated, on the same principle vision
	 * already worked on.
	 */
	const readScreenText = useCallback(
		async (file: File): Promise<string> =>
			withLiveTask('screentext', async (token) => {
				const uploads = await withTimeout(
					client!.sendFiles([{ file, mimetype: file.type || 'video/mp4' }], token),
					TRANSCRIBE_TIMEOUT_MS,
					'Reading the on-screen text',
				);
				const done = uploads.find((u: { action: string; result?: unknown }) => u.action === 'complete' && u.result);
				if (!done) return '';
				const v = (done as { result: Record<string, unknown> }).result.screentext;
				if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join('\n').trim();
				return typeof v === 'string' ? v.trim() : '';
			}),
		[client, withLiveTask],
	);

	/**
	 * Describe the video frames. Only called when the reel said nothing in
	 * words, because vision runs per frame and dominates the wall clock — on a
	 * 27-second reel it was 127 of 213 seconds. Most reels talk, so most reels
	 * never pay for this.
	 */
	const describeFrames = useCallback(
		async (file: File): Promise<string> => {
			const token = await tokenFor('vision');
			const uploads = await withTimeout(
				client!.sendFiles([{ file, mimetype: file.type || 'video/mp4' }], token),
				TRANSCRIBE_TIMEOUT_MS,
				'Watching that video',
			);
			const done = uploads.find((u: { action: string; result?: unknown }) => u.action === 'complete' && u.result);
			if (!done) return '';
			const v = (done as { result: Record<string, unknown> }).result.scenes;
			if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join('\n').trim();
			return typeof v === 'string' ? v.trim() : '';
		},
		[client, tokenFor],
	);

	/** Ask the chat pipeline something and parse the JSON answer. */
	const ask = useCallback(
		async <T,>(build: (Question: never) => unknown): Promise<T> => {
			const result = await withLiveTask('ask', async (token) => {
				const { Question } = await import('rocketride');
				// The builders take the constructor rather than importing it, so
				// prompts.ts stays free of a value import from the client bundle.
				// The result is a real Question; the cast just re-states that.
				const chat = client!.chat.bind(client!);
				const question = build(Question as never) as Parameters<typeof chat>[0]['question'];
				return withTimeout(chat({ token, question }), ASK_TIMEOUT_MS, 'The model');
			});

			// expectJson usually returns an already-parsed object, but fall back
			// to text extraction — model output is data, not a contract.
			const parsed = extractJson<T>(firstAnswer(result));
			if (!parsed) throw new Error('The model did not return a readable answer. Try again.');
			return parsed;
		},
		[client, withLiveTask],
	);

	const extractRecipe = useCallback(
		(transcript: string, screenText?: string, scenes?: string, source: 'reel' | 'described' = 'reel') =>
			ask<Recipe>((Q) => buildExtractionQuestion(Q as never, transcript, screenText, scenes, source)),
		[ask],
	);

	const checkFridge = useCallback(
		(recipe: Recipe, fridge: string, have: string[] = [], lacking: string[] = []) =>
			ask<Substitution>((Q) => buildSubstitutionQuestion(Q as never, recipe, fridge, have, lacking)),
		[ask],
	);

	/** Write the fallback dish the substitution suggested. No video behind this
	 *  one, which is why the prompt makes it declare that in the recipe. */
	const cookAlternative = useCallback(
		(dish: string, fridge: string) =>
			ask<Recipe>((Q) => buildAlternativeRecipeQuestion(Q as never, dish, fridge)),
		[ask],
	);

	return {
		client,
		isConnected,
		transcribe,
		readScreenText,
		describeFrames,
		extractRecipe,
		checkFridge,
		cookAlternative,
	};
}
