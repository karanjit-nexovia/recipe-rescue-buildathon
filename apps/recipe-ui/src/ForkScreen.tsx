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
	onImprovise: () => void;
	busy: boolean;
}

export const ForkScreen: React.FC<ForkScreenProps> = ({
	missingCount,
	missingNames,
	onShop,
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
				Two ways forward, and neither of them is giving up.
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
					<h3>Cook with what I have</h3>
					<p>
						Swaps for what is missing where there are any — and if there are not, something
						else worth eating built from what is already in the kitchen.
					</p>
				</button>
			</div>
		</div>
	);
};
