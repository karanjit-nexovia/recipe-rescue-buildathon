// =============================================================================
// Resolving a pasted link into something the existing media pipeline can eat.
//
// The app already has one working video path: a browser `File` handed to
// client.sendFiles(). Everything here exists to produce that File, or to fail
// in a way the user can act on. No second recipe pipeline.
//
// One provider is wired up:
//
//   youtube    the resolver returns the spoken transcript; oEmbed supplies the
//              title, which is where the dish's real name survives a phonetic
//              machine transcript.
//
// Adding a provider means adding one entry to PROVIDERS. Nothing downstream
// of resolveMediaSource() needs to know which platform it came from.
// =============================================================================

export type Platform = 'youtube' | 'unsupported';

/** Normalised result. Optional fields are genuinely optional per provider. */
export interface MediaSource {
	platform: Platform;
	originalUrl: string;
	canonicalUrl: string;
	/** Direct media URL to fetch. Absent when a provider only yields text. */
	mediaUrl?: string;
	audioUrl?: string;
	caption?: string;
	thumbnailUrl?: string;
	durationSeconds?: number;
	/** Epoch ms after which mediaUrl is expected to 403. CDN links are short-lived. */
	expiresAt?: number;
	resolverConfidence: 'high' | 'medium' | 'low';
	warnings: string[];
}

export type ResolveOutcome =
	/** A fetchable video: the good path, straight into the existing pipeline. */
	| { kind: 'media'; source: MediaSource }
	/** Text only — a caption or title. Better than nothing, worse than video. */
	| { kind: 'text'; source: MediaSource; text: string; thin: boolean }
	/** A link we recognise but cannot serve, kept typed so the UI can explain. */
	| { kind: 'unsupported'; platform: Platform; message: string };

export type ResolveErrorCode =
	| 'empty'
	| 'invalid-url'
	| 'wrong-host'
	| 'not-a-post'
	| 'not-configured'
	| 'private-or-deleted'
	| 'resolver-auth'
	| 'resolver-timeout'
	| 'resolver-empty'
	| 'no-media'
	| 'media-expired'
	| 'media-blocked'
	/** The browser refused the request before it reached the CDN — see fetchMediaAsFile. */
	| 'media-unreachable'
	| 'media-too-large'
	| 'not-video'
	| 'network';

export class ResolveError extends Error {
	readonly code: ResolveErrorCode;
	/** True when resolving again with a fresh URL is worth one attempt. */
	readonly retryable: boolean;

	constructor(code: ResolveErrorCode, message: string, retryable = false) {
		super(message);
		this.name = 'ResolveError';
		this.code = code;
		this.retryable = retryable;
	}
}

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/**
 * Server-side resolver that holds the Apify token. Deploy `resolver/worker.js`
 * and put its URL here. This endpoint is public by design — it validates and
 * proxies nothing but metadata — so it is not a secret and belongs in source.
 * The Apify token lives only as a Worker secret and never reaches this bundle.
 */
export const RESOLVER_ENDPOINT =
	'https://recipe-rescue-resolver.karanjit-singh.workers.dev/resolve-media';

/** Reels are short. A larger file is a wrong link or a trap. */
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
/** Anything longer is not a reel and will be slow and expensive to read. */
export const MAX_DURATION_SECONDS = 15 * 60;

const RESOLVER_TIMEOUT_MS = 90_000;
const MEDIA_TIMEOUT_MS = 120_000;

// -----------------------------------------------------------------------------
// URL handling
// -----------------------------------------------------------------------------

/** Params platforms bolt on for attribution; none of them identify the post. */
const TRACKING_PARAMS = /^(igsh|igshid|utm_|fbclid|gclid|si|feature|_r|_t|is_from_webapp|sender_device|web_id)/i;

function parseUrl(raw: string): URL {
	const trimmed = raw.trim();
	if (!trimmed) throw new ResolveError('empty', 'Paste a link first.');
	let url: URL;
	try {
		url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
	} catch {
		throw new ResolveError('invalid-url', 'That does not look like a link. Paste the full web address.');
	}
	if (url.protocol !== 'https:') {
		throw new ResolveError('invalid-url', 'Only https links are accepted.');
	}
	return url;
}

/** Drop tracking noise so the same post always canonicalises identically. */
function stripTracking(url: URL): URL {
	const out = new URL(url.toString());
	for (const key of [...out.searchParams.keys()]) {
		if (TRACKING_PARAMS.test(key)) out.searchParams.delete(key);
	}
	out.hash = '';
	return out;
}

