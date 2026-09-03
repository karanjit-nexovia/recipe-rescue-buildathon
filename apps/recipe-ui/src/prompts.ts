// =============================================================================
// Prompt construction.
//
// These live in the app, not in the .pipe files, because the `prompt` node's
// `instructions` config is silently ignored on this platform — verified with a
// canary instruction that never reached the model. The Question object's
// role / addInstruction / addExample / expectJson path DOES work, and
// expectJson makes the server return an already-parsed object.
// =============================================================================

import type { Recipe } from './types';

/** Shown to the model as the shape to return. Doubles as documentation. */
const RECIPE_EXAMPLE = {
	title: 'Jeera Aloo',
	cuisine: 'North Indian',
	servings: 2,
	totalMinutes: 25,
	confidence: 'medium',
	ingredients: [
		{ item: 'Potatoes', quantity: '3 medium (about 400g)', inferred: false, note: 'diced small so they cook through' },
		{ item: 'Salt', quantity: '3/4 tsp', inferred: true, note: 'the cook said "to taste" — start here' },
	],
	// One component, so no group is set. A dish with a filling and a sauce would
	// carry group: 'For the filling' / 'For the sauce' on each line.
	steps: [
		{
			n: 1,
			instruction: 'Heat the oil over medium heat, then add the cumin seeds.',
			minutes: 2,
			doneWhen: 'the seeds sizzle and start popping, and smell toasty — not dark brown',
			activeTimer: false,
		},
	],
	missingInfo: ['The cook never said what size pan to use.'],
};

const SUBSTITUTION_EXAMPLE = {
	canCookTonight: false,
	verdict: 'Not tonight — you have no potatoes, and this dish is mostly potatoes.',
	lines: [
		{ item: 'Potatoes', status: 'missing', useInstead: '', tradeoff: 'This is the dish. There is no swap for it.' },
		{
			item: 'Fresh coriander',
			status: 'substitute',
			useInstead: 'spring onion greens',
			tradeoff: 'Sharper and less citrusy, but it does the same job as a finishing herb.',
		},
	],
	adjustedSteps: [],
	alternative: 'With the rice, yoghurt and peas you do have, you could make a quick pea pulao instead.',
};

/**
 * Build the Question that turns a transcript into a structured recipe.
 *
 * @param transcript  Spoken words from the reel (or text the user pasted).
 * @param screenText  On-screen text scraped from frames. Often carries exact
 *                    quantities the cook never says out loud.
 */
