#!/usr/bin/env bash
# Deploy the access service end to end, after `wrangler login` has been done once on this machine.
# One Worker, two names (README.md, "Two names"): beethoven-access, the default and the name in
# wrangler.toml (Beethoven 7.0.0 on, Beethoven for VS Code 4.0.0 on), and ashley-service, kept deployed
# with the same code because Ashley for VS Code 3.0.0 and Beethoven 4.0.0 to 6.0.0 know only that address.
# Both run the same code, bind the same three KV namespaces (the ids in wrangler.toml) and get the same
# secrets, so both answer from one approved list. The deploy workflow (.github/workflows/deploy.yml) deploys
# the code of both on every merge to main; this script is for what it does not do: a name's first deploy,
# the KV namespaces and the secrets.
#   bash deploy.sh                                   (beethoven-access)
#   WORKER_NAME=ashley-service bash deploy.sh        (the old name)
# Steps: the KV namespaces (the ids in wrangler.toml, checked against the account; created only on the very
# first deploy of the default name, never for another name), the Worker itself, the secrets (piped from
# files in the vendor folder, never on a command line), then, for the default name only, the five service
# addresses printed as the JSON the website's /beethoven/services.json carries. The website's repository
# owns that file and takes a changed address in a reviewed commit of its own; nothing here writes it, and
# /ashley/services.json is never touched: installed builds read it as it is.
# Files read from the vendor folder: keys/trial.pem (the trial signing key, read by trial-key.mjs, which
# refuses it unless its public key is the one interface/contract/signing-keys.json names; its
# passphrase, if it has one, in BEETHOVEN_VENDOR_PASSPHRASE), admin_token, decide_key and ip_salt (each made
# here when absent), notify_to (default go2432@wayne.edu), mail_from (default "Beethoven access
# <onboarding@resend.dev>"), and resend_api_key (optional: without it no e-mail is sent).
# The vendor folder is the first of: BEETHOVEN_VENDOR_DIR, ASHLEY_VENDOR_DIR (the old variable, still read),
# ~/.beethoven-vendor, ~/.ashley-vendor (the old folder, still read), ~/.beethoven-vendor (to be made);
# vendor.mjs has the same order.
#   bash deploy.sh            (Git Bash on Windows or any shell; needs node 22 and the vendor folder)
#   From WSL on the maintainer's machine (the Windows network path times out against Cloudflare):
#   BEETHOVEN_VENDOR_DIR=/mnt/c/Users/<you>/.beethoven-vendor PATH=$HOME/node22/bin:$PATH bash deploy.sh
# Re-running is safe: existing namespaces are reused, secrets are overwritten with the same values,
# the Worker is redeployed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${BEETHOVEN_VENDOR_DIR:-}" ]; then VENDOR="$BEETHOVEN_VENDOR_DIR"
elif [ -n "${ASHLEY_VENDOR_DIR:-}" ]; then VENDOR="$ASHLEY_VENDOR_DIR"
elif [ -d "$HOME/.beethoven-vendor" ] || [ ! -d "$HOME/.ashley-vendor" ]; then VENDOR="$HOME/.beethoven-vendor"
else VENDOR="$HOME/.ashley-vendor"; fi
DEFAULT_NAME="beethoven-access"
WORKER_NAME="${WORKER_NAME:-$DEFAULT_NAME}"
[[ "$WORKER_NAME" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || { echo "WORKER_NAME is lower-case letters, digits and dashes, like beethoven-access"; exit 2; }
strip() { tr -d '\r\n'; }
cd "$HERE"

# wrangler as .github/deploy/package-lock.json fixes it, the same tree the deploy workflow runs, installed into
# a folder of this run's own and removed with it: what holds the account's sign-in is the code on record, not
# whatever the registry serves that day (`npx wrangler@4` took the newest 4.x and its dependencies' ranges)
WDIR="$(mktemp -d)"
trap 'rm -rf "$WDIR"' EXIT
cp .github/deploy/package.json .github/deploy/package-lock.json "$WDIR/"
npm ci --prefix "$WDIR" --no-audit --no-fund >/dev/null
W() { "$WDIR/node_modules/.bin/wrangler" "$@"; }
# one secret for this Worker name, its value on stdin (never an argument)
S() { W secret put "$1" --name "$WORKER_NAME" >/dev/null; }

echo "== account"
W whoami | grep -E "Account Name|You are logged in|Account ID" | head -3 || { echo "not logged in: run  npx wrangler@4 login  first (the sign-in is the account's, not this folder's)"; exit 2; }

echo "== KV namespaces (bound by $WORKER_NAME)"
# a failed listing stops here: it must never be read as "no namespaces yet" and lead to new, empty ones
LIST=$(W kv namespace list 2>/dev/null) || { echo "  the account's KV namespaces could not be listed; nothing was created"; exit 3; }
printf '%s' "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{if(!Array.isArray(JSON.parse(s)))throw 0}catch{console.error("  the KV namespace listing is not a JSON list; nothing was created");process.exit(3)}})'
for B in TRIALS REPORTS ACCESS; do
  # the id wrangler.toml holds for this binding (the block order is TRIALS, REPORTS, ACCESS)
  CUR=$(node -e '
    const fs=require("fs");const [f,b]=process.argv.slice(1);const t=fs.readFileSync(f,"utf8");
    const m=new RegExp("binding = \""+b+"\"\\r?\\nid = \"([0-9a-f]*)\"").exec(t);console.log(m?m[1]:"")' wrangler.toml "$B")
  if [ -n "$CUR" ] && printf '%s' "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.exit(JSON.parse(s).some(x=>x.id===process.argv[1])?0:1))' "$CUR"; then
    echo "  $B = $CUR"
    continue
  fi
  if [ "$WORKER_NAME" != "$DEFAULT_NAME" ]; then
    echo "  $B: the id in wrangler.toml (${CUR:-none}) is not a namespace of this account. $WORKER_NAME binds the"
    echo "  namespaces $DEFAULT_NAME binds and none is ever created for it: deploy $DEFAULT_NAME first."
    exit 3
  fi
  # the first deploy of the default name: find the namespace by its title, or create it. wrangler names the
  # namespace after the binding ("TRIALS"); older versions prefixed the Worker name (ashley-service, the
  # default name when the namespaces were made)
  ID=$(printf '%s' "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const t=process.argv.slice(1);const m=a.find(x=>t.includes(x.title));console.log(m?m.id:"")}catch{console.log("")}})' "$B" "$DEFAULT_NAME-$B" "ashley-service-$B")
  if [ -z "$ID" ]; then
    OUT=$(W kv namespace create "$B" 2>&1) || { echo "$OUT"; exit 3; }
    ID=$(printf '%s' "$OUT" | grep -oE 'id = "[0-9a-f]+"' | head -1 | grep -oE '[0-9a-f]{16,}')
  fi
  [ -n "$ID" ] || { echo "no id for $B"; exit 3; }
  node -e '
    const fs=require("fs");const [f,b,id]=process.argv.slice(1);let t=fs.readFileSync(f,"utf8");
    const re=new RegExp("(binding = \""+b+"\"\\r?\\n)id = \"[^\"]*\"");
    if(!re.test(t)){console.error("binding "+b+" not found in wrangler.toml");process.exit(4)}
    fs.writeFileSync(f,t.replace(re,"$1id = \""+id+"\""));' wrangler.toml "$B" "$ID"
  echo "  $B = $ID (written into wrangler.toml)"
done

# The code goes first, then the secrets: a Worker name that does not exist yet is created by the deploy
# (a secret cannot be set on a Worker that does not exist), and until its secrets arrive every route that
# needs one refuses (503 or 401), which is safe. Each secret put deploys a new version with that secret.
echo "== deploy ($WORKER_NAME)"
# SERVICE_NAME tells each name which one it is: both run the daily cron, and only the one REMINDER_FROM
# (wrangler.toml) names sends the invitation reminder
OUT=$(W deploy --name "$WORKER_NAME" --var "SERVICE_NAME:$WORKER_NAME" 2>&1) || { echo "$OUT" | tail -20; exit 5; }
URL=$(printf '%s' "$OUT" | grep -oE "https://$WORKER_NAME\.[a-z0-9.-]+\.workers\.dev" | head -1)
[ -n "$URL" ] || { echo "$OUT" | tail -20; echo "no workers.dev address for $WORKER_NAME in the deploy output"; exit 5; }
echo "  $URL"
# the cron wrangler attached (the daily invitation reminder), as wrangler reports it
printf '%s\n' "$OUT" | grep -E "schedule:" | sed -E 's/^[[:space:]]*/  cron /' || echo "  no cron in the deploy output: check [triggers] in wrangler.toml"

echo "== secrets ($WORKER_NAME)"
# the key is read whole before wrangler starts, so a key that cannot be read sets no secret at all (a pipe
# would start wrangler at once and could hand it nothing); it is held in this shell only, never an argument
TK=$(BEETHOVEN_VENDOR_DIR="$VENDOR" node "$HERE/trial-key.mjs" --kid trial) || { echo "  the trial signing key could not be read, or is not the one installations trust (above); no secret was set"; exit 4; }
printf '%s' "$TK" | strip | S TRIAL_KEY_PKCS8_B64
unset TK
printf 'trial' | S TRIAL_KID
[ -s "$VENDOR/admin_token" ] || { umask 077; openssl rand -base64 32 | strip > "$VENDOR/admin_token"; }
strip < "$VENDOR/admin_token" | S ADMIN_TOKEN
# the salt that hashes a caller's address: kept in the vendor folder so both names hash an address the same
# way (the per-connection limits then count across both). Delete the file to start a new salt, then deploy
# both names; a new salt only restarts the day's per-connection counts.
[ -s "$VENDOR/ip_salt" ] || { umask 077; openssl rand -base64 32 | strip > "$VENDOR/ip_salt"; echo "  made $VENDOR/ip_salt"; }
strip < "$VENDOR/ip_salt" | S IP_SALT
echo "  TRIAL_KEY_PKCS8_B64, TRIAL_KID, ADMIN_TOKEN, IP_SALT set (GITHUB_TOKEN/GITHUB_REPO not set: requests are stored, no issue is opened)"
# requests by e-mail (README.md, "The request portal"): the key that signs the links in the e-mails (decisions, CV, confirmation) is made
# once and kept; the recipient and the sender have defaults; the Resend key is the maintainer's to add
[ -s "$VENDOR/decide_key" ] || { umask 077; openssl rand -base64 32 | strip > "$VENDOR/decide_key"; echo "  made $VENDOR/decide_key"; }
[ -s "$VENDOR/notify_to" ] || { printf 'go2432@wayne.edu' > "$VENDOR/notify_to"; echo "  made $VENDOR/notify_to (the default recipient)"; }
[ -s "$VENDOR/mail_from" ] || { printf 'Beethoven access <onboarding@resend.dev>' > "$VENDOR/mail_from"; echo "  made $VENDOR/mail_from (the default sender)"; }
strip < "$VENDOR/decide_key" | S DECIDE_KEY
strip < "$VENDOR/notify_to" | S NOTIFY_TO
strip < "$VENDOR/mail_from" | S MAIL_FROM
# The Resend key is checked before it is sent anywhere: a Resend API key begins with re_, and a random
# secret made by openssl (base64, which has no underscore) never does. Whatever is in RESEND_API_KEY goes
# to api.resend.com in a header with every request e-mail, so a wrong file (another secret copied there by
# mistake) must stop here rather than travel to Resend. The check reads the file on stdin, never argv.
if [ -s "$VENDOR/resend_api_key" ] && ! strip < "$VENDOR/resend_api_key" | grep -qE '^re_[A-Za-z0-9_-]{8,200}$'; then
  echo "  DECIDE_KEY, NOTIFY_TO, MAIL_FROM set. $VENDOR/resend_api_key is NOT a Resend API key (one begins"
  echo "  with re_), so it was not sent: no e-mail is sent until that file holds the key from resend.com, API Keys"
  echo "  (README.md, The request portal). Any key the Worker already holds is left in place."
elif [ -s "$VENDOR/resend_api_key" ]; then
  strip < "$VENDOR/resend_api_key" | S RESEND_API_KEY
  echo "  DECIDE_KEY, NOTIFY_TO, MAIL_FROM, RESEND_API_KEY set: each request is e-mailed to the address in notify_to"
else
  echo "  DECIDE_KEY, NOTIFY_TO, MAIL_FROM set; no $VENDOR/resend_api_key, so no e-mail is sent (README.md, The request portal)"
fi
# GROUP_MODE "workspace" only (README.md, "The private listing"): the service account key file Google gives
# (JSON, "type": "service_account", with domain-wide delegation for the group-member scope) and the Workspace
# administrator it acts for. Sent only when both files are there and the key file is such a key; the check
# reads the file on stdin. Nothing is sent while the lab has no Workspace, and GROUP_MODE "manual" ignores them.
if [ -s "$VENDOR/google_group_sa.json" ] && [ -s "$VENDOR/google_group_admin" ]; then
  if node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const k=JSON.parse(s);process.exit(k.type==="service_account"&&typeof k.client_email==="string"&&/BEGIN PRIVATE KEY/.test(k.private_key||"")?0:1)}catch{process.exit(1)}})' < "$VENDOR/google_group_sa.json"; then
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s))))' < "$VENDOR/google_group_sa.json" | S GROUP_SA_KEY
    strip < "$VENDOR/google_group_admin" | S GROUP_ADMIN_SUBJECT
    echo "  GROUP_SA_KEY, GROUP_ADMIN_SUBJECT set (used only while GROUP_MODE is \"workspace\")"
  else
    echo "  $VENDOR/google_group_sa.json is not a service account key file; GROUP_SA_KEY was not sent"
  fi
fi

sleep 3
curl -fsS "$URL/health" && echo
echo "  access_check: $URL/access_check"

if [ "$WORKER_NAME" != "$DEFAULT_NAME" ]; then
  echo "== services.json: nothing for $WORKER_NAME (/ashley/services.json on the website names it and stays as installed builds read it)"
else
  # the five service addresses, for both editions, on this host, as /beethoven/services.json carries them;
  # every other key there (the request and support pages) is the website's. No allowlist key: the approved
  # list is not published since 2026-10-01 (worker.js, GET /allowlist)
  echo "== services.json: the website's /beethoven/services.json carries these five addresses. When one differs"
  echo "   from what it has, the website's repository takes them in a reviewed commit; nothing here writes it:"
  node -e '
    const u=process.argv[1];const j={};
    for (const [k,r] of [["access_check","access_check"],["request","request"],["revocation","revoked"],["license_service","trial"],["report","report"]]) j[k]=u+"/"+r;
    console.log(JSON.stringify(j,null,2));' "$URL"
fi
echo "done: $WORKER_NAME at $URL"
