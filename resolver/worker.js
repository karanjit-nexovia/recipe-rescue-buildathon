/**
 * Recipe Rescue — media resolver.
 *
 * Exists for one reason: Instagram reel metadata cannot be reached from a
 * browser (no CORS) or from a RocketRide pipeline (its HTTP tool truncates
 * responses to ~79 characters, far shorter than a CDN URL). This Worker holds
 * the Apify token, resolves a reel to metadata, and returns nothing else.
 *
 * It is deliberately NOT a proxy:
 *   - one route, one method
 *   - an allowlisted host and three known post shapes
 *   - video bytes never pass through it; the browser fetches the CDN directly
 *
 * Deploy:
 *   npx wrangler deploy
 *   npx wrangler secret put APIFY_TOKEN
 *
 * Configure (wrangler.toml):
 *   ALLOWED_ORIGINS = "https://staging.rocketride.ai"
 */

const APIFY_ENDPOINT =
	'https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items';

const APIFY_TIMEOUT_MS = 75_000;

/** Instagram signs CDN links for a few hours; assume less and re-resolve. */
const ASSUMED_MEDIA_TTL_MS = 60 * 60 * 1000;

function corsHeaders(request, env) {
	const allowed = (env.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);
	const origin = request.headers.get('Origin') ?? '';
	// Echo only a configured origin. Never reflect an arbitrary one.
	const allow = allowed.includes(origin) ? origin : allowed[0] ?? '';
	return {
		'Access-Control-Allow-Origin': allow,
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
}

function json(body, status, headers) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});
}

function fail(code, error, status, headers) {
	return json({ error, code }, status, headers);
}

/**
 * Accept only a single public Instagram post. Everything else is refused
 * before any outbound request, so this can never be used as an open proxy.
 */
function canonicaliseInstagram(raw) {
	if (typeof raw !== 'string' || !raw.trim()) return { error: 'Provide a url.', code: 'empty' };

	let url;
	try {
		url = new URL(raw.trim());
	} catch {
		return { error: 'That is not a valid URL.', code: 'invalid-url' };
	}
	if (url.protocol !== 'https:') return { error: 'Only https links are accepted.', code: 'invalid-url' };

	const host = url.hostname.replace(/^www\./i, '').toLowerCase();
	if (host !== 'instagram.com') return { error: 'Only Instagram links are supported here.', code: 'wrong-host' };

	const m = url.pathname.match(/^\/(reel|reels|p)\/([A-Za-z0-9_-]{5,32})\/?$/);
	if (!m) return { error: 'That is not a single reel or post URL.', code: 'not-a-post' };

	return { canonicalUrl: `https://www.instagram.com/reel/${m[2]}/`, shortcode: m[2] };
}

/** Apify field names drift between actors; accept the known aliases. */
function pick(item, names) {
	for (const n of names) {
		const v = item?.[n];
		if (typeof v === 'string' && v) return v;
		if (typeof v === 'number' && Number.isFinite(v)) return v;
	}
	return undefined;
}

async function callApify(canonicalUrl, token) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);
	try {
		const res = await fetch(APIFY_ENDPOINT, {
			method: 'POST',
			signal: controller.signal,
			headers: {
				// Header, never the query string — a token in a URL ends up in logs.
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				// The input is named `username` but accepts direct post URLs.
				username: [canonicalUrl],
				resultsLimit: 1,
				includeSharesCount: false,
				includeTranscript: false,
				includeDownloadedVideo: false,
			}),
		});
		return res;
	} finally {
		clearTimeout(timer);
	}
}

export default {
	async fetch(request, env) {
		const cors = corsHeaders(request, env);

		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
		if (request.method !== 'POST') return fail('method', 'Use POST.', 405, cors);
		if (new URL(request.url).pathname !== '/resolve-media') {
			return fail('not-found', 'Unknown route.', 404, cors);
		}
		if (!env.APIFY_TOKEN) {
			return fail('resolver-auth', 'The resolver is missing its API token.', 500, cors);
		}

		let body;
		try {
			body = await request.json();
		} catch {
			return fail('invalid-url', 'Send a JSON body of {"url": "..."}.', 400, cors);
		}

		const check = canonicaliseInstagram(body?.url);
		if (check.error) return fail(check.code, check.error, 400, cors);

		let res;
		try {
			res = await callApify(check.canonicalUrl, env.APIFY_TOKEN);
		} catch (err) {
			const timedOut = err?.name === 'AbortError';
			return fail(
				timedOut ? 'resolver-timeout' : 'network',
				timedOut ? 'Instagram took too long to respond. Try again.' : 'Could not reach the scraping service.',
				504,
				cors,
			);
		}

		if (res.status === 401 || res.status === 403) {
			// Never echo the upstream body — it can contain account details.
			return fail('resolver-auth', 'The resolver could not authenticate with its scraping service.', 502, cors);
		}
		if (!res.ok) {
			return fail('network', `The scraping service returned ${res.status}.`, 502, cors);
		}

		let items;
		try {
			items = await res.json();
		} catch {
			return fail('resolver-empty', 'The scraping service returned an unreadable response.', 502, cors);
		}
		if (!Array.isArray(items) || items.length === 0) {
			return fail(
				'private-or-deleted',
				'Nothing came back for that reel. It is probably private, deleted, or age-restricted.',
				404,
				cors,
			);
		}

		const item = items[0] ?? {};
		if (item.error || item.errorDescription) {
			return fail('private-or-deleted', 'That reel could not be read. It may be private or removed.', 404, cors);
		}

		const mediaUrl = pick(item, ['videoUrl', 'video_url', 'videoUrlHd']);
		const caption = pick(item, ['caption', 'text', 'title']);
		const durationSeconds = pick(item, ['videoDuration', 'duration']);

		if (!mediaUrl && !caption) {
			return fail('no-media', 'That reel returned neither a video nor a caption.', 404, cors);
		}

		const warnings = [];
		if (!mediaUrl) warnings.push('Only the caption was available for this reel — the video could not be read.');
		if (!caption) warnings.push('This reel has no caption, so the recipe comes entirely from the video.');

		// Sanitised only: no raw Apify payload, no token, no internal ids.
		return json(
			{
				platform: 'instagram',
				canonicalUrl: check.canonicalUrl,
				mediaUrl,
				caption,
				thumbnailUrl: pick(item, ['displayUrl', 'thumbnailUrl', 'imageUrl']),
				durationSeconds: typeof durationSeconds === 'number' ? durationSeconds : undefined,
				expiresAt: mediaUrl ? Date.now() + ASSUMED_MEDIA_TTL_MS : undefined,
				resolverConfidence: mediaUrl ? 'high' : 'low',
				warnings,
			},
			200,
			cors,
		);
	},
};
