// =============================================================================
// Small shared formatters and thresholds.
//
// These live apart from App.tsx only because the transition screen is its own
// module now and both need them. Nothing here knows anything about a recipe.
// =============================================================================

/** Seconds as m:ss. Used by the cook timer and by the transition screen. */
export const mmss = (secs: number): string => {
	const safe = Math.max(0, Math.round(secs));
	return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

/**
 * Past this, a run is slower than any measured reel and worth flagging.
 *
 * It is also the boundary for what may honestly be claimed about a run: "it has
 * not stalled" is a statement about the run's health, and past the point where
 * every stage should have finished or timed out, saying it is telling the user
 * something we do not know to be true.
 */
export const SLOW_SECONDS = 240;
