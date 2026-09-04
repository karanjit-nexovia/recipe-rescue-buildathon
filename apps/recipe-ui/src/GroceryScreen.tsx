// =============================================================================
// The grocery run.
//
// The list fills itself in, one item at a time, and then says where to go.
//
// A NOTE ON WHAT THIS DOES NOT DO. There is no search here, and so there is no
// searching spinner. The app deliberately never asks for a location and never
// claims to know the nearest shop, its hours or its stock (see storeQuery in
// App.tsx) — it works out the KIND of shop that stocks what is missing and
// hands that to the maps app, which already knows where the user is and is
// allowed to. Animating a "finding shops near you" state over a lookup that
// never happens would be inventing a capability, and this app's whole pitch is
// that it does not do that.
//
// So the motion here is a reveal, not a load: the items dropping in are the
// real missing ingredients arriving, and they take as long as the animation
// because the animation is all there is. Nothing is being waited on.
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
	/** The kind of shop that stocks this, e.g. "Indian grocery store". */
	storeKind: string;
	/** Maps handoff for that kind of shop. */
	storeUrl: string;
	onBack: () => void;
	onShowRecipe: () => void;
}

/** Milliseconds between one item landing and the next. */
const STAGGER = 90;

export const GroceryScreen: React.FC<GroceryScreenProps> = ({
	items,
	storeKind,
	storeUrl,
	onBack,
	onShowRecipe,
}) => {
	// The trailing block waits for the last item, so the screen finishes
	// assembling itself in one direction rather than filling in from both ends.
	const tail = items.length * STAGGER + 120;

	return (
		<div className="rx-grocery rx-in">
			<svg
				className="rx-scene"
				style={{ maxWidth: 150 }}
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
				<path d="M20 52h80l-8 38H28z" fill="var(--rx-gold-wash)" />
			</svg>

			<h2>{items.length} to pick up</h2>
			<p>Everything you did not tick, with the amount the recipe needs.</p>

			<div className="rx-basket-list">
				{items.map((it, i) => (
					<div className="rx-buy" key={it.index} style={{ animationDelay: `${i * STAGGER}ms` }}>
						<span className="rx-buy-dot" />
						<span className="rx-buy-name">{it.item}</span>
						<span className="rx-buy-qty">{it.quantity ?? ''}</span>
						{it.why && <span className="rx-buy-why">{it.why}</span>}
					</div>
				))}
			</div>

			<div className="rx-where" style={{ animationDelay: `${tail}ms` }}>
				<p style={{ fontSize: 13.5, color: 'var(--rx-ink-soft)', margin: '0 0 14px', lineHeight: 1.6 }}>
					Most of this comes from an <strong>{storeKind}</strong>. Your maps app knows which
					ones are near you — it has your location, and this app does not.
				</p>
				<div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
					<Button onClick={() => window.open(storeUrl, '_blank', 'noopener,noreferrer')}>
						Find one near me
					</Button>
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
