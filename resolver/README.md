# Recipe Rescue — media resolver

Resolves an Instagram reel URL to metadata. Holds the Apify token so the app
never sees it.

## Why this exists

Instagram reel data is unreachable from the app itself:

- **From the browser** — instagram.com sends no CORS headers, so a `fetch()`
  is refused before it can read anything.
- **From a RocketRide pipeline** — `tool_http_request` truncates response
  string values to about 79 characters. A signed Instagram CDN URL is over a
  thousand. `tool_python`, which could fetch and parse server-side, currently
  fails on staging with `FileNotFoundError: 'python3.10'` whenever
  `allowedModules` is set.

So the resolution step needs a server. Only that step: the CDN serves the MP4
with `Access-Control-Allow-Origin: *`, so the **browser downloads the video
directly** and no video bytes pass through this Worker.

## What it is not

One route, one method, one allowlisted host, three known URL shapes. Profile
pages, other hosts, raw IPs and localhost are all refused before any outbound
request. It cannot be used as a general proxy.

## Deploy

```bash
cd resolver
npx wrangler deploy
npx wrangler secret put APIFY_TOKEN     # paste the token when prompted
```

Get the token from **apify.com → Settings → Integrations → Personal API token**.
It is stored encrypted by Cloudflare and is never in this repo, the app bundle,
any `.pipe` file, or a log line.

Then set `ALLOWED_ORIGINS` in `wrangler.toml` if the app is served from
somewhere other than `staging.rocketride.ai`, and put the deployed Worker URL
into `RESOLVER_ENDPOINT` in `apps/recipe-ui/src/mediaSource.ts`.

## Contract

`POST /resolve-media` with `{"url": "https://www.instagram.com/reel/…/"}`

Returns sanitised metadata only — never raw scraper output:

```json
{
  "platform": "instagram",
  "canonicalUrl": "https://www.instagram.com/reel/ABC123/",
  "mediaUrl": "https://scontent…cdninstagram.com/…mp4?…",
  "caption": "…",
  "thumbnailUrl": "…",
  "durationSeconds": 42,
  "expiresAt": 1788400000000,
  "resolverConfidence": "high",
  "warnings": []
}
```

On failure: `{"error": "human-readable", "code": "machine-readable"}` with a
matching HTTP status. Codes line up with `ResolveErrorCode` in
`apps/recipe-ui/src/mediaSource.ts`.

## Cost

Apify's free tier covers roughly a few thousand reel resolutions a month.
Each resolve is one actor run. Video download is the browser's bandwidth, not
Apify's and not Cloudflare's.
