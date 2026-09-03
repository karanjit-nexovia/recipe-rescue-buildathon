// =============================================================================
// Shapes the pipelines return. Everything is optional on purpose: an LLM
// answer is data, not a contract, so the UI must render a partial recipe
// rather than crash on one missing field.
// =============================================================================

export interface Ingredient {
	item?: string;
	quantity?: string;
	/**
	 * Which component of the dish this belongs to — "For the kefta", "For the
	 * sauce". Absent on simple dishes that have only one component.
	 *
	 * Real recipes reuse an ingredient across components: garlic in the filling
	 * and again in the sauce, oil three times at three different amounts. Listed
	 * flat that reads as duplication, and a beginner cannot tell which spoonful
	 * belongs to which step. Grouped, it reads as the recipe it is.
	 */
	group?: string;
	/** True when the model inferred the amount from context rather than the
	 *  cook stating it. Shown differently so the user knows what to trust. */
	inferred?: boolean;
	note?: string;
}

export interface Step {
	n?: number;
	instruction?: string;
	minutes?: number;
	/** What it should look, smell or sound like when it is ready. */
	doneWhen?: string;
	/** Only true where a timer genuinely helps — not for chopping. */
	activeTimer?: boolean;
}

export interface Recipe {
	/**
	 * Where this recipe came from. 'reel' is a reading of a real video, which is
	 * every recipe the app extracts. 'kitchen' was written for the ingredients
	 * someone had on hand, with no cook and no video behind it.
	 *
	 * This lives on the Recipe rather than in component state so it survives
	 * being saved to the book and reopened weeks later — which is precisely when
	 * mistaking a written recipe for a read one would matter, and when whatever
	 * the screen said at the time is long gone.
	 */
	origin?: 'reel' | 'kitchen';
	title?: string;
	cuisine?: string;
	servings?: number;
	totalMinutes?: number;
	confidence?: 'high' | 'medium' | 'low';
	ingredients?: Ingredient[];
	steps?: Step[];
	missingInfo?: string[];
	/**
	 * Things an experienced cook would add that the reel never mentioned — the
	 * coriander at the end, the squeeze of lemon, the knob of butter.
	 *
	 * Kept OUT of ingredients and steps on purpose. Every other field is a
	 * reading of what the cook actually did, and quietly mixing suggestions into
	 * that would break the one promise the app makes: that you can tell what
	 * came from the video and what did not. These are offered, clearly labelled,
	 * and the recipe works without them.
	 */
	finishingTouches?: string[];
}

export interface SubLine {
	item?: string;
	status?: 'have' | 'substitute' | 'missing';
	useInstead?: string;
	tradeoff?: string;
}

export interface Substitution {
	canCookTonight?: boolean;
	verdict?: string;
	lines?: SubLine[];
	adjustedSteps?: { n?: number; instruction?: string }[];
	alternative?: string;
}

export interface SavedRecipe {
	id: string;
	savedAt: number;
	cookedCount: number;
	recipe: Recipe;
}
