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
	fetchMediaAsFile,
	looksLikeLink,
	resolveMediaSource,
	ResolveError,
	verifiedProviders,
} from './mediaSource';
import type { MediaSource } from './mediaSource';
import type { Recipe, SavedRecipe, Step, SubLine, Substitution } from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

const VIDEO_RE = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

/** Above this share of estimated ingredients, badging each one is just noise —
 *  say it once at the top instead. */
const MOSTLY_ESTIMATED = 0.6;

type View = 'ingest' | 'recipe' | 'cook' | 'book';

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
	muted: { fontSize: 13, color: 'var(--rr-text-secondary)', lineHeight: 1.55 },
	meta: { fontSize: 12.5, color: 'var(--rr-text-secondary)', letterSpacing: 0.2 },

	sectionTitle: {
		fontSize: 11,
		fontWeight: 700,
		letterSpacing: 1,
		textTransform: 'uppercase',
		color: 'var(--rr-text-secondary)',
		margin: '26px 0 10px',
	},

	textarea: {
		width: '100%',
		minHeight: 130,
		padding: 12,
		borderRadius: 8,
		border: '1px solid var(--rr-border, #d5d5d5)',
		fontFamily: 'inherit',
		fontSize: 13.5,
		lineHeight: 1.6,
		background: 'var(--rr-bg-input, transparent)',
		color: 'var(--rr-text-primary)',
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
		borderBottom: '1px solid var(--rr-border-subtle, rgba(128,128,128,0.18))',
	},
	ingName: { fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
	ingQty: {
		fontSize: 13,
		fontVariantNumeric: 'tabular-nums',
		color: 'var(--rr-text-secondary)',
		textAlign: 'right',
		whiteSpace: 'normal',
		maxWidth: 260,
	},
	ingNote: { gridColumn: '1 / -1', fontSize: 12.5, color: 'var(--rr-text-secondary)', lineHeight: 1.5 },

	// --- steps -------------------------------------------------------------
	stepRow: { display: 'grid', gridTemplateColumns: '30px 1fr', gap: 14, padding: '16px 0', borderBottom: '1px solid var(--rr-border-subtle, rgba(128,128,128,0.18))' },
	stepNum: {
		width: 26,
		height: 26,
		borderRadius: '50%',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		fontSize: 12,
		fontWeight: 700,
		background: 'var(--rr-bg-hover, rgba(128,128,128,0.14))',
		color: 'var(--rr-text-secondary)',
	},
	stepText: { fontSize: 14, lineHeight: 1.6 },
	doneWhen: {
		marginTop: 8,
		padding: '8px 11px',
		borderRadius: 6,
		borderLeft: '3px solid var(--rr-accent, #6b8afd)',
		background: 'var(--rr-bg-hover, rgba(128,128,128,0.08))',
		fontSize: 12.5,
		lineHeight: 1.55,
	},
	timeChip: { fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--rr-text-secondary)', whiteSpace: 'nowrap' },

	// --- cook mode ---------------------------------------------------------
	cookStep: { fontSize: 19, lineHeight: 1.55, marginTop: 0, marginBottom: 4 },
	timer: { fontSize: 52, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: 1, lineHeight: 1.1 },
	progressTrack: { height: 3, borderRadius: 2, background: 'var(--rr-bg-hover, rgba(128,128,128,0.2))', overflow: 'hidden', marginTop: 14 },
	progressFill: { height: '100%', background: 'var(--rr-accent, #6b8afd)', transition: 'width 300ms linear' },
};

// =============================================================================
// HELPERS
// =============================================================================

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

const summarise = (r: Recipe, extra?: string): string =>
	[r.cuisine, r.servings ? `serves ${r.servings}` : null, r.totalMinutes ? `${r.totalMinutes} min` : null, extra]
		.filter(Boolean)
		.join('  ·  ');

const SUB_VARIANT: Record<string, 'success' | 'warning' | 'error'> = {
	have: 'success',
	substitute: 'warning',
	missing: 'error',
};

// =============================================================================
// CONTENT
// =============================================================================