export function buildExtractionQuestion(
	Question: new (opts?: Record<string, unknown>) => QuestionLike,
	transcript: string,
	screenText?: string,
	scenes?: string,
): QuestionLike {
	const q = new Question({
		expectJson: true,
		role:
			'You are a cooking teacher for someone who has just moved out and is cooking ' +
			'for the first time. You turn cooking videos into recipes a nervous beginner ' +
			'can actually follow. You answer only with JSON.',
	});

	q.addQuestion(
		'Turn the transcript below into a structured recipe. It is the audio from a short cooking reel.',
	);

	q.addInstruction(
		'Restore what the cook skipped',
		'The person filming is an experienced home cook making a video for other experienced ' +
			'cooks, so they leave out whatever they consider obvious. Everything they left out is ' +
			'exactly what the person reading this needs. That gap is the whole job.',
	);

	q.addInstruction(
		'Never pass through a vague quantity',
		'Cooks say "thoda sa", "a little", "salt to taste", "andaza se". A beginner cannot act on ' +
			'those. Work out a concrete starting amount from the dish, the number of servings and ' +
			'the proportions you can see, put that concrete amount in quantity, and set inferred ' +
			'to true so the app can mark it as your estimate rather than the cook\'s instruction.',
	);

	q.addInstruction(
		'Every risky step needs a sensory cue',
		'Fill doneWhen with what the step looks, smells or sounds like when it is ready — ' +
			'"the edges pull away from the pan", "the raw smell of the garlic disappears". ' +
			'A beginner genuinely does not know what done looks like. Skip doneWhen only for ' +
			'steps that cannot go wrong, like chopping.',
	);

	q.addInstruction(
		'Order the steps for someone working alone',
		'Reorder into the sequence a single person should actually work in. Anything needing ' +
			'advance time — soaking, marinating, bringing to room temperature — becomes its own ' +
			'early step with its real elapsed minutes. Set activeTimer true only where a timer ' +
			'genuinely helps: simmering, resting, baking. Not chopping.',
	);

	q.addInstruction(
		'Write in English',
		'The transcript may be in Hindi, Telugu, Tamil, Urdu or a mix with English. Write every ' +
			'value in English, but keep the dish and ingredient names people actually use ' +
			'(jeera, haldi, dal) rather than translating them into something nobody says.',
	);

	q.addInstruction(
		'Extract, do not reconstruct',
		'You are reading ONE specific cook\'s version of a dish, not writing your own. If the ' +
			'source never names something, stay generic rather than inventing a specific: write ' +
			'"pasta" not "fettuccine", "onion or shallot" not "1 small onion", "oil" not "olive oil". ' +
			'Naming a specific the cook never mentioned is a factual error even when it sounds ' +
			'plausible — the user believes you are telling them what was in the video. Do not add ' +
			'ingredients or steps the source does not support just because the dish usually has them.',
	);

	q.addInstruction(
		'totalMinutes is your estimate, not the creator\'s claim',
		'Reels advertise times like "ready in 20 minutes" that are set by someone who has made ' +
			'the dish a hundred times, with everything already chopped. Our reader has not and ' +
			'has not. Put in totalMinutes the realistic wall-clock time from walking into the ' +
			'kitchen to sitting down, for a person cooking this for the first time — prep ' +
			'included, and slower than the video at every step that needs a knife. Do account for ' +
			'genuine overlap: if the pasta boils while the chicken sears, that is one stretch of ' +
			'time, not two, so totalMinutes is normally less than the sum of the steps. If the ' +
			'video states a time and yours differs, use yours and note the video\'s claim in ' +
			'missingInfo. A number the reader can plan dinner around is worth more than the ' +
			'creator\'s headline.',
	);

	q.addInstruction(
		'Never contradict your own missingInfo',
		'If you list something as unknown, no step may then assert a default about it. Writing ' +
			'"the video does not show whether pasta water was reserved" in missingInfo and then ' +
			'"drain it, reserve none" in a step is worse than useless — the reader follows the ' +
			'step and never reads the caveat. Where you genuinely do not know, either leave the ' +
			'step silent on that choice or name it inline as a choice.',
	);

	q.addInstruction(
		'When unsure, choose the reversible option',
		'If a standard technique may or may not have happened off-camera, write the step so the ' +
			'cook keeps their options. Reserving a cup of pasta water costs nothing and can be ' +
			'poured away; pouring it down the sink cannot be undone. Same for holding back a ' +
			'little seasoning, or removing a pan from the heat early. Favour the instruction that ' +
			'a beginner can still recover from.',
	);

	q.addInstruction(
		'Be honest about gaps, and about how much you are guessing',
		'Put anything you could not determine into missingInfo rather than inventing it. ' +
			'Set confidence by how much of this came from the source rather than from your own ' +
			'knowledge of the dish: "high" only when the source stated most quantities and steps ' +
			'itself; "medium" when you filled real gaps; and "low" whenever you are largely ' +
			'reconstructing a typical version of the dish from its name and a few visible cues. ' +
			'If the transcript is empty, unintelligible or not about cooking, return steps as an ' +
			'empty array and say so in missingInfo. Never invent a recipe from nothing.',
	);

	q.addInstruction(
		'Group ingredients by the part of the dish they belong to',
		'When a dish has distinct components — a filling and a sauce, a marinade and a salad — ' +
			'set group on every ingredient to the component it belongs to, phrased as the cook ' +
			'would say it: "For the kefta", "For the salad", "For the roasted garlic sauce". ' +
			'This matters most where the same ingredient appears more than once: garlic in the ' +
			'filling and again in the sauce is two lines with two amounts, and without a group ' +
			'the reader cannot tell which spoonful goes where. Keep an ingredient in exactly one ' +
			'group, ordered so the groups follow the order they are first used in the method. ' +
			'If the dish is a single simple thing, leave group off every ingredient rather than ' +
			'inventing one — a lone group heading over the whole list helps nobody.',
	);

	q.addInstruction(
		'The header is held to the same standard as the steps',
		'cuisine, servings and totalMinutes are claims too, and they are the first thing the ' +
			'reader sees. Omit any you cannot support from the source — an absent field is ' +
			'correct, and the page renders without it. Never state them while refusing the body: ' +
			'if you are returning no ingredients and no steps because there was nothing to read, ' +
			'then you do not know the cuisine, you do not know how many it serves, and you do not ' +
			'know how long it takes. Leave all three out. "serves 4" printed beside "no ' +
			'ingredients could be read" tells the reader the source said something about portions ' +
			'when it did not, and a beginner has no way to tell which half to trust.',
	);

	q.addExample('A reel about jeera aloo', RECIPE_EXAMPLE);

	// Many reels are silent, fast-cut and captionless. When that is all we
	// have, the frame descriptions ARE the source — say so explicitly, or the
	// model quietly falls back to writing a generic version of the dish.
	const silent = !transcript.trim() && !screenText?.trim();
	if (silent && scenes?.trim()) {
		q.addInstruction(
			'This reel has no words at all',
			'There is no speech and no on-screen text — only descriptions of what the frames ' +
				'show. Build the recipe from what is visibly happening: the ingredients that ' +
				'appear, the order they go in, the equipment, the visible state of the food. ' +
				'You will not be able to see exact amounts, so infer every quantity, mark them ' +
				'all inferred, and set confidence to low. Say plainly in missingInfo that this ' +
				'was read from pictures alone. Do NOT quietly write a generic version of the ' +
				'dish — describe the cooking you can actually see.',
		);
	}

	if (scenes?.trim()) {
		q.addContext(
			`WHAT THE VIDEO FRAMES SHOW (scene descriptions, sampled through the reel, in order):\n${scenes.trim()}`,
		);
	}
	if (screenText?.trim()) {
		q.addContext(
			`ON-SCREEN TEXT FROM THE VIDEO (often carries the exact quantities the cook never says aloud):\n${screenText.trim()}`,
		);
	}
	q.addContext(
		transcript.trim()
			? `TRANSCRIPT OF THE SPOKEN AUDIO:\n${transcript.trim()}`
			: 'TRANSCRIPT OF THE SPOKEN AUDIO:\n(none — the reel has no speech)',
	);

	return q;
}

