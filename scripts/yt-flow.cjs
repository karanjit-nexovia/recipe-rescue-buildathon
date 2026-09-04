/**
 * The YouTube path, end to end, without a browser.
 *
 *   node scripts/yt-flow.cjs https://www.youtube.com/shorts/Wr-ylaHmBhY
 *
 * Resolves the link through the deployed Worker (Apify, no platform tokens),
 * builds the question with the app's OWN prompts.ts, and runs it through the
 * app's OWN ask.pipe on the development connection. That makes it a real test
 * of the real path rather than an approximation of it — the only thing it does
 * not exercise is the React layer.
 *
 * Costs one text run: measured at 14-19 platform tokens, against roughly 760
 * for a video run. Use it freely; that is the point of it.
 *
 * It compiles prompts.ts and parse.ts on the way through, into .tmp/ at the
 * repo root, which is gitignored.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const { ROOT, devClient, requireClient } = require('./lib.cjs');

const RESOLVER = 'https://recipe-rescue-resolver.karanjit-singh.workers.dev/resolve-media';
const LINK = process.argv[2] || 'https://www.youtube.com/watch?v=18gdBoDT0Rk';
const OUT = path.join(ROOT, '.tmp/prompt-build');

/** Compile the app's real prompt modules so this tests them, not a copy. */
function compilePrompts() {
	const tsc = path.join(ROOT, 'apps/recipe-ui/node_modules/.bin/tsc');
	execFileSync(
		process.platform === 'win32' ? `${tsc}.cmd` : tsc,
		['src/prompts.ts', 'src/parse.ts', '--outDir', OUT, '--module', 'commonjs',
		 '--target', 'es2020', '--skipLibCheck', '--esModuleInterop'],
		{ cwd: path.join(ROOT, 'apps/recipe-ui'), stdio: 'inherit' },
	);
}

const postJson = (url, body) =>
	new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = https.request(
			url,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(data),
					Origin: 'https://staging.rocketride.ai',
				},
			},
			(res) => {
				let out = '';
				res.on('data', (c) => (out += c));
				res.on('end', () => {
					try {
						resolve(JSON.parse(out));
					} catch {
						reject(new Error(`unparseable resolver reply (${res.statusCode})`));
					}
				});
			},
		);
		req.on('error', reject);
		req.write(data);
		req.end();
	});

(async () => {
	console.log('link:', LINK);
	compilePrompts();
	const { buildExtractionQuestion } = require(path.join(OUT, 'prompts.js'));
	const { extractJson, firstAnswer } = require(path.join(OUT, 'parse.js'));

	let t = Date.now();
	const resolved = await postJson(RESOLVER, { url: LINK });
	if (resolved.error) throw new Error(`resolver: ${resolved.code} — ${resolved.error}`);
	const transcript = (resolved.transcript || '').trim();
	const title = (resolved.title || '').trim();
	console.log(`resolve      ${Date.now() - t}ms | transcript ${transcript.length} chars`);
	console.log(`title        ${title || '(none)'}`);
	if (!transcript) throw new Error('no transcript — this video has no captions');

	const c = await devClient();
	const { Question } = requireClient();
	const pipeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/recipe-ui/src/ask.pipe'), 'utf8'));

	t = Date.now();
	const { token } = await c.use({ pipeline, useExisting: true, ttl: 120 });
	console.log(`use(ask)     ${Date.now() - t}ms`);

	// Exactly what App.tsx passes: the title rides along as corroboration,
	// because auto-captions mis-hear dish names and the title does not.
	const screenText = title
		? `VIDEO TITLE (typed by the cook, so more reliable than the machine transcript on any name):\n${title}`
		: undefined;

	t = Date.now();
	const result = await c.chat({
		token,
		question: buildExtractionQuestion(Question, transcript, screenText, undefined, 'reel'),
	});
	console.log(`extraction   ${Date.now() - t}ms`);

	const recipe = extractJson(firstAnswer(result));
	if (!recipe) throw new Error('the model returned nothing readable');

	const steps = recipe.steps || [];
	const ings = recipe.ingredients || [];
	console.log('\n--- recipe ---');
	console.log('title      :', recipe.title);
	console.log('cuisine    :', recipe.cuisine, '| serves', recipe.servings, '|', recipe.totalMinutes, 'min');
	console.log('ingredients:', ings.length, `(${ings.filter((i) => i.inferred).length} estimated)`);
	console.log('steps      :', steps.length, `(${steps.filter((s) => (s.doneWhen || '').trim()).length} with a cue)`);
	for (const s of steps.slice(0, 2)) console.log(`  ${s.n}. ${String(s.instruction).slice(0, 100)}`);

	// The app refuses anything with no method; mirror that verdict here.
	console.log('\nAPP WOULD ACCEPT IT:', steps.length > 0);

	await c.terminate(token).catch(() => undefined);
	process.exit(steps.length > 0 ? 0 : 1);
})().catch((e) => {
	console.error('FAILED:', (e && e.message) || e);
	process.exit(1);
});
