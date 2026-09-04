// =============================================================================
// Nothing is missing.
//
// The one branch out of the menu that needs no model call at all: if every
// ingredient is ticked, there is nothing to substitute and nothing to buy, so
// the app has no question left to ask. It costs nothing to say so, and it is
// the best news the app ever gets to deliver — so it gets a screen rather than
// a line of text on the way past.
//
// The sparks fire once and stop. Steam keeps going, because a kitchen with
// something on the hob is not finished, it is ready. A celebration that loops
// is a spinner.
// =============================================================================

import React from 'react';
import { Button } from 'shell';

/** Where each spark ends up. Uneven on purpose: an even fan reads as a gear. */
const SPARKS: Array<{ x: number; y: number; delay: number; r: number }> = [
	{ x: -74, y: -48, delay: 60, r: 3.5 },
	{ x: -44, y: -76, delay: 0, r: 2.5 },
	{ x: -12, y: -88, delay: 120, r: 4 },
	{ x: 26, y: -80, delay: 40, r: 3 },
	{ x: 58, y: -60, delay: 150, r: 3.5 },
	{ x: 82, y: -30, delay: 90, r: 2.5 },
	{ x: -88, y: -12, delay: 180, r: 3 },
	{ x: 92, y: 4, delay: 30, r: 3.5 },
];

export interface CelebrateScreenProps {
	/** The dish, when it has a name worth saying back. */
	title?: string;
	/** How many ingredients they confirmed. The reason this screen exists. */
	count: number;
	onShowRecipe: () => void;
}

export const CelebrateScreen: React.FC<CelebrateScreenProps> = ({ title, count, onShowRecipe }) => (
	<div className="rx-celebrate rx-in">
		<svg className="rx-scene" viewBox="0 0 300 210" role="img" aria-label="A finished bowl, steaming">
			{/* Fired once, from behind the bowl, outward. */}
			<g>
				{SPARKS.map((sp, i) => (
					<circle
						key={i}
						className="rx-spark"
						cx="150"
						cy="120"
						r={sp.r}
						fill={i % 3 === 0 ? 'var(--rx-gold)' : 'var(--rx-gold-soft)'}
						style={
							{
								'--bx': `${sp.x}px`,
								'--by': `${sp.y}px`,
								animationDelay: `${sp.delay}ms`,
							} as React.CSSProperties
						}
					/>
				))}
			</g>

			<g fill="none" stroke="var(--rx-ink-soft)" strokeWidth="2.2" strokeLinecap="round" opacity="0.5">
				<path className="rx-steam" d="M128 104c-7-9 7-13 0-23" />
				<path className="rx-steam rx-steam-2" d="M152 98c-8-11 8-15 0-26" />
				<path className="rx-steam rx-steam-3" d="M176 104c-7-9 7-13 0-23" />
			</g>

			{/* A mound of food in the bowl, so it reads as served rather than empty. */}
			<path d="M108 132c8-18 26-27 44-27s36 9 44 27z" fill="var(--rx-gold-wash)" />
			<circle cx="134" cy="122" r="4.5" fill="var(--rx-gold-soft)" />
			<circle cx="152" cy="115" r="5" fill="var(--rx-gold)" />
			<circle cx="170" cy="123" r="4" fill="var(--rx-gold-soft)" />

			<g
				fill="none"
				stroke="var(--rx-ink)"
				strokeWidth="2.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M100 132h100c-3 27-23 42-50 42s-47-15-50-42z" />
				<path d="M92 132h116" />
				{/* The table it is standing on. */}
				<path d="M78 182h144" stroke="var(--rx-ink-soft)" strokeWidth="2" opacity="0.35" />
			</g>
		</svg>

		<h2>Woohoo — let us get cooking</h2>
		<p>
			{title ? `Everything ${title} needs is already in your kitchen. ` : 'You have all of it. '}
			All {count} of them ticked, nothing to buy, nothing to swap. The only thing left is the
			cooking.
		</p>
		<Button onClick={onShowRecipe}>Show me how it is made</Button>
	</div>
);
