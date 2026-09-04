/**
 * Point an audience at a version that already exists. Repoint, never rebuild.
 *
 *   node scripts/publish.cjs 34            # roll @me back to v34
 *   node scripts/publish.cjs 36 @team/qa   # let a team see v36
 *
 * '@public' requires the version to have been approved; '@me' and '@team'
 * accept any version that built.
 */
const { APP_ID, deployClient } = require('./lib.cjs');

const version = Number(process.argv[2]);
const target = process.argv[3] || '@me';

(async () => {
	if (!Number.isInteger(version) || version <= 0) {
		console.error('Give a registry version: node scripts/publish.cjs 34 [@me|@team/<name>]');
		process.exit(1);
	}

	const c = await deployClient();

	const deployments = await c.listDeployments(APP_ID);
	const found = deployments.find((d) => Number(d.registryVersion) === version);
	if (!found) {
		console.error(`v${version} is not in the registry. Versions: ${deployments.map((d) => d.registryVersion).join(', ')}`);
		process.exit(1);
	}
	if (found.buildStatus !== 'ok') {
		console.error(`v${version} did not build (${found.buildStatus}) — it cannot serve.`);
		process.exit(1);
	}

	await c.publishApp(APP_ID, version, target);
	console.log(`${target} -> v${version}`);
	console.log('serving:', JSON.stringify(await c.whereApp(APP_ID)));
	process.exit(0);
})().catch((e) => {
	console.error('FAILED:', (e && e.message) || e);
	process.exit(1);
});
