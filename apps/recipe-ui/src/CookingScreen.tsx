// =============================================================================
// The transition screen.
//
// Its own module because it is not one screen — it is the screen that stands
// between every pair of steps in the flow. Reading a reel is the long one, but
// the same pan will cover working out a list, and whatever comes after that.
// Everything specific to a particular wait arrives as a prop; nothing about a
// recipe is known in here.
//
// Two minutes is a long time to hold someone on a form that has gone
// unavailable, which is what a banner over the ingest page amounts to. This
// takes the whole screen and shows the thing being made instead.
//
// The animation is the smaller half of it. The stage line and the counter are
// what actually stop a long wait reading as a hang, so they stay exactly as
// honest here as they were in the banner — the pan is what makes it bearable
// to sit and read them.
// =============================================================================

import React from 'react';

import { mmss, SLOW_SECONDS } from './format';

/**
 * What is in the pan.
 *
 * Each bit carries its own arc rather than sharing one: five things thrown
 * along an identical path read as one object drawn five times. The delays are
 * small and uneven for the same reason.
 */
const PAN_BITS: Array<{ dx: number; dy: number; delay: number; shape: React.ReactNode }> = [
	{ dx: -40, dy: -58, delay: 0, shape: <circle cx="102" cy="131" r="5.5" fill="var(--rx-gold)" /> },
	{
		dx: -18,
		dy: -72,
		delay: 70,
		shape: <rect x="114" y="125" width="10" height="10" rx="2" fill="var(--rx-gold-soft)" />,
	},
	{ dx: 2, dy: -78, delay: 130, shape: <circle cx="136" cy="130" r="4.5" fill="var(--rx-ink-soft)" opacity="0.5" /> },
	{
		dx: 24,
		dy: -70,
		delay: 55,
		shape: <rect x="146" y="127" width="14" height="7" rx="3.5" fill="var(--rx-gold)" />,
	},
	{ dx: 44, dy: -54, delay: 20, shape: <circle cx="170" cy="132" r="6" fill="var(--rx-gold-soft)" /> },
];

/**
 * How long this particular reel is going to take, said before it takes it.
 *
 * Every stage that reads a video scales with its length: the audio, and above
 * all the frame grab and OCR. 165 seconds was measured on a 38-second reel, and
 * a 62-second one runs past four minutes — which reads as a hang to anyone who
 * was told to expect two and a half minutes.
 *
 * Deliberately banded rather than a computed figure. The relationship is real
 * but it has been measured at exactly two lengths, and a confident "3:47" from
 * two data points is a worse lie than "around four minutes".
 */
export const durationNote = (seconds: number | null): string | null => {
	if (!seconds) return null;
	const len = `${Math.round(seconds)}-second reel`;
	if (seconds <= 45) return `A ${len}. These usually take about three minutes.`;
	if (seconds <= 90) return `A ${len} — longer than most. Expect four to five minutes.`;
	return `A ${len}, which is a long one. This will take five minutes or more.`;
};

/**
 * The account of how the run is going, as a standalone sentence.
 *
 * Null before 25 seconds: nothing has gone on long enough to need explaining,
 * and reassurance offered that early only plants the doubt it answers.
 */
export const waitNote = (elapsed: number): string | null => {
	if (elapsed <= 25) return null;
	if (elapsed <= SLOW_SECONDS) return 'Reading a reel properly takes a while. It has not stalled.';
	return 'This is longer than a reel normally takes. It will stop on its own if nothing comes back — or start again with the caption box, which is quick.';
};

export interface CookingScreenProps {
	/** What is being made. The one line that changes between transitions. */
	title: string;
	/** The live stage within that work — "Listening to the reel". */
	stage: string;
	/** Seconds since this wait began. */
	elapsed: number;
	/** Length of the reel being read, when there is one. Drives the estimate. */
	seconds?: number | null;
}

export const CookingScreen: React.FC<CookingScreenProps> = ({ title, stage, elapsed, seconds = null }) => {
	// What the work is going to cost gives way to how it is actually going, once
	// there is something to say about this run rather than about the reel.
	const note = waitNote(elapsed) ?? durationNote(seconds);

	return (
		<div className="rx-cooking rx-in">
			<svg
				className="rx-stove"
				viewBox="0 0 300 210"
				role="img"
				aria-label="A pan on the heat, tossing its ingredients"
			>
				{/* The burner and its heat, under everything. The flame tips stop
				    just short of the pan base so they read as licking it rather
				    than burning through it. */}
				<g>
					<path
						d="M98 203h68"
						stroke="var(--rx-ink-soft)"
						strokeWidth="3"
						strokeLinecap="round"
						opacity="0.26"
						fill="none"
					/>
					<path className="rx-flame" d="M116 201c-6-14 6-18 1-30 11 8 9 22-1 30z" fill="var(--rx-gold-soft)" />
					<path
						className="rx-flame rx-flame-2"
						d="M134 202c-7-17 7-22 1-36 13 10 11 26-1 36z"
						fill="var(--rx-gold)"
					/>
					<path
						className="rx-flame rx-flame-3"
						d="M152 201c-6-14 6-18 1-30 11 8 9 22-1 30z"
						fill="var(--rx-gold-soft)"
					/>
				</g>

				{/* The pan: line art, in the same ink as the type. */}
				<g
					className="rx-pan"
					fill="none"
					stroke="var(--rx-ink)"
					strokeWidth="2.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<ellipse cx="132" cy="126" rx="56" ry="12" />
					<path d="M76 126c2 30 30 42 56 42s54-12 56-42" />
					<path d="M188 122l68-19" strokeWidth="5" />
					<path d="M252 105l14-4" strokeWidth="7" stroke="var(--rx-ink-soft)" opacity="0.55" />
				</g>

				{/* Painted after the pan so the toss passes in front of its rim. */}
				<g>
					{PAN_BITS.map((bit, i) => (
						<g
							key={i}
							className="rx-bit"
							style={
								{
									'--dx': `${bit.dx}px`,
									'--dy': `${bit.dy}px`,
									animationDelay: `${bit.delay}ms`,
								} as React.CSSProperties
							}
						>
							{bit.shape}
						</g>
					))}
				</g>
			</svg>

			<h2>{title}</h2>
			<p className="rx-stage">{stage}</p>
			<p className={`rx-clock${elapsed > SLOW_SECONDS ? ' rx-warn' : ''}`}>{mmss(elapsed)}</p>
			{note && <p className="rx-reassure">{note}</p>}
		</div>
	);
};