const Content: React.FC<ShellAppProps> = ({ isConnected }) => {
	const { transcribe, describeFrames, extractRecipe, checkFridge, cookAlternative } = usePipelines();
	const { appState, updateAppState, loaded } = useWorkspace() as {
		appState: { saved?: SavedRecipe[] } | undefined;
		updateAppState: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
		loaded: boolean;
	};

	const [view, setView] = useState<View>('ingest');
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
			try {
				let transcript = payload.text ?? '';
				let screenText: string | undefined;
				let scenes: string | undefined;
				let file = payload.file;
				let caption: string | undefined;

				if (payload.link) {
					setBusy('Checking the link');
					const outcome = await resolveMediaSource(payload.link);

					if (outcome.kind === 'unsupported') {
						throw new ResolveError('invalid-url', outcome.message);
					}

					if (outcome.kind === 'text') {
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
					setBusy('Reading the speech and on-screen text');
					const heard = await transcribe(file);
					transcript = heard.transcript;
					screenText = heard.screenText;

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
				const parsed = await extractRecipe(transcript, screenText, scenes);

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

				setRecipe(parsed);
				setSavedId(null);
				setView('recipe');
			} catch (err) {
				setError(errText(err));
			} finally {
				inFlight.current = false;
				setBusy(null);
			}
		},
		[describeFrames, extractRecipe, transcribe],
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
		if (!recipe || !fridge.trim() || inFlight.current) return;
		inFlight.current = true;
		setError(null);
		setBusy('Checking what you can swap');
		try {
			setSub(await checkFridge(recipe, fridge));
		} catch (err) {
			setError(errText(err));
		} finally {
			inFlight.current = false;
			setBusy(null);
		}
	}, [checkFridge, fridge, recipe]);

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
		const dish = sub?.alternative?.trim();
		if (!dish || !fridge.trim() || inFlight.current) return;
		inFlight.current = true;
		setError(null);
		setNotice(null);
		setBusy('Writing that recipe for what you have');
		try {
			const parsed = await cookAlternative(dish, fridge);
			if (!parsed.ingredients?.length && !parsed.steps?.length) {
				throw new Error('That suggestion could not be turned into a recipe. Try describing what you have in a bit more detail.');
			}
			setRecipe(parsed);
			setSub(null);
			setSavedId(null);
			setNotice(
				'This one is not from a video — it was written for what you said is in your kitchen. ' +
					'Every quantity is an estimate.',
			);
			setView('recipe');
		} catch (err) {
			setError(errText(err));
		} finally {
			inFlight.current = false;
			setBusy(null);
		}
	}, [cookAlternative, fridge, sub]);

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

	const alreadySaved = !!savedId && saved.some((sv) => sv.id === savedId);

	// -------------------------------------------------------------- rendering

	const menu = {
		entries: [
			{ id: 'ingest', label: 'New recipe' },
			{ id: 'recipe', label: 'Recipe' },
			{ id: 'cook', label: 'Cook' },
			{ id: 'book', label: 'My book', count: saved.length || undefined },
		],
	};

	return (
		<div style={s.scroll}>
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
					{busy && (
						<Banner variant={elapsed > SLOW_SECONDS ? 'warning' : 'info'}>
							{busy} — {elapsed}s{waitText(elapsed)}
						</Banner>
					)}

					{view === 'ingest' && (
						<IngestView
							busy={!!busy}
							pasted={pasted}
							setPasted={setPasted}
							onFiles={onFiles}
							onPaste={() => void runExtract({ text: pasted.trim() })}
							onLink={(link) => void runExtract({ link })}
						/>
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
							<CookView recipe={recipe} />
						) : (
							<EmptyState title="Nothing to cook yet" description="Build a recipe first." />
						))}

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
							onStart={() => go('ingest')}
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
	busy: boolean;
	pasted: string;
	setPasted: (v: string) => void;
	onFiles: (files: FileList) => void;
	onPaste: () => void;
	onLink: (link: string) => void;
}> = ({ busy, pasted, setPasted, onFiles, onPaste, onLink }) => {
	const [link, setLink] = useState('');
	const submitLink = () => {
		if (link.trim()) onLink(link.trim());
	};

	// Making someone choose the right box before they paste is friction for no
	// reason — we can tell a link from recipe text ourselves.
	const pastedIsLink = looksLikeLink(pasted);

	return (
		<div style={s.stack}>
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

			<Card header="Or paste the recipe text">
				<p style={{ ...s.muted, marginTop: 0 }}>
					The caption, a voice note, or your own scribbled notes. On Instagram, long-press
					the caption and hit copy — that is the fastest route.
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
		</div>
	);
};

// =============================================================================
// RECIPE
// =============================================================================

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
}

