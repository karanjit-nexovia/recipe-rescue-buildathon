// =============================================================================
// Defensive parsing of model output.
// =============================================================================

/**
 * Pull a JSON object out of an LLM answer.
 *
 * The prompt asks for bare JSON, but models still wrap it in prose or a
 * markdown fence often enough that trusting the happy path means a demo that
 * dies in front of a judge. Try progressively looser strategies, and return
 * null rather than throwing so callers can show a real error state.
 */
export function extractJson<T>(raw: unknown): T | null {
	if (raw == null) return null;
	if (typeof raw === 'object') return raw as T;

	let text = String(raw).trim();
	if (!text) return null;

	// 1. Clean parse.
	try {
		return JSON.parse(text) as T;
	} catch {
		/* fall through */
	}

	// 2. Strip a markdown fence, with or without a language tag.
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence?.[1]) {
		try {
			return JSON.parse(fence[1].trim()) as T;
		} catch {
			text = fence[1].trim();
		}
	}

	// 3. Take the outermost balanced {...}, ignoring braces inside strings.
	const start = text.indexOf('{');
	if (start === -1) return null;
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (esc) {
			esc = false;
			continue;
		}
		if (ch === '\\') {
			esc = true;
			continue;
		}
		if (ch === '"') inStr = !inStr;
		if (inStr) continue;
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) {
				try {
					return JSON.parse(text.slice(start, i + 1)) as T;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

/** First answer out of a PIPELINE_RESULT, whatever shape it arrived in. */
export function firstAnswer(result: unknown): unknown {
	const r = result as Record<string, unknown> | null | undefined;
	if (!r) return null;
	const a = r.answers;
	if (Array.isArray(a)) return a[0];
	if (a != null) return a;
	// Fall back to result_types when the pipeline labelled its lane.
	const types = r.result_types as Record<string, string> | undefined;
	if (types) {
		for (const key of Object.keys(types)) {
			const v = r[key];
			if (Array.isArray(v) && v.length) return v[0];
			if (typeof v === 'string' && v) return v;
		}
	}
	return null;
}
