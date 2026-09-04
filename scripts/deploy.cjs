/**
 * Ship the app: verify locally, deploy the next registry version, check the
 * build, then point the personal rung at it.
 *
 *   node scripts/deploy.cjs "what changed in this version"
 *
 * Deploying activates nothing on its own — publishing is what makes a version
 * serve, so both steps are here. Rolling back is a repoint and never a rebuild:
 *
 *   node scripts/publish.cjs 34
 */
const { APP_ID, APP_FOLDER, deployClient } = require('./lib.cjs');

const comment = process.argv.slice(2).join(' ').trim();

(async () => {
	if (!comment) {
		console.error('Give the version a comment: node scripts/deploy.cjs "what changed"');
		process.exit(1);
	}

	const c = await deployClient();

	// Purely local; no server call. Catches a broken manifest before anything
	// is uploaded.
	const check = await c.deploy.verifyApp(APP_FOLDER);
	console.log(`verify: ${check.ok ? 'ok' : 'FAILED'} | ${check.fileCount} files | ${check.uncompressedBytes} bytes`);
	for (const k of check.checks.filter((x) => !x.ok)) console.log(`  FAILED ${k.id} — ${k.note}`);
	if (!check.ok) process.exit(1);

	await c.deploy.addApp(APP_FOLDER, {
		comment,
		onProgress: (p) => console.log('  ', typeof p === 'string' ? p : JSON.stringify(p)),
	});

	const [latest] = await c.listDeployments(APP_ID);
	console.log(`deployed v${latest.registryVersion} | build ${latest.buildStatus}`);
	if (latest.buildStatus !== 'ok') {
		console.log((await c.buildLog(APP_ID, latest.registryVersion)).log.slice(-3000));
		process.exit(1);
	}

	await c.publishApp(APP_ID, latest.registryVersion, '@me');
	console.log('serving:', JSON.stringify(await c.whereApp(APP_ID)));
	process.exit(0);
})().catch((e) => {
	console.error('FAILED:', (e && e.message) || e);
	process.exit(1);
});