/**
 * Build the Question for the dish suggested when the original was impossible.
 *
 * This one is different in kind from extraction, and the difference matters.
 * Every other recipe in this app is a reading of something a cook actually did
 * on camera. This one has no video behind it at all — it is the model writing a
 * recipe from its own knowledge of the dish, for the ingredients someone has
 * tonight. The app's whole promise is that the reader can tell what came from
 * the cook and what was inferred, so a recipe with no cook behind it has to say
 * so in the recipe itself, not merely in the UI that launched it.
 */
export function buildAlternativeRecipeQuestion(
	Question: new (opts?: Record<string, unknown>) => QuestionLike,
	dish: string,
	fridge: string,
): QuestionLike {
	const q = new Question({
		expectJson: true,
		role:
			'You are a cooking teacher for someone who has just moved out and is cooking ' +
			'for the first time. You write recipes a nervous beginner can actually follow, ' +
			'using only what they already have. You answer only with JSON.',
	});

	q.addQuestion(
		'Write a structured recipe for the dish described below, for someone cooking it tonight ' +
			'with only the ingredients listed in their kitchen.',
	);

	q.addInstruction(
		'Say plainly that this one did not come from a video',
		'Every other recipe this app produces is read from a cooking reel. This one is not: ' +
			'there is no video and no cook to quote, and you are writing it yourself. Make the ' +
			'FIRST entry of missingInfo say exactly that — this recipe was not taken from a ' +
			'video, it was written for the ingredients on hand — and set confidence to "low". ' +
			'The reader must never be unable to tell which kind of recipe they are looking at.',
	);

	q.addInstruction(
		'Use what they have, and say when something is assumed',
		'Build the dish from the listed ingredients. You may assume salt, oil, water and a few ' +
			'basic spices in any kitchen; assume nothing else. If you use something that was not ' +
			'listed, set inferred to true on that ingredient and note the assumption. Do not ' +
			'produce a recipe that needs a shop trip — the entire point is that this is what they ' +
			'can cook tonight.',
	);

	q.addInstruction(
		'Every quantity concrete, every risky step cued',
		'No "a little" and no "to taste": give a beginner a real starting amount, with inferred ' +
			'true since these are your numbers rather than a cook\'s. Fill doneWhen with what the ' +
			'step looks, smells or sounds like when it is ready. Keep it simple — this is a ' +
			'fallback dinner for someone who has already been told they cannot make what they ' +
			'wanted, not a project.',
	);

	q.addExample('A reel about jeera aloo', RECIPE_EXAMPLE);
	q.addContext(`THE DISH TO WRITE:\n${dish.trim()}`);
	q.addContext(`WHAT IS IN MY KITCHEN:\n${fridge.trim()}`);

	return q;
}

