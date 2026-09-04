// =============================================================================
// The mystery pot.
//
// Shown while the model works out what can be made from what is actually in
// someone's kitchen. Unlike the grocery screen, there is real work behind this
// one — a call that takes the better part of a minute — so a loading animation
// here is honest rather than decorative.
//
// It is also the one screen in the app where the user genuinely does not know
// what is coming. They ticked a handful of things and asked what those could
// become; the answer is a dish nobody has named yet. The pot says that better
// than a spinner does.
// =============================================================================

import React from 'react';

import { mmss, SLOW_SECONDS } from './format';

/**
 * What is going round in the pot.
 *
 * `r` scales each one's orbit so they ride at different depths instead of
 * marching round in a single ring, and the negative delays spread them along
 * the path at the first frame rather than launching them from one point.
 */
const POT_BITS: Array<{ r: number; delay: number; dur: number; shape: React.ReactNode }> = [
	{ r: 1, delay: 0, dur: 4600, shape: <circle r="6" fill="var(--rx-gold)" /> },
	{ r: 0.72, delay: -1150, dur: 4600, shape: <rect x="-5" y="-5" width="10" height="10" rx="2" fill="var(--rx-gold-soft)" /> },
	{ r: 1.05, delay: -2300, dur: 5200, shape: <ellipse rx="8" ry="4.5" fill="var(--rx-gold-soft)" /> },
	{ r: 0.6, delay: -3450, dur: 4600, shape: <circle r="4.5" fill="var(--rx-ink-soft)" opacity="0.45" /> },
	{ r: 0.88, delay: -800, dur: 5200, shape: <rect x="-7" y="-3.5" width="14" height="7" rx="3.5" fill="var(--rx-gold)" /> },
];

export interface PotScreenProps {
	/** The live stage of the work behind this. */
	stage: string;
	/** Seconds since the wait began. */
	elapsed: number;
}

export const PotScreen: React.FC<PotScreenProps> = ({ stage, elapsed }) => (
	<div className="rx-pot-screen rx-in">
		<svg
			className="rx-scene"
			viewBox="0 0 300 240"
			role="img"
			aria-label="A large pot with its contents being stirred"
		>
			{/* Steam, drawn first so the pot rim covers where it starts. */}
			<g fill="none" stroke="var(--rx-ink-soft)" strokeWidth="2.2" strokeLinecap="round" opacity="0.5">
				<path className="rx-steam" d="M124 88c-7-9 7-13 0-23" />
				<path className="rx-steam rx-steam-2" d="M150 82c-8-11 8-15 0-26" />
				<path className="rx-steam rx-steam-3" d="M176 88c-7-9 7-13 0-23" />
			</g>

			{/* What is in it, riding round. Clipped to the pot mouth so a bit at
			    the front of its orbit cannot escape over the rim. */}
			<defs>
				<clipPath id="rx-pot-mouth">
					<ellipse cx="150" cy="118" rx="61" ry="17" />
				</clipPath>
			</defs>
			<g clipPath="url(#rx-pot-mouth)">
				<ellipse cx="150" cy="118" rx="61" ry="17" fill="var(--rx-gold-wash)" />
				{POT_BITS.map((bit, i) => (
					<g key={i} transform="translate(150 118)">
						<g
							className="rx-swirl"
							style={
								{
									'--r': String(bit.r),
									animationDelay: `${bit.delay}ms`,
									animationDuration: `${bit.dur}ms`,
								} as React.CSSProperties
							}
						>
							{bit.shape}
						</g>
					</g>
				))}
			</g>

			{/* The pot itself. */}
			<g
				fill="none"
				stroke="var(--rx-ink)"
				strokeWidth="2.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<ellipse cx="150" cy="118" rx="61" ry="17" />
				<path d="M89 118c0 46 8 72 61 72s61-26 61-72" />
				{/* Handles, one each side. */}
				<path d="M89 132c-13 0-19 7-19 15s6 14 15 14" />
				<path d="M211 132c13 0 19 7 19 15s-6 14-15 14" />
			</g>

			{/* The spoon, pivoting where it meets the pot. */}
			<g className="rx-spoon">
				<path
					d="M150 120l58-52"
					stroke="var(--rx-ink-soft)"
					strokeWidth="5"
					strokeLinecap="round"
					fill="none"
				/>
				<ellipse cx="211" cy="65" rx="9" ry="6" transform="rotate(-42 211 65)" fill="var(--rx-ink-soft)" />
			</g>
		</svg>

		<h2>Cooking up something mysterious</h2>
		<p className="rx-stage">{stage}</p>
		<p className={`rx-clock${elapsed > SLOW_SECONDS ? ' rx-warn' : ''}`}>{mmss(elapsed)}</p>
		<p className="rx-reassure">
			Working out what those ingredients can turn into. Whatever comes back is built from
			what is already in your kitchen — no shopping, nothing you have to go out for.
		</p>
	</div>
);
