// =============================================================================
// Two ways forward.
//
// Something is missing. That is not a failure state and it is not a dead end,
// so this screen does not apologise — it offers the two things a person
// standing in their kitchen at seven o'clock actually does about it: go and
// get the missing things, or cook something else with what is already there.
//
// The two arrive a beat apart. Offered together they read as a wall of
// buttons; offered in sequence they read as a choice.
// =============================================================================

import React from 'react';

export interface ForkScreenProps {
	/** How many ingredients are unticked. Named, not hidden. */
	missingCount: number;
	/** The first few missing things, so the choice is made on specifics. */
	missingNames: string[];
	onShop: () => void;
	onAdjust: () => void;
	onImprovise: () => void;
	busy: boolean;
}

export const ForkScreen: React.FC<ForkScreenProps> = ({
	missingCount,
	missingNames,
	onShop,
	onAdjust,
	onImprovise,
	busy,
}) => {
	const named = missingNames.slice(0, 3).join(', ');
	const more = missingCount - Math.min(3, missingNames.length);

	return (
		<div className="rx-fork rx-in">
			<h2>
				You are missing {missingCount} thing{missingCount > 1 ? 's' : ''}
			</h2>
			<p>
				{named ? `No ${named}${more > 0 ? `, and ${more} more` : ''}. ` : ''}
				Three ways forward, and none of them is giving up.
			</p>

			<div className="rx-ways">
				<button type="button" className="rx-way" onClick={onShop} disabled={busy}>
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
						<path d="M4 10h26l-3 18H7z" />
						<path d="M12 10a5 5 0 0 1 10 0" />
					</svg>
					<h3>Go and get them</h3>
					<p>
						A list of exactly what is missing, with the amounts, and the kind of shop that
						actually stocks it.
					</p>
				</button>

				{/* The middle road, and the one most people want: keep the dish,
				    change what goes in it. */}
				<button type="button" className="rx-way" onClick={onAdjust} disabled={busy}>
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
						<path d="M6 11h13" />
						<path d="M23 11h5" />
						<circle cx="21" cy="11" r="2.6" />
						<path d="M6 23h5" />
						<path d="M15 23h13" />
						<circle cx="13" cy="23" r="2.6" />
					</svg>
					<h3>Let us adjust</h3>
					<p>
						Same dish, different contents. What can be swapped, what cannot, and whether it
						still works without the thing you are short of.
					</p>
				</button>

				{/* The third road: a different dinner entirely. */}
				<button type="button" className="rx-way" onClick={onImprovise} disabled={busy}>
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
						<ellipse cx="17" cy="14" rx="12" ry="4" />
						<path d="M5 14c0 11 2 16 12 16s12-5 12-16" />
						<path d="M17 14l9-8" />
					</svg>
					<h3>Cook something mysterious</h3>
					<p>
						Forget this dish. Something else worth eating, written from what is already in
						your kitchen — you will not know what until it arrives.
					</p>
				</button>
			</div>
		</div>
	);
};
