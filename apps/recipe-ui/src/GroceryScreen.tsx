// =============================================================================
// The grocery run.
//
// The list fills itself in, one item at a time, then gets ticked off in the
// aisle. A tick here is the SAME tick as on the menu — it writes to the one
// record of what is in the kitchen — which is why walking out of the shop with
// everything lands on the same "you have it all" the menu would have.
//
// The list is frozen when this screen opens. Ticking marks an item as owned,
// which would otherwise remove it from the list of what is missing, and items
// vanishing as you buy them is not a shopping list.
//
// A NOTE ON WHAT THIS DOES NOT DO. There is no search here, and so there is no
// searching spinner. The app deliberately never asks for a location and never
// claims to know the nearest shop, its hours or its stock (see storeQuery in
// App.tsx) — it works out the KIND of shop that stocks what is missing and
// hands that to the maps app, which already knows where the user is and is
// allowed to. Animating a "finding shops near you" state over a lookup that
// never happens would be inventing a capability, and this app's whole pitch is
// that it does not do that.
// =============================================================================

import React from 'react';
import { Button } from 'shell';

export interface GroceryItem {
	index: number;
	item: string;
	quantity?: string;
	why?: string;
}

export interface GroceryScreenProps {
	items: GroceryItem[];
	/** Indices already in the kitchen — the same list the menu ticks. */
	doneIng: number[];
	onToggle: (index: number) => void;
	/** The kind of shop that stocks this, e.g. "Indian grocery store". */
	storeKind: string;
	/** Maps handoff for that kind of shop. */
	storeUrl: string;
	onBack: () => void;
	onDone: () => void;
	onShowRecipe: () => void;
}

/** Milliseconds between one item landing and the next. */
const STAGGER = 90;

export const GroceryScreen: React.FC<GroceryScreenProps> = ({
	items,
	doneIng,
	onToggle,
	storeKind,
	storeUrl,
	onBack,
	onDone,
	onShowRecipe,
}) => {
	const got = items.filter((it) => doneIng.includes(it.index)).length;
	const allGot = items.length > 0 && got === items.length;
	// The trailing block waits for the last item, so the screen finishes
	// assembling itself in one direction rather than filling in from both ends.
	const tail = items.length * STAGGER + 120;

	return (
		<div className="rx-grocery rx-in">
			<svg
				className="rx-scene"
				style={{ maxWidth: 132 }}
				viewBox="0 0 120 110"
				role="img"
				aria-label="A shopping basket"
			>
				<g
					fill="none"
					stroke="var(--rx-ink)"
					strokeWidth="2.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M14 38h92l-10 56H24z" />
					<path d="M40 38a20 20 0 0 1 40 0" />
				</g>
				{/* Fills as the basket does. */}
				<path
					d="M20 52h80l-8 38H28z"
					fill="var(--rx-gold-wash)"
					style={{
						clipPath: `inset(${items.length ? 100 - (got / items.length) * 100 : 100}% 0 0 0)`,
						transition: 'clip-path 260ms ease',
					}}
				/>
			</svg>

			<h2>{allGot ? 'That is the lot' : `${items.length - got} to pick up`}</h2>
			<p>
				{allGot
					? 'Everything the recipe asks for is in the basket.'
					: 'Tick each one as it goes in. These ticks are the same ones from the list — the app already knows what you had.'}
			</p>

			<div className="rx-slip">
				{items.map((it, i) => {
					const have = doneIng.includes(it.index);
					return (
						<div
							className={`rx-buy${have ? ' is-got' : ''}`}
							key={it.index}
							style={{ animationDelay: `${i * STAGGER}ms` }}
							role="checkbox"
							aria-checked={have}
							tabIndex={0}
							onClick={() => onToggle(it.index)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onToggle(it.index);
								}
							}}
						>
							<span className="rx-buy-box">{have ? '✓' : ''}</span>
							<span className="rx-buy-name">{it.item}</span>
							<span className="rx-buy-qty">{it.quantity ?? ''}</span>
							{it.why && <span className="rx-buy-why">{it.why}</span>}
						</div>
					);
				})}
				<div className="rx-slip-foot">
					{got} of {items.length} in the basket
				</div>
			</div>

			<div className="rx-where" style={{ animationDelay: `${tail}ms` }}>
				{allGot ? (
					<p className="rx-where-note">
						Nothing left to buy. The recipe is ready whenever you are.
					</p>
				) : (
					<p className="rx-where-note">
						Most of this comes from an <strong>{storeKind}</strong>. Your maps app knows which
						ones are near you — it has your location, and this app does not.
					</p>
				)}
				<div className="rx-actions">
					{allGot ? (
						<Button onClick={onDone}>I have got everything</Button>
					) : (
						<Button onClick={() => window.open(storeUrl, '_blank', 'noopener,noreferrer')}>
							Find one near me
						</Button>
					)}
					<Button variant="secondary" onClick={onShowRecipe}>
						Show me the recipe
					</Button>
					<Button variant="secondary" onClick={onBack}>
						Back
					</Button>
				</div>
			</div>
		</div>
	);
};
