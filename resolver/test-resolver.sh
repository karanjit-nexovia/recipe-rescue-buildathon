#!/usr/bin/env bash
#
# Resolver contract and security suite.
#
# Every case here is one the resolver must refuse before making an outbound
# request, or one shape it must accept. The security half matters more than the
# happy half: this service holds an API token, so a validation hole turns it
# into an open proxy funded by someone else's account.
#
# Usage:
#   ./test-resolver.sh                       # against the deployed Worker
#   ./test-resolver.sh http://127.0.0.1:8787 # against `wrangler dev --remote`
#
# The happy-path cases each cost one Apify actor run.

set -u

ENDPOINT="${1:-https://recipe-rescue-resolver.karanjit-singh.workers.dev}/resolve-media"
ORIGIN="https://staging.rocketride.ai"

pass=0
fail=0

# t <label> <url> <expected>
#   expected is either an error code, or "ok:<platform>" for a success.
t () {
	local label="$1" url="$2" expect="$3"
	local out code body got
	out=$(curl -s -X POST "$ENDPOINT" \
		-H "Content-Type: application/json" -H "Origin: $ORIGIN" \
		-d "{\"url\":\"$url\"}" -w "|%{http_code}")
	code="${out##*|}"
	body="${out%|*}"
	got=$(printf '%s' "$body" | python -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    print(d.get('code') or ('ok:' + str(d.get('platform'))))
except Exception:
    print('unparseable')
" 2>/dev/null)

	if [ "$got" = "$expect" ]; then
		printf 'PASS  %-34s %-22s [%s]\n' "$label" "$got" "$code"
		pass=$((pass + 1))
	else
		printf 'FAIL  %-34s got=%-18s want=%s [%s]\n' "$label" "$got" "$expect" "$code"
		fail=$((fail + 1))
	fi
}

echo "resolver: $ENDPOINT"
echo
echo "--- happy paths (one Apify run each) ---"
t "youtube short"       "https://youtube.com/shorts/18gdBoDT0Rk?si=wPjfYxuJLHj7_Wq7" "ok:youtube"
t "youtube watch"       "https://www.youtube.com/watch?v=18gdBoDT0Rk"                "ok:youtube"
t "youtu.be short form" "https://youtu.be/18gdBoDT0Rk"                               "ok:youtube"
t "instagram reel"      "https://www.instagram.com/reel/DS0sSPiEg2b/"                "ok:instagram"

echo "--- youtube rejections ---"
t "yt channel"          "https://www.youtube.com/@somechannel"                       "not-a-post"
t "yt playlist"         "https://www.youtube.com/playlist?list=PLabc"                "not-a-post"
t "yt bad id length"    "https://www.youtube.com/watch?v=short"                      "not-a-post"

echo "--- security boundary: refuse before any outbound request ---"
t "lookalike yt host"   "https://youtube.com.evil.co/watch?v=18gdBoDT0Rk"            "wrong-host"
t "lookalike ig host"   "https://instagram.com.evil.co/reel/ABC123/"                 "wrong-host"
t "raw ip"              "https://127.0.0.1/reel/ABC123/"                             "wrong-host"
t "localhost"           "https://localhost/reel/ABC123/"                             "wrong-host"
t "http not https"      "http://www.youtube.com/watch?v=18gdBoDT0Rk"                 "invalid-url"
t "ig profile url"      "https://www.instagram.com/someuser/"                        "not-a-post"
t "unknown host"        "https://vimeo.com/12345"                                    "wrong-host"
t "empty url"           ""                                                           "empty"

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
