// =============================================================================
// The front door.
//
// This is the only screen a stranger sees before deciding whether to bother,
// so it has one job beyond looking good: say what the app is FOR. Not "turns
// videos into recipes" — that is what it does. What it is for is the dish you
// ate a thousand times and never once made.
//
// The cloche is the whole idea in one object. It sits closed, it invites a
// touch, and what is under it is the thing you already know the taste of. It
// lifts on hover for the curious and on click for everyone else, because a
// hover-only reveal is a reveal that does not exist on a phone.
// =============================================================================

import React, { useState } from 'react';
import { Button } from 'shell';

/** Where each spark lands when the lid comes off. */
const SPARKS: Array<[number, number, number]> = [
	[-64, -30, 40],
	[-38, -52, 0],
	[-6, -60, 90],
	[26, -54, 30],
	[54, -34, 120],
	[74, -10, 60],
	[-80, -6, 150],
];

export interface WelcomeScreenProps {
	savedCount: number;
	onStart: () => void;
	onBook: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ savedCount, onStart, onBook }) => {
	const [open, setOpen] = useState(false);

	return (
		<div className="rx-welcome rx-in">
			<p className="rx-welcome-kicker">Recipe Rescue</p>
			<h1>Welcome to the journey of being a master chef</h1>

			{/* A button, not a div with a click handler: it is reachable by
			    keyboard, it announces its state, and on a phone a tap is the only
			    way this ever opens. */}
			<button
				type="button"
				className={`rx-reveal${open ? ' is-open' : ''}`}
				aria-pressed={open}
				aria-label={open ? 'Cover the dish' : 'Lift the lid'}
				onClick={() => setOpen((v) => !v)}
			>
				{/* The chef stands to the left and presents the platter to the right.
				    Stacked vertically — the first attempt — the cloche was as wide as
				    the figure and simply swallowed it: a hat sitting on a dome. Side
				    by side, neither hides the other, and the lid has empty air above
				    the platter to lift into. */}
				<svg viewBox="0 24 340 158" role="img" aria-hidden="true">
					{/* --- the chef --- */}
					<g
						fill="none"
						stroke="var(--rx-ink)"
						strokeWidth="2.4"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						{/* Toque: three puffs over a band. */}
						<path d="M92 62c-9 0-15-6-15-14s6-14 14-14c2-9 10-15 19-15s17 5 19 13c3-3 7-4 10-4 9 0 16 6 16 14s-7 14-16 14" />
						<path d="M90 62h60v15H90z" />
						{/* Head. */}
						<path d="M100 77v10c0 11 9 19 20 19s20-8 20-19V77" />
						{/* Shoulders. */}
						<path d="M92 129c7-6 17-9 28-9s21 3 28 9" />
						{/* The near arm, hanging. */}
						<path d="M92 129c-12 7-19 20-19 36" />
						{/* The far arm, out to the platter. */}
						<path d="M148 129c19 5 35 12 45 23" />
					</g>
					{/* The one gold thing on the figure. */}
					<path
						d="M108 121l12 10 12-10"
						fill="none"
						stroke="var(--rx-gold)"
						strokeWidth="2.6"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>

					{/* --- what is under the lid: revealed, so drawn first --- */}
					<g className="rx-dish">
						<g fill="none" stroke="var(--rx-ink-soft)" strokeWidth="2.2" strokeLinecap="round" opacity="0.5">
							<path className="rx-steam" d="M222 132c-7-9 7-13 0-23" />
							<path className="rx-steam rx-steam-2" d="M238 126c-8-11 8-15 0-26" />
							<path className="rx-steam rx-steam-3" d="M254 132c-7-9 7-13 0-23" />
						</g>
						<path d="M212 156c6-12 15-18 26-18s20 6 26 18z" fill="var(--rx-gold-wash)" />
						<circle cx="226" cy="150" r="4" fill="var(--rx-gold-soft)" />
						<circle cx="239" cy="145" r="4.5" fill="var(--rx-gold)" />
						<circle cx="252" cy="151" r="3.5" fill="var(--rx-gold-soft)" />
					</g>

					{/* Sparks, fired when it opens. */}
					<g className="rx-cloche-sparks">
						{SPARKS.map(([x, y, d], i) => (
							<circle
								key={i}
								className="rx-spark"
								cx="238"
								cy="150"
								r={i % 2 ? 2.5 : 3.5}
								fill={i % 3 === 0 ? 'var(--rx-gold)' : 'var(--rx-gold-soft)'}
								style={{ '--bx': `${x}px`, '--by': `${y}px`, animationDelay: `${d}ms` } as React.CSSProperties}
							/>
						))}
					</g>

					{/* --- the platter, in front of the dish --- */}
					<g
						fill="none"
						stroke="var(--rx-ink)"
						strokeWidth="2.6"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<ellipse cx="238" cy="158" rx="52" ry="8" fill="var(--rx-paper)" />
						<path d="M186 158c0 7 23 12 52 12s52-5 52-12" />
					</g>

					{/* --- the lid, over everything, lifting --- */}
					<g
						className="rx-cloche"
						fill="var(--rx-paper)"
						stroke="var(--rx-ink)"
						strokeWidth="2.6"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M194 158c0-25 20-45 44-45s44 20 44 45z" />
						<path d="M238 113v-8" stroke="var(--rx-ink)" />
						<circle cx="238" cy="100" r="5.5" fill="var(--rx-gold)" stroke="var(--rx-gold)" />
					</g>
				</svg>

				<span className="rx-reveal-hint">{open ? 'Cover it back up' : 'Lift the lid'}</span>
			</button>

			<p className="rx-welcome-line">
				{open
					? 'Cook something that takes you back — the dish you ate a thousand times and never once made.'
					: 'Send me a cooking reel, or just tell me what you want to eat. I will turn it into a recipe you can actually follow — real amounts, the right order, and what it should look like when it is ready.'}
			</p>

			<div className="rx-welcome-cta">
				<Button onClick={onStart}>Let us cook</Button>
				{savedCount > 0 && (
					<Button variant="secondary" onClick={onBook}>
						Open my book ({savedCount})
					</Button>
				)}
			</div>
		</div>
	);
};
