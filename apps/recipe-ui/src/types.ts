// =============================================================================
// Shapes the pipelines return. Everything is optional on purpose: an LLM
// answer is data, not a contract, so the UI must render a partial recipe
// rather than crash on one missing field.
// =============================================================================

export interface Ingredient {
	item?: string;
	quantity?: string;
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