export function detectPlatform(raw: string): Platform {
	let host: string;
	try {
		host = parseUrl(raw).hostname.replace(/^www\./i, '').toLowerCase();
	} catch {
		return 'unsupported';
	}
	if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
	return 'unsupported';
}

/** True for anything that looks like a URL, so one input box can serve both. */
export function looksLikeLink(raw: string): boolean {
	return /^\s*(https?:\/\/|www\.)\S+\s*$/i.test(raw);
}

// -----------------------------------------------------------------------------
// Providers
// -----------------------------------------------------------------------------

interface OEmbed {
	title?: string;
	author_name?: string;
	thumbnail_url?: string;
}

async function getJson(url: string, timeoutMs: number, init?: RequestInit): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { ...init, signal: controller.signal });
		if (res.status === 401 || res.status === 403) {
			throw new ResolveError('resolver-auth', 'The resolver rejected the request. Its API token may be missing or expired.');
		}
		if (res.status === 404) {
			throw new ResolveError('private-or-deleted', 'That post could not be found. It may be private, deleted, or the link may be wrong.');
		}
		if (!res.ok) {
			throw new ResolveError('network', `The resolver returned ${res.status}.`);
		}
		return await res.json();
	} catch (err) {
		if (err instanceof ResolveError) throw err;
		if ((err as Error)?.name === 'AbortError') {
			throw new ResolveError('resolver-timeout', 'Resolving that link took too long. Try again, or upload the video.', true);
		}
		throw new ResolveError('network', 'Could not reach the network. Check your connection and try again.');
	} finally {
		clearTimeout(timer);
	}
}

async function resolveYouTube(raw: string): Promise<ResolveOutcome> {
	const canonicalUrl = stripTracking(parseUrl(raw)).toString();

	if (!RESOLVER_ENDPOINT) {
		throw new ResolveError(
			'not-configured',
			'YouTube links need the resolver service, which is not configured yet. ' +
				'Paste the recipe text below, or save the video and drop it in.',
		);
	}

	const data = (await getJson(RESOLVER_ENDPOINT, RESOLVER_TIMEOUT_MS, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url: canonicalUrl }),
	})) as {
		title?: string;
		transcript?: string;
		durationSeconds?: number;
		resolverConfidence?: MediaSource['resolverConfidence'];
		warnings?: string[];
		error?: string;
		code?: ResolveErrorCode;
	};

	if (data?.error) throw new ResolveError(data.code ?? 'resolver-empty', data.error);

	const transcript = (data.transcript ?? '').trim();
	if (!transcript) {
		throw new ResolveError(
			'no-media',
			'That video has no captions to read, and YouTube does not allow the video itself to be ' +
				'downloaded here. Save the video and drop it in instead.',
		);
	}

	const source: MediaSource = {
		platform: 'youtube',
		originalUrl: raw,
		canonicalUrl,
		caption: data.title?.trim() || undefined,
		durationSeconds: data.durationSeconds,
		resolverConfidence: data.resolverConfidence ?? 'medium',
		warnings: data.warnings ?? [],
	};
	// A real read of what the cook said, so it is held to the same bar as any
	// other transcript rather than flagged thin on principle.
	//
	// 400 characters. A cook who talks through a whole recipe — what goes in,
	// how much, and what to watch for — produces 600-900 characters of speech;
	// the best measured run here was 839, and gave 21 ingredients and 11 steps
	// with cues on 10 of them. So a transcript under 400 is not a short video,
	// it is a cook who did not say much, and the recipe will lean on inference.
	//
	// This was briefly 250, to stop a banner firing on good Shorts. That was
	// treating the symptom: the banner was worth suppressing because its text
	// was wrong, not because the signal was. The text is fixed, so the bar goes
	// back where the evidence puts it.
	return { kind: 'text', source, text: transcript, thin: transcript.length < 400 };
}

function normalise(
	platform: Platform,
	originalUrl: string,
	canonicalUrl: string,
	data: Partial<MediaSource>,
): MediaSource {
	const warnings = [...(data.warnings ?? [])];
	if (data.durationSeconds && data.durationSeconds > MAX_DURATION_SECONDS) {
		warnings.push('That video is long, so reading it will take a while.');
	}
	return {
		platform,
		originalUrl,
		canonicalUrl,
		mediaUrl: data.mediaUrl,
		audioUrl: data.audioUrl,
		caption: data.caption,
		thumbnailUrl: data.thumbnailUrl,
		durationSeconds: data.durationSeconds,
		expiresAt: data.expiresAt,
		resolverConfidence: data.resolverConfidence ?? 'medium',
		warnings,
	};
}

