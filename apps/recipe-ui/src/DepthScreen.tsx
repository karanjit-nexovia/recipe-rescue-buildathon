// =============================================================================
// How deep to read.
//
// A recipe reel very often carries the entire recipe in its caption, and the
// resolver has already handed that caption over for free by the time this
// screen appears. Reading it is one model call and a few seconds. Reading the
// VIDEO means downloading it, listening to it, and usually reading the text
// burned into its frames as well — minutes of wall clock, and by a long way
// the most expensive thing this app does.
//
// So when the caption is substantial, the choice belongs to the person waiting
// rather than to a default they never saw. They get the first lines of the
// actual caption to judge by, which is the only honest basis for choosing: a
// caption that is really the recipe is obvious on sight, and so is one that
// says "recipe below 👇 follow for more".
//
// Offered ONLY when the caption is long enough to plausibly be a recipe. Below
// that the video is the only real option and a choice would be a false one.
// =============================================================================

import React from 'react';

export interface DepthScreenProps {
	/** The post's caption, already fetched. */
	caption: string;
	/** Reel length, when the resolver reported one. */
	seconds?: number;
	onCaption: () => void;
	onVideo: () => void;
	onBack: () => void;
}

/** Enough caption to plausibly be a recipe rather than a hook and a hashtag. */
export const CAPTION_ENOUGH = 400;

/**
 * Enough of the caption to judge it by.
 *
 * 180 characters was not: the first thing in a real recipe caption is often
 * the creator's promo — "the app link is in my bio", a run of hashtags — and
 * the recipe starts below it. Cutting there showed the advertisement and hid
 * the evidence. 320 clears the usual preamble on the posts measured here.
 */
const previewOf = (caption: string): string => {
	const flat = caption.replace(/\s+/g, ' ').trim();
	return flat.length > 320 ? `${flat.slice(0, 320)}…` : flat;
};

const videoEstimate = (seconds?: number): string => {
	if (!seconds) return 'a couple of minutes';
	if (seconds <= 45) return 'about three minutes';
	if (seconds <= 90) return 'four to five minutes';
	return 'five minutes or more';
};

export const DepthScreen: React.FC<DepthScreenProps> = ({
	caption,
	seconds,
	onCaption,
	onVideo,
	onBack,
}) => (
	<div className="rx-fork rx-in">
		<h2>This one comes with its recipe written out</h2>
		<p>
			The post has a {caption.trim().length.toLocaleString()}-character caption. That is often
			the whole recipe, and reading it takes seconds. Watching the video catches what the cook
			only said out loud — but it takes {videoEstimate(seconds)}.
		</p>

		<figure className="rx-caption-peek">
			<figcaption>From the post</figcaption>
			<blockquote>{previewOf(caption)}</blockquote>
		</figure>

		<div className="rx-ways">
			<button type="button" className="rx-way" onClick={onCaption}>
				<svg
					className="rx-way-icon"
					width="34"
					height="34"
					viewBox="0 0 34 34"
					fill="none"
					stroke="var(--rx-gold)"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M7 5h20v24H7z" />
					<path d="M12 12h10M12 18h10M12 24h6" />
				</svg>
				<h3>Read the caption</h3>
				<p>
					Seconds, not minutes. If the cook wrote the recipe out, everything is already
					here — and you can always run the video after.
				</p>
			</button>

			<button type="button" className="rx-way" onClick={onVideo}>
				<svg
					className="rx-way-icon"
					width="34"
					height="34"
					viewBox="0 0 34 34"
					fill="none"
					stroke="var(--rx-gold)"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<rect x="4" y="8" width="19" height="18" rx="2" />
					<path d="M23 15l7-4v12l-7-4z" />
				</svg>
				<h3>Watch the video</h3>
				<p>
					{videoEstimate(seconds)}. Reads the speech and the text on screen, so amounts the
					cook only said out loud still make it in.
				</p>
			</button>
		</div>

		<button type="button" className="rx-plain" onClick={onBack}>
			Use a different link
		</button>
	</div>
);