/** Build the Question that checks a recipe against what is in someone's kitchen. */
export function buildSubstitutionQuestion(
	Question: new (opts?: Record<string, unknown>) => QuestionLike,
	recipe: Recipe,
	fridge: string,
	/** Ticked in the ingredient list: confirmed present. Not a guess. */
	have: string[] = [],
	/** Left unticked: confirmed absent. Not a guess either. */
	lacking: string[] = [],
): QuestionLike {
	const q = new Question({
		expectJson: true,
		role:
			'You help a hungry student decide whether they can cook a specific dish tonight ' +
			'with only what is already in their kitchen. You answer only with JSON.',
	});

	q.addQuestion('Can I make this recipe tonight with what I have? Judge every ingredient.');

	q.addInstruction(
		'They are not going to the shop',
		'It is late and they are hungry. The only question that matters is whether this can be ' +
			'cooked right now with what is listed. Assume a poorly stocked first apartment: salt, ' +
			'oil and a few basic spices are probably around even if unmentioned. Assume nothing specialised.',
	);

	q.addInstruction(
		'Be honest about what a swap costs',
		'"Yoghurt instead of buttermilk — works, slightly thicker, add a splash of water" is ' +
			'useful. Pretending a substitution is free is not. If a swap meaningfully changes the ' +
			'dish, say so plainly in tradeoff. Status must be exactly one of: have, substitute, missing.',
	);

	q.addInstruction(
		'Never substitute the dish itself',
		'If the ingredient the dish is named after or built around is missing, set ' +
			'canCookTonight false and use alternative to name the closest thing they COULD make ' +
			'with what they have. That is far more useful than a technically complete but wrong recipe.',
	);

	q.addInstruction(
		'Lead with the answer',
		'verdict is one honest sentence to a hungry person — the answer first, not a preamble. ' +
			'Put a step in adjustedSteps only when its wording genuinely changes because of a ' +
			'substitution; otherwise leave adjustedSteps empty. Fill alternative only when ' +
			'canCookTonight is false. If the kitchen description is empty or unreadable, set ' +
			'canCookTonight false and use verdict to ask what they have, in one short sentence.',
	);

	q.addExample('Aloo jeera, but they have no potatoes', SUBSTITUTION_EXAMPLE);
	q.addContext(`THE RECIPE:\n${JSON.stringify(recipe)}`);

	// The ticks are the user telling us directly, item by item. Everything the
	// old free-text-only version had to infer — did "the usual spices" cover the
	// turmeric? — is now simply stated. Where a statement exists, guessing over
	// the top of it is strictly worse.
	if (have.length || lacking.length) {
		q.addInstruction(
			'The two lists below are facts, not hints',
			'The cook went down the ingredient list and marked each one. HAVE means it is in ' +
				'their kitchen; MISSING means it is not. Do not second-guess either list, do not ' +
				'move an item between them, and do not mark something missing as "have" because ' +
				'the dish would be easier that way. Set status to have for everything in HAVE. ' +
				'For each item in MISSING, decide whether something in HAVE or in the free-text ' +
				'note can stand in — status substitute with useInstead — or whether it genuinely ' +
				'cannot, which is status missing.',
		);
		if (have.length) q.addContext(`HAVE (confirmed present):\n${have.join('\n')}`);
		if (lacking.length) q.addContext(`MISSING (confirmed absent):\n${lacking.join('\n')}`);
	}

	q.addContext(
		fridge.trim()
			? `ALSO IN MY KITCHEN, beyond this recipe's ingredients:\n${fridge.trim()}`
			: 'ALSO IN MY KITCHEN:\n(they did not say — assume only basics like salt, oil and water)',
	);

	return q;
}

/** The subset of the SDK's Question we use. Declared locally so this module
 *  stays importable without a value import of the client bundle. */
export interface QuestionLike {
	addQuestion(text: string): void;
	addInstruction(title: string, instruction: string): void;
	addExample(given: string, result: string | object | unknown[]): void;
	addContext(context: string | object | string[] | object[]): void;
}