const PROVIDERS: Record<Exclude<Platform, 'unsupported'>, (raw: string) => Promise<ResolveOutcome>> = {
	youtube: resolveYouTube,
};

/**
 * What is left of a caption once the parts that are never recipe text are
 * taken out of it.
 *
 * A social caption is conventionally a dish name, an @mention crediting
 * whoever the cook learned it from, and then five or six hashtags. Measured
 * raw, that clears the evidence bar on length alone — the Horchata post that
 * exposed this reads 97 characters, of which 61 are tags and a mention and 33
 * are the dish name. So the app spent a run on a caption with no recipe in it
 * and arrived at a dead end, which is the one outcome the evidence bar exists
 * to prevent.
 *
 * Stripping them is not the same as ignoring them: the full caption still
 * goes to the model as the title, where the dish's real name lives. This is
 * only about how much RECIPE there is to read.
 */
export function recipeEvidence(text: string): string {
	return text
		.replace(/[#@][\p{L}\p{N}_.]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The one entry point. Never throws for an unknown platform — returns a typed result. */
export async function resolveMediaSource(raw: string): Promise<ResolveOutcome> {
	const platform = detectPlatform(raw);
	if (platform === 'unsupported') {
		return {
			kind: 'unsupported',
			platform,
			message:
				'Links work for YouTube — a video or a Short. For anything else, go back and ' +
				'describe the dish, and I will write it.',
		};
	}
	return PROVIDERS[platform](raw);
}

// -----------------------------------------------------------------------------
// Media → File
// -----------------------------------------------------------------------------

/**
 * Download the resolved video and shape it exactly like a user-picked file, so
 * it enters the same `transcribe(file)` path as a manual upload.
 *
 * The CDN sends `Access-Control-Allow-Origin: *`, so this runs in the browser
 * with no proxy — the video bytes never touch our resolver.
 */
export async function fetchMediaAsFile(source: MediaSource, signal?: AbortSignal): Promise<File> {
	if (!source.mediaUrl) throw new ResolveError('no-media', 'There is no video to download for that link.');

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	signal?.addEventListener('abort', onAbort);
	const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);

	try {
		const res = await fetch(source.mediaUrl, { signal: controller.signal });

		// Signed CDN links expire; that is the one failure worth re-resolving for.
		if (res.status === 403 || res.status === 410) {
			throw new ResolveError('media-expired', 'That video link expired. Fetching a fresh one.', true);
		}
		if (!res.ok) {
			throw new ResolveError('media-blocked', `The video could not be downloaded (${res.status}).`, res.status >= 500);
		}

		const type = res.headers.get('content-type') ?? '';
		if (!/^video\//i.test(type) && !/octet-stream/i.test(type)) {
			throw new ResolveError('not-video', 'That link returned something that is not a video.');
		}
		const declared = Number(res.headers.get('content-length') ?? 0);
		if (declared > MAX_MEDIA_BYTES) {
			throw new ResolveError('media-too-large', `That video is ${Math.round(declared / 1e6)} MB — too large to read.`);
		}

		const blob = await res.blob();
		if (blob.size > MAX_MEDIA_BYTES) {
			throw new ResolveError('media-too-large', `That video is ${Math.round(blob.size / 1e6)} MB — too large to read.`);
		}
		if (blob.size < 1024) {
			throw new ResolveError('not-video', 'That video came back empty.');
		}

		const ext = /mp4/i.test(type) || !type ? 'mp4' : type.split('/')[1].split(';')[0];
		return new File([blob], `${source.platform}-reel.${ext}`, { type: type || 'video/mp4' });
	} catch (err) {
		if (err instanceof ResolveError) throw err;
		if ((err as Error)?.name === 'AbortError') {
			throw new ResolveError('resolver-timeout', 'Downloading that video took too long.', true);
		}
		// fetch() rejected before any response arrived, so there is no status to
		// report and the reason is deliberately hidden from us. In practice this
		// is the browser refusing the request, not the CDN: a tracker/ad blocker
		// or strict privacy mode dropping the media CDN is by far the most
		// common cause, since the CDN itself answers with
		// `Access-Control-Allow-Origin: *`.
		//
		// NOT retryable: re-resolving yields a different signed URL on the same
		// blocked host, so a retry fails identically after another actor run.
		// The caller falls back to the caption instead, which is the useful move.
		throw new ResolveError(
			'media-unreachable',
			'Your browser blocked the download from the video servers — usually an ad or tracker blocker.',
		);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}