const RecipeView: React.FC<RecipeViewProps> = ({
	recipe,
	fridge,
	setFridge,
	sub,
	busy,
	onSubstitute,
	onCookAlternative,
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
				<div style={{ ...s.meta, marginBottom: 12 }}>
					{summarise(recipe) || 'The reel did not say how many it serves'}
				</div>

				{mostlyEstimated ? (
					<Banner variant="warning">
						The cook never gave amounts, so every quantity below is a sensible starting point
						rather than their recipe. Taste as you go.
					</Banner>
				) : recipe.confidence === 'low' ? (
					<Banner variant="warning">
						The reel was vague in places, so parts of this are inferred. Taste as you go.
					</Banner>
				) : null}

				<div style={s.sectionTitle}>Ingredients</div>
				{ingredients.length ? (
					ingredients.map((ing, i) => (
						<div key={i} style={s.ingRow}>
							<div style={s.ingName}>
								<span>{ing.item ?? '—'}</span>
								{ing.inferred && !mostlyEstimated && (
									<StatusBadge variant="warning">estimated</StatusBadge>
								)}
							</div>
							<div style={s.ingQty}>{ing.quantity ?? '—'}</div>
							{ing.note && <div style={s.ingNote}>{ing.note}</div>}
						</div>
					))
				) : (
					<p style={s.muted}>No ingredients could be read from this reel.</p>
				)}

				<div style={s.sectionTitle}>Method</div>
				{recipe.steps?.length ? (
					recipe.steps.map((st, i) => <StepRow key={i} step={st} index={i} />)
				) : (
					<p style={s.muted}>No steps could be read from this reel.</p>
				)}

				{!!recipe.missingInfo?.length && (
					<>
						<div style={s.sectionTitle}>The reel never said</div>
						<ul style={{ ...s.muted, margin: 0, paddingLeft: 18 }}>
							{recipe.missingInfo.map((m, i) => (
								<li key={i} style={{ marginBottom: 5 }}>
									{m}
								</li>
							))}
						</ul>
					</>
				)}
			</Card>

			<Card header="Cook it with what you have">
				<p style={{ ...s.muted, marginTop: 0 }}>
					Type what is in your kitchen. Rough is fine — &ldquo;some onions, half a lemon, the
					usual spices&rdquo;.
				</p>
				<textarea
					style={s.textarea}
					value={fridge}
					placeholder="onions, garlic, a tomato, yoghurt, rice, whatever spices came in the starter pack…"
					onChange={(e) => setFridge(e.target.value)}
				/>
				<div style={{ marginTop: 12 }}>
					<Button disabled={busy || fridge.trim().length < 3} onClick={onSubstitute}>
						Can I make this tonight?
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
					{sub.alternative && (
							<div style={{ ...s.doneWhen, marginTop: 14 }}>
								<strong>Instead: </strong>
								{sub.alternative}
								<div style={{ marginTop: 10 }}>
									<Button small disabled={busy} onClick={onCookAlternative}>
										Cook this instead
									</Button>
								</div>
							</div>
						)}
					</div>
				)}
			</Card>
		</div>
	);
};

const StepRow: React.FC<{ step: Step; index: number }> = ({ step, index }) => (
	<div style={s.stepRow}>
		<div style={s.stepNum}>{step.n ?? index + 1}</div>
		<div>
			<div style={{ ...s.row, justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
				<div style={{ ...s.stepText, flex: 1 }}>{step.instruction ?? ''}</div>
				{!!step.minutes && <div style={s.timeChip}>{step.minutes} min</div>}
			</div>
			{step.doneWhen && (
				<div style={s.doneWhen}>
					<strong>Ready when: </strong>
					{step.doneWhen}
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

const CookView: React.FC<{ recipe: Recipe }> = ({ recipe }) => {
	const steps = recipe.steps ?? [];
	const [index, setIndex] = useState(0);
	const [left, setLeft] = useState<number | null>(null);
	const tick = useRef<ReturnType<typeof setInterval> | null>(null);

	const step = steps[Math.min(index, steps.length - 1)];
	const total = (step?.minutes ?? 0) * 60;

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
			<p style={s.cookStep}>{step.instruction}</p>

			{step.doneWhen && (
				<div style={s.doneWhen}>
					<strong>Ready when: </strong>
					{step.doneWhen}
				</div>
			)}

			{!!step.minutes && (
				<div style={{ marginTop: 22 }}>
					<div style={s.row}>
						<span style={{ ...s.timer, color: left === 0 ? 'var(--rr-accent, #6b8afd)' : undefined }}>
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
}> = ({ loaded, saved, onOpen, onStart }) => {
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
						<Button variant="secondary" small onClick={() => onOpen(sv)}>
							Open
						</Button>
					}
				>
					<div style={s.meta}>
						{summarise(sv.recipe, `saved ${new Date(sv.savedAt).toLocaleDateString()}`)}
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
		<Content {...props} />
	</AppLayout>
);

export default App;
