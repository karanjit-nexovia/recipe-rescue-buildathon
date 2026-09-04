/**
 * Shared plumbing for the operator scripts.
 *
 * These run against the workspace .env, which is gitignored and never read by
 * anything here except to build a client. Nothing in scripts/ prints a
 * credential, and nothing writes one.
 */
const fs = require('fs');
const path = require('path');

/** Repo root, derived rather than hardcoded, so a clone works anywhere. */
const ROOT = path.resolve(__dirname, '..');

/** Load the workspace .env into process.env without adding a dependency. */
function loadEnv() {
	const file = path.join(ROOT, '.env');
	if (!fs.existsSync(file)) {
		throw new Error(
			'.env not found. The RocketRide editor writes it; open the workspace against a ' +
				'connection first.',
		);
	}
	for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
	}
}

function requireClient() {
	// Resolved from the app's node_modules: the client is vendored from the
	// connected server, never the npm registry.
	return require(path.join(ROOT, 'apps/recipe-ui/node_modules/rocketride'));
}

/**
 * A client on the DEPLOYMENT pair — deploy, publish, build logs, billing reads.
 * Its absence means no deploy target is configured, which is a stop, not a
 * thing to guess around.
 */
async function deployClient() {
	loadEnv();
	if (!process.env.ROCKETRIDE_DEPLOY_URI) {
		throw new Error('No deployment target configured — pick one in the editor.');
	}
	const { RocketRideClient } = requireClient();
	const c = new RocketRideClient({
		uri: process.env.ROCKETRIDE_DEPLOY_URI,
		auth: process.env.ROCKETRIDE_DEPLOY_APIKEY,
	});
	await c.connect(process.env.ROCKETRIDE_DEPLOY_APIKEY);
	return c;
}

/** A client on the DEVELOPMENT pair — run, validate, iterate. Never lifecycle. */
async function devClient() {
	loadEnv();
	const { RocketRideClient } = requireClient();
	const c = new RocketRideClient({
		uri: process.env.ROCKETRIDE_URI,
		auth: process.env.ROCKETRIDE_APIKEY,
	});
	await c.connect(process.env.ROCKETRIDE_APIKEY);
	return c;
}

const APP_ID = 'karanjit_singh.recipe';
const APP_FOLDER = './apps/recipe-ui';

module.exports = { ROOT, APP_ID, APP_FOLDER, loadEnv, requireClient, deployClient, devClient };
