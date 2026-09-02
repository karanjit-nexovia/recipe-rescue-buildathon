// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/** RocketRide pipeline files — JSON with a .pipe extension (see the .pipe
 * rule in rsbuild.config.mts). Import one and pass it to
 * client.use({ pipeline }) — browser bundles cannot use filepath loading. */
declare module '*.pipe' {
	// Typed structurally as rocketride's PipelineConfig rather than as a bare
	// Record, because client.use({ pipeline }) requires `components` to be
	// statically present — a Record<string, unknown> does not prove that.
	const value: {
		components: {
			id: string;
			provider: string;
			config: Record<string, unknown>;
			ui?: Record<string, unknown>;
			input?: { lane: string; from: string }[];
			control?: { classType: string; from: string }[];
		}[];
		source?: string;
		project_id?: string;
		viewport?: { x: number; y: number; zoom: number };
		version?: number;
	};
	export default value;
}
