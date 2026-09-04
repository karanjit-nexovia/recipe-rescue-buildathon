/**
 * Where the app stands: versions, which one is serving, and what is left in
 * the budget. Read-only, costs nothing, safe to run at any time.
 *
 *   node scripts/status.cjs
 */
const { APP_ID, deployClient } = require('./lib.cjs');

(async () => {
	const c = await deployClient();

	const deployments = await c.listDeployments(APP_ID);
	console.log('--- versions (newest first) ---');
	for (const d of deployments.slice(0, 6)) {
		const when = new Date(Number(d.publishedAt) * 1000).toISOString().slice(0, 16).replace('T', ' ');
		const rungs = Array.isArray(d.rungs) && d.rungs.length ? d.rungs.join(',') : '-';
		console.log(
			`v${String(d.registryVersion).padStart(3)} | ${String(d.buildStatus).padEnd(6)} | ` +
				`${String(d.state).padEnd(8)} | ${when} | rungs ${rungs}`,
		);
	}
	console.log(`total: ${deployments.length}`);

	console.log('\n--- serving ---');
	for (const w of await c.whereApp(APP_ID)) {
		console.log(`${w.handle} (${w.rung}) -> v${w.version} [${w.state}]`);
	}

	// The number that governs every decision on this project.
	const info = await c.connect(process.env.ROCKETRIDE_DEPLOY_APIKEY);
	const orgId = info?.organization?.id;
	if (orgId) {
		const bal = await c.billing.getCreditBalance(orgId);
		const left = Number(bal?.balances?.tokens ?? 0);
		console.log('\n--- budget ---');
		console.log(`${left.toFixed(1)} tokens left of ${bal?.granted?.tokens ?? '?'}`);
		// Measured 2026-09-04: a full YouTube run costs 14-19 tokens; a video run
		// costs roughly 760, which is why video is paused. See README.
		console.log(`~${Math.floor(left / 18)} text runs, or ~${Math.floor(left / 760)} video runs`);
	}

	process.exit(0);
})().catch((e) => {
	console.error('FAILED:', (e && e.message) || e);
	process.exit(1);
});
