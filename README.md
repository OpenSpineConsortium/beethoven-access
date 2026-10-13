# beethoven-access

Beethoven's access, licence and report service: one Cloudflare Worker (`worker.js`, with `storage.js`
for lab storage) deployed under two names, `beethoven-access` and `ashley-service`. Until 2026-10-07 it
lived in Beethoven for VS Code's repository as `tools/intake`; since then it is a repository of its own,
which the others reach only over HTTP and through what `interface/INTERFACE.json` publishes.

Beethoven runs Claude Code and is not an Anthropic product; "Claude" and "Claude Code" are Anthropic's
marks, used here to say what it runs; "Open OnDemand" is the mark of its publisher.

**Who uses it.** Beethoven, the browser extension (`POST /access_check`); Beethoven for VS Code (keys
from `POST /trial`, the revocation list at `GET /revoked`, error reports at `POST /report`, and its
`publish.sh` at `POST /admin/revoke-lid`); hpcworker's `tools/grid_access.sh` (the two lists the grid
applies, `GET /admin/roster.txt` and `GET /admin/readers.txt`, read with the grid token or the admin
token); and the website (the request, lab storage and admin pages). What they code to is the contract in `interface/`
([interface/README.md](interface/README.md)): every route, the JSON Schemas of its requests and answers,
and vectors the real Worker answered.

**Testing.** `node --test test/*.test.mjs`: Node 22, nothing to install ([Tests](#tests)). CI runs the
same on every pull request and every push to `main` (`.github/workflows/ci.yml`).

**Deploying.** A change to `worker.js`, `storage.js` or `wrangler.toml` that lands on `main` is deployed
under both names by `.github/workflows/deploy.yml`, after the tests, once greg has saved its two
Cloudflare secrets in the environment `cloudflare`, which only `main` may use ([Deploying from
GitHub](#deploying-from-github)). `deploy.sh`, on the maintainer's machine, does what the workflow never
does: a name's first deploy, the KV namespaces, and the Worker's secrets, which come from the vendor folder
([Two names](#two-names)).

## What it does

One Cloudflare Worker (`worker.js`) gives Beethoven's two editions five things without a server to
keep: the list of approved AccessIDs (asked for from the website's request portal, with a Google
account, a purpose and an optional CV, e-mailed to the maintainer with three decision links, managed
from an admin page), keys issued in the student's own name to approved people (Beethoven for VS Code),
a yes-or-no approval check for one account from any of its installations (Beethoven, the browser extension,
which has no keys), error reports filed as issues in the private repository, and the published list of
withdrawn keys. It runs on the maintainer's own accounts (Cloudflare, GitHub, Resend for the e-mail);
no student credential other than the Microsoft sign-in token for a key ever reaches it, and that token
is used once, to ask Microsoft who the person is. Nothing here logs a token, an e-mail or an IP
address. The same code runs under two Worker names, `beethoven-access` and `ashley-service`
([Two names](#two-names)).

## Routes

| Route | Who calls it | What it does |
|---|---|---|
| `GET /allowlist` | nobody since 2026-10-01: Beethoven for VS Code read it while `services.json` named it (`beethoven.allowlistUrl`; `ashley.allowlistUrl` in 3.0.0, both empty by default) | an empty list, in the shape of the list Beethoven for VS Code bundles (`extension/media/allowlist.json` there) (`{"about":"The list of approved AccessIDs is not published; ...","accessIds":[]}`), open CORS, cached one minute. Until 2026-10-01 it gave every approved AccessID to anyone, which the browser edition's privacy statement (version 8) does not allow; the maintainer reads the list at `GET /admin/allowlist` |
| `POST /request` | the request page, `https://openspineconsortium.com/beethoven/request.html` (the browser edition's form sends `product: "bridge"`); `/ashley/request.html`, which older builds open, redirects there | a student asks for access: stored as pending with its CV, e-mailed to the maintainer with three decision links and a CV link (see [The request portal](#the-request-portal)), filed as an issue labelled `beethoven-access-request` when `GITHUB_TOKEN` is set; answers pending, approved or denied |
| `GET` and `POST /decide?t=<token>` | the links in the e-mails: Approve for Beethoven, Lab membership only, Deny; Withdraw approval (in the e-mail about a new installation); Done, invited (on the Approve page; until 2026-10-13 in the daily reminder too) | GET shows one question and one button; the button POSTs the decision. Each link acts only on the version of the request or notice e-mail it was sent for ([The link](#the-request-portal)); the Move link of the e-mails sent until 2026-10-11 answers out of date |
| `GET` and `POST /confirm?t=<token>` | the student's "Confirm it is you" link, when `MAIL_STUDENTS` is `"1"` | GET shows the request and one button; the button confirms it and sends it to the maintainer |
| `GET` and `POST /cv?t=<token>` | the CV link in the maintainer's e-mail | GET shows what the file is and one button; the button answers the file, once |
| `POST /storage_request` | the lab storage page, `https://openspineconsortium.com/beethoven/storage.html` | someone asks to read named folders of the lab's storage on the grid: stored as a storage request, e-mailed to the maintainer with an Approve read access and a Deny link ([Lab storage, read only](#lab-storage-read-only)); answers pending, approved (they read every folder asked for already) or denied |
| `GET` and `POST /storage_decide?t=<token>` | the two links in a lab storage e-mail | as `/decide`, for storage decisions only: GET asks, the button decides |
| `POST /trial` | Beethoven for VS Code (`beethoven.licenseServiceUrl`; `ashley.licenseServiceUrl` in 3.0.0) | a key for a signed-in person approved for Beethoven; three a day at most; the key's id is written to the approved record |
| `POST /access_check` | Beethoven (`access_check` in `https://openspineconsortium.com/beethoven/services.json`; 4.0.0 to 6.0.0 read `/ashley/services.json`) | is this one account approved, on this installation? Yes or no, from the same list; contract in [ACCESS_CHECK.md](ACCESS_CHECK.md) |
| `GET /revoked` | every installation, daily | the signed revocation list |
| `POST /report` | installations that allow error reports | an issue labelled `diagnostic-report`; repeats add a count |
| `/admin/*` | `https://openspineconsortium.com/beethoven/admin.html`, `admin.mjs`, the VS Code edition's `publish.sh` (`revoke-lid`) | `list`, `approve` (optional `grants`), `deny`, `add` (optional `grants`), `remove`, `invited`, `grant`, `seat`, `reset-seat`, `seat-rule`, `cv`, `revoke-lid`, `notify-test`, and for lab storage `storage-list`, `storage-approve`, `storage-deny`, `storage-add`, `storage-remove`, the two lists the grid reads as plain text, `roster.txt` and `readers.txt`, and the grid token: `grid-token` (`POST` makes one, replacing any earlier one, and answers it once; `GET` shows when it was made and last read) and `grid-token-withdraw`; behind the bearer token `ADMIN_TOKEN`. `roster.txt` and `readers.txt` also take the grid token, and nothing else does ([The grid token](#the-grid-token)). The admin page's contract (every field of `list` and `storage-list`, every write) is in [ACCESS_CHECK.md, "The admin routes"](ACCESS_CHECK.md#the-admin-routes-the-admin-pages-contract) |
| cron, `0 13 * * *` | Cloudflare, once a day | answered with nothing since 2026-10-13; until then the invitation reminder, one e-mail listing the approvals for Beethoven not marked invited to the Google Group Beethoven-users after an hour ([The store listing](#the-store-listing)) |
| `GET /health` | you | `{"ok":true}` |

## Two names

Both editions are called Beethoven since 2026-09-30: the browser extension (it was Ashley Bridge, and
Beethoven since 2026-09-29) and Beethoven for VS Code (it was Ashley). So the one Worker answers at two
addresses:

| Worker name | Address | Who calls it |
|---|---|---|
| `beethoven-access` (the name in `wrangler.toml`, the default of `deploy.sh`) | `https://beethoven-access.openspineconsortium.workers.dev` | Beethoven 7.0.0 on and Beethoven for VS Code 4.0.0 on, through `https://openspineconsortium.com/beethoven/services.json`, which names this host for every route |
| `ashley-service` | `https://ashley-service.openspineconsortium.workers.dev` | the builds made before the rename, which know only this address: Ashley for VS Code 3.0.0 (its `services.json` at `/ashley/`, its settings), and Beethoven 4.0.0 to 6.0.0, built as Ashley Bridge and reading `/ashley/services.json` |

Why two names and not a rename: a Worker's `workers.dev` address is its name, and the builds that
already exist know only the old address; renaming would cut them off. Keeping only the old address
would leave the old name in the privacy texts and in front of every store reviewer. A route on the
site's own domain is not available either: the domain's DNS is at Spaceship, not Cloudflare. A second
Worker name for the same code costs nothing and keeps both. `ashley-service` stays deployed until no
build older than Beethoven 7.0.0 and Beethoven for VS Code 4.0.0 is left.

What makes them one service: the same `worker.js`, the same `wrangler.toml` vars, the same three KV
namespaces (the ids in `wrangler.toml`; none is ever created for a name other than the default), and
the same secrets, all from files in the vendor folder, `IP_SALT` included (`ip_salt`), so an address is
hashed the same way by both and the per-connection limits count across both. An approval, a removal or
a withdrawn key is seen by both at once (within KV's minute). The one difference is `SERVICE_NAME`,
which `deploy.sh` gives each name (its own name): both run the daily cron, answered with nothing since
2026-10-13 (until then only the name `REMINDER_FROM` in `wrangler.toml`, `beethoven-access`, sent the
invitation reminder, whose links pointed at `SERVICE_ORIGIN`, the same host; both vars stay, read by
nothing). The Approve and Deny links in an e-mail
carry the host the request was posted to, and either host decides them. The browser edition still
sends `product: "bridge"` on the wire, so 4.0.0 to 7.0.0 are one product to the service, and the VS
Code edition's 3.0.0 sent `ashley`; the e-mail calls them Beethoven and Beethoven for VS Code.

**The key prefixes.** Keys from `/trial` are signed `ASHLEY1.` and the list at `/revoked` `ASHLEYREV1.`,
the spellings every installed build accepts; Beethoven 8.0.0, Beethoven for VS Code 4.0.0 and grid
scripts 7 also accept `BEETHOVEN1.` and `BEETHOVENREV1.`. The variable `KEY_PREFIX` in `wrangler.toml`
(`ashley`, or `beethoven`) chooses what the service signs; the vendor tool's `--prefix` does the same
for keys and lists signed by hand. Flip either only after every installed build older than Beethoven
8.0.0 and Beethoven for VS Code 4.0.0 is retired. The payload's `product` field stays `ashley`: every
verifier checks it, and none shows it.

Deploy both whenever `worker.js` or `wrangler.toml` changes (since 2026-10-07 GitHub does this on every
merge, once two secrets are saved: [Deploying from GitHub](#deploying-from-github)):

```
cd beethoven-access                             # this repository's checkout; from WSL on the maintainer's machine
export BEETHOVEN_VENDOR_DIR=/mnt/c/Users/grego/.beethoven-vendor PATH=$HOME/node22/bin:$PATH
bash deploy.sh                                  # beethoven-access, then the five addresses services.json carries
WORKER_NAME=ashley-service bash deploy.sh       # the old name: same KV ids, same secrets
```

On the first, `deploy.sh` prints the five service addresses (`access_check`, `request`, `revocation`,
`license_service`, `report`) as the JSON the website's `/beethoven/services.json` carries. That file is the
website's: when an address in it differs, the website's repository takes the new one in a reviewed commit
of its own. Nothing here writes it, nor `/ashley/services.json`, which installed builds read as it is (it
names `ashley-service`). `admin.mjs` takes the address from `BEETHOVEN_SERVICE_URL`, else
`beethoven-access` (`service.mjs`); either name would do, since both hold the same records.

## Deploying from GitHub

greg's decision of 2026-10-07: `.github/workflows/deploy.yml` deploys the service whenever a change to
`worker.js`, `storage.js`, `wrangler.toml` (or to the workflow or its tool's lock) lands on `main`, and
when started by hand from the Actions tab (main's code only). One run at a time on `main`, never cancelled
midway; a run started by hand on another branch runs the tests only and never takes the place of a run
waiting on `main`. It runs the tests first (`node --test test/*.test.mjs`) and deploys nothing if they
fail; then it does what `deploy.sh` does with the code and nothing else: `wrangler deploy --name
beethoven-access --var SERVICE_NAME:beethoven-access`, a check that `/health` on the address the deploy
printed answers `{"ok":true}`, and the same for `ashley-service` (both names run the same code, [Two
names](#two-names)). A re-run keeps the commit of the run it repeats (GitHub's rule), so before it deploys
the job compares the Worker's three files with what `main` holds now and skips, with a note in the run's
summary, when `main` has newer code: re-running an old run never puts older code back. When a deploy fails
after `beethoven-access` took the new code, the two names run different code until a run deploys both; the
run's summary says so, and re-running the failed job is the fix.

wrangler comes from `.github/deploy/package-lock.json`, which npm made and which names every package it
installs by hash, so the code that holds the token is the code on record (wrangler 4.148.0 since
2026-10-07). To raise it: change the version in `.github/deploy/package.json` and run `npm install
--package-lock-only` in that folder. The two actions the workflows use, `actions/checkout` and
`actions/setup-node`, are pinned to a commit with the version beside it.

`.github/workflows/ci.yml` runs the same tests, and `bash -n` on the two shell scripts, on every pull
request and every push to `main`. It reads no secret and deploys nothing.

It needs two secrets of the environment `cloudflare`, which greg makes and fills under Settings,
Environments: **New environment** `cloudflare`, **Deployment branches and tags** set to selected branches
with the one rule `main`, no reviewers (a merge deploys with no click), and the two environment secrets:

| Secret | What |
|---|---|
| `CLOUDFLARE_API_TOKEN` | a Cloudflare API token limited to Workers, made from Cloudflare's "Edit Cloudflare Workers" template (as Cloudflare listed it on 2026-10-07: Workers Routes Write, Workers Scripts Write, Workers KV Storage Write, Workers Tail Read, Workers R2 Storage Write, Account Settings Read, User Details Read, User Memberships Read), with Account Resources limited to the one account that holds the Workers; whether a smaller custom token deploys is not yet measured. Limited is not small: whoever holds it can put any code under the two names, and that code runs with everything the service holds, its secrets (the admin token, the trial signing key, the decision key, the mail key) and its records (the approved list, and the readers list the grid turns into read access on the lab volume). A token that cannot list the account's KV namespaces, or lists them without the three `wrangler.toml` binds (the token or the account id is another account's), is refused by the deploy job before anything is deployed, with the likely causes in the run's summary (the first run that reached Cloudflare, 2026-10-07, failed at the deploy itself with Cloudflare's error 10041, "KV namespace not found", before this check existed, and nothing was deployed; with a token remade from the template, the check and both deploys passed the same day) |
| `CLOUDFLARE_ACCOUNT_ID` | the id of that same Cloudflare account, as its Workers & Pages overview shows it (a domain's Zone ID is also 32 hex characters and is not it) |

They are the environment's and never repository secrets (Settings, Secrets and variables, Actions): a
repository secret reaches a workflow pushed on any branch, and every job also sees the repository's
secrets, so one saved there by mistake defeats the limit to `main`; delete it there if it was. Until both
are saved the deploy job says so in the run's summary and passes; nothing else changes. GitHub lists that
run under the environment like any other; the summary says whether it deployed. Before it deploys, the job
lists the account's KV namespaces with the token and stops, with the likely causes in plain words, when the
listing fails or one of the three ids in `wrangler.toml` is not among them; nothing is deployed then. They
reach the two steps that use them, that check and the deploy, through their environment, where wrangler
reads them; they are never an argument and never printed.

`deploy.sh` is still how everything else is done, from the maintainer's machine: the first deploy of a
name and the KV namespaces (the workflow never creates one: it checks that `wrangler.toml` names all three
and switches wrangler's automatic provisioning off), the Worker's secrets (they come from the vendor folder,
which never enters CI; a deploy keeps the secrets a Worker holds, so `deploy.sh` is needed only when one
changes), and the five addresses for the website's `beethoven/services.json`, which it prints.

## Deploy (once, from the maintainer's machine)

`deploy.sh` (above) does all of this and is the way to deploy. The steps by hand, for reference:

```
npm i -g wrangler
cd beethoven-access                             # this repository's checkout
wrangler login
wrangler kv namespace create TRIALS
wrangler kv namespace create REPORTS
wrangler kv namespace create ACCESS
# paste the three ids into wrangler.toml

# the trial signing key: made once by Beethoven for VS Code's licence tool (in that repository,
# node tools/license/beethoven-license.mjs init --kid trial), which keeps it as keys/trial.pem in the vendor
# folder and adds its public key to that edition's grid/license_keys.json. trial-key.mjs reads that file and
# writes the key into the pipe only (it refuses a terminal), so it is never on a command line, a screen or
# in the shell history; it refuses a key whose public half is not the one interface/contract/signing-keys.json
# names for the key id, this repository's record of the "trial" entry there.
node trial-key.mjs --kid trial | wrangler secret put TRIAL_KEY_PKCS8_B64
echo trial | wrangler secret put TRIAL_KID

# the admin token: random, kept in the vendor folder for the admin page, admin.mjs and the VS Code edition's publish.sh
openssl rand -base64 32 > ~/.beethoven-vendor/admin_token && chmod 600 ~/.beethoven-vendor/admin_token
wrangler secret put ADMIN_TOKEN < ~/.beethoven-vendor/admin_token

# the salt that hashes the address a request comes from (nothing reads it back; a new salt only resets the
# rate limit). Kept in the vendor folder so both Worker names get the same one
openssl rand -base64 32 > ~/.beethoven-vendor/ip_salt && chmod 600 ~/.beethoven-vendor/ip_salt
wrangler secret put IP_SALT < ~/.beethoven-vendor/ip_salt

# a fine-grained GitHub token: the one private repository only, permission Issues: read and write
wrangler secret put GITHUB_TOKEN
echo OpenSpineConsortium/beethoven-vscode | wrangler secret put GITHUB_REPO

wrangler deploy
```

`wrangler secret put NAME` reads the value from stdin when something is piped in, and from a hidden
prompt otherwise; neither way puts the value in the command line or the history. `wrangler deploy`
prints the Worker's address (`https://beethoven-access.<account>.workers.dev`, or a domain you route to
it); `wrangler deploy --name ashley-service` and `wrangler secret put NAME --name ashley-service` do the
same for the old name.

## After deploy: services.json

`https://openspineconsortium.com/beethoven/services.json` in the site repository is where both
editions, the request page and the admin page find the service:

```json
{
  "access_check": "https://beethoven-access.<account>.workers.dev/access_check",
  "request": "https://beethoven-access.<account>.workers.dev/request",
  "revocation": "https://beethoven-access.<account>.workers.dev/revoked",
  "license_service": "https://beethoven-access.<account>.workers.dev/trial",
  "request_page": "https://openspineconsortium.com/beethoven/request.html",
  "support_page": "https://openspineconsortium.com/beethoven/support.html",
  "report": "https://beethoven-access.<account>.workers.dev/report"
}
```

`deploy.sh` prints the five service addresses (for the default name only), and the website's repository
takes them into the file in a reviewed commit; the two pages are the site's. There is no `allowlist` key since 2026-10-01: with none, and
with `license_service` set, both VS Code builds skip their list check at the sign-in step and `/trial`
decides (it refuses a person who is not approved, with the request page). Deploy order for this change: publish the site first (its `/beethoven/services.json` and `/ashley/services.json` without `allowlist`), then deploy the Worker under both names no sooner than an hour later (a day is safer). The VS Code builds cache the services file for an hour; one that still holds the old address in that hour reads the empty list and refuses its sign-in step to a student without a key, until the next fetch of the file. Beethoven reads `access_check` from it (cached for a day), the
VS Code edition reads the other routes, and the request and admin pages read it too, so the Worker's
address lives in one place. The file the builds before the rename read,
`https://openspineconsortium.com/ashley/services.json`, names `ashley-service` and is kept byte for
byte. While the service values are empty the VS Code edition uses the allowlist bundled in the VSIX and
the trial button says to ask the lead. The settings `beethoven.licenseServiceUrl`,
`beethoven.allowlistUrl`, `beethoven.licenseRevocationUrl` and `beethoven.diagnostics.endpoint` (the
`ashley.*` ones still read when those are unset) override the file for one installation.

Check: `curl https://<worker>/health`, then open `https://openspineconsortium.com/beethoven/admin.html`,
paste the token from `admin_token` in the vendor folder, and add yourself.

## A second wall in front of /admin/*

The bearer token is one check; put Cloudflare Access in front of the admin routes as another, so a
request reaches the Worker only from a browser that has signed in to your Cloudflare account's
identity provider. Zero Trust, Access, Applications, add a self-hosted application: domain the
Worker's host, path `admin/*`; a policy that allows only your own e-mail (one-time PIN is enough).
Because `admin.html` is served from the website and calls the Worker across origins, set the
application's CORS settings to allow the origin `https://openspineconsortium.com` with
credentials and the headers `Authorization` and `Content-Type`; the page already sends its calls
with credentials, so the Access session cookie rides along. `admin.mjs`, and the VS Code edition's
`publish.sh`, call the same routes from a terminal: create a service token for them in Access, or run them
while the policy also allows the machine's address. The job on the grid reads `admin/roster.txt` and
`admin/readers.txt` with the grid token and cannot sign in to Access: leave those two paths out of the
application, or the grid stops following the lists. The free plan covers a lab.

## The approved list, day to day

- A student fills in `request.html`: AccessID, name, `AccessID@wayne.edu`, what they will use Beethoven
  for, and if they like the Google account they use in Chrome (optional since 2026-10-13) and a CV (PDF
  or Word, 5 MB at most).
  The Worker checks the fields, stores a pending record (the CV beside it) and e-mails you about it
  ([The request portal](#the-request-portal)); with `GITHUB_TOKEN` set it also opens an issue titled
  `Access request: <AccessID>` labelled `beethoven-access-request`.
- You press Approve for Beethoven, Lab membership only, or Deny in that e-mail, or open `admin.html`
  and click Approve (or Deny, with a reason the student does not see). Add puts someone on the list
  without a request. Every click confirms first. An approved record carries `grants`: `["extension",
  "lab"]` for Beethoven (and Beethoven for VS Code) and lab membership, `["lab"]` for lab membership
  only; `admin.mjs grant <id> extension,lab` or `lab` sets them, `admin.mjs approve-lab <id>` approves a
  request for the lab only. A record written before grants existed counts as both. A lab member who
  later asks for Beethoven through the form gets a new request, and the e-mail says they are a lab
  member already.
- After Approve for Beethoven there is nothing to add them to: since 20.0.0 (2026-10-13) Beethoven
  installs from the Chrome Web Store, whose link is on the site's Beethoven page ([The store
  listing](#the-store-listing)), and your e-mail about the request says so. With `MAIL_STUDENTS` `"1"`
  the student is e-mailed at approval: install it from the store, in any Chrome on their own computer
  (the link is in the Install section of that page), and how it works. Until 2026-10-13 this step was
  the invitation to the private listing's Google Group **Beethoven-users**: the Approve page still shows
  it ("Next: add <Google account> to the Google Group Beethoven-users", the address in a box with a Copy
  button, the group's members page, and a **Done, invited** button), and the admin page its **Mark
  invited** (`admin.mjs invited <id>`), so older records read as they did; nobody needs the mark now,
  and the daily reminder that listed approvals without it is no longer sent.
- Each request and approval carries its lifecycle with times: submitted, confirmed (the mailbox, when
  `MAIL_STUDENTS` is `"1"`), decided (approve, lab or deny), invited (a mark made until 2026-10-13), and
  installed (when the account's first installation checks in). The admin page and `admin.mjs list` show
  each approval's stage in one line: `lab`, `approved` (not marked invited), `invited` or `installed`,
  with its installations and refusals.
- In Beethoven for VS Code the student runs the wizard: the Wayne State sign-in step passes (since 2026-10-01 the
  services file names no list, so the step no longer fetches `/allowlist`), and the trial button asks `/trial` for a
  key, which `/trial` refuses to anyone not approved. The Worker asks Microsoft who they are, requires the approved
  record, and signs a key for `TRIAL_DAYS` days (365) with the trial key; a person can be issued three
  keys a day (a new laptop, a reset), and the id of each is written to their approved record.
- Remove deletes the record (and the person's installations, refusals, CV and access-check records)
  and puts every key issued to that person on the revocation list, which
  the Worker signs with the trial key and serves at `/revoked`; installations fetch it daily. Withdraw
  one key on its own with the form at the bottom of the admin page (`revoke-lid`).
- Beethoven, the browser edition, has no keys. The student signs in to their own Open OnDemand
  portal; the extension reads the account name the portal's dashboard shows and asks
  `POST /access_check` whether that account is on the approved list (when the portal is connected,
  on each click of its icon, and about once a day). Yes means it works; no means its one button reads
  "Ask for access" and opens `request.html?access_id=<account>` on the page the answer names
  (`https://openspineconsortium.com/beethoven/request.html`, the one request page of both editions),
  which fills in the first field. Remove takes the approval away:
  the next check answers no and the extension stops starting workers. The checks on record (who, from
  which portal, which version, when, the decision) are the `checks` list in `admin.mjs list` and in
  `GET /admin/list`. [ACCESS_CHECK.md](ACCESS_CHECK.md) is the contract.
- An approved account works on any of its own installations (since 2026-10-11). Beethoven 8.0.0 sends
  the random identifier it made when it was installed; the service records each installation an
  account asks from (the ten most recently seen) and approves them all, and when an account turns up on
  a new one you get one e-mail a day about it, a notice with one link, **Withdraw approval**. One
  installation serves one account: another account asking from it is refused (`other_account`).
  `admin.mjs seat <id>` lists the installations by fingerprint, `admin.mjs reset-seat <id>` forgets them
  (each is recorded again at its next check), and a reinstall, a new browser profile or a new computer is
  a new installation, which simply works. From 2026-09-30 until 2026-10-11 one account worked on one
  installation, a second was refused ("This account is already set up on another computer. Ask your lab
  lead to move it here.") and the e-mail carried a Move link; such a link now answers out of date.
  [ACCESS_CHECK.md, Installations](ACCESS_CHECK.md#installations) has the rules and what they do not stop.
- The mock portal the store reviewers run signs in as `st1234`. That record is on the approved list
  (note "store-reviewer mock username") and marked as the store reviewers' mock account with
  `admin.mjs seat-rule st1234 any` (set on 2026-09-30), so each reviewer's own copy is approved by the
  real service and none is refused as a second installation. `st1234` has the shape of a real Wayne
  State AccessID, and a real person may hold it, so since 2026-10-01 the mock account is an approval on
  the reviewers' own machine and nowhere else. An access check for it is approved only when the portal
  it names is `localhost` or a name under `.localhost` (with or without a port), and there from any
  installation, recording none. From any other portal the answer is the plain no an unknown account gets:
  no installation is recorded or changed, no refusal is recorded and nobody is e-mailed. It
  is not on the approved list (`GET /admin/allowlist`), `/trial` issues it no key, and the daily reminder, while it was sent, skipped it. The admin page
  and `admin.mjs list` still show it, marked as the store reviewers' mock account.
  (From 2026-09-30 afternoon until then, a check for `st1234` from a real portal was treated as an
  ordinary approval held to one installation, and `st1234` was on the public `/allowlist`.)

## The request portal

**What the form sends.** Since 2026-09-30 the request page posts this to `/request` (JSON, 7 MiB + 16
KiB at most; every other route keeps its 8 KiB cap):

```json
{"v":2,"access_id":"ab1234","name":"A. Student","email":"ab1234@wayne.edu",
 "google_account":"a.student@gmail.com","purpose":"spine segmentation for my thesis",
 "cv":{"name":"cv.pdf","type":"application/pdf","base64":"JVBERi0x..."},"product":"bridge"}
```

| Field | Rule |
|---|---|
| `access_id` | two letters and four digits |
| `email` | exactly `<access_id>@wayne.edu` |
| `name` | 2 to 80 characters |
| `google_account` | optional since 2026-10-13, and kept when given: the address the person signs in to Chrome with (lower-cased, 120 characters at most). Until then it was required, the one to add to the private listing's Google Group |
| `purpose` | required: what they will use Beethoven for, 2 to 500 characters |
| `cv` | optional: `base64` is the file (a `data:...;base64,` prefix is allowed), 5 MB at most once decoded. The kind is read from the file's first bytes (`%PDF-` a PDF, `PK 03 04` Word .docx, `D0 CF 11 E0 A1 B1 1A E1` Word .doc); anything else is refused. `name` is kept as text (120 characters); `type` is ignored |
| `product` | optional: `bridge` from Beethoven's page; shown in the e-mail only |

The older form's body (`accessId`, `name`, `email`, `note`, `product`; no `v`) is still taken, for a
page cached before the change, and answered as before.

| Status | Body | When |
|---|---|---|
| 202 | `{"status":"pending","mailbox":"not_verified"}` | stored; the maintainer is e-mailed now (the older body gets `{"status":"pending"}`) |
| 202 | `{"status":"pending","mailbox":"confirm"}` | stored; `MAIL_STUDENTS` is `"1"` and a "Confirm it is you" e-mail went to `<access_id>@wayne.edu` (the page says "Sent. Check your Wayne State mail for a confirmation link.") |
| 202 | `{"status":"pending","mailbox":"confirmed"}` | `MAIL_STUDENTS` on, and the same request was sent again after it was confirmed: nothing to confirm again (the page says "Sent. You hear from the lab lead.") |
| 502 | `{"error":"the confirmation e-mail to ab1234@wayne.edu could not be sent just now; ..."}` | `MAIL_STUDENTS` on, and Resend refused or could not be reached: the request waits unconfirmed (the admin page shows it) and the maintainer is not e-mailed; the page shows "Not sent: " and the sentence |
| 200 | `{"status":"approved"}` or `{"status":"denied"}` | already decided; nothing stored. A lab member only is not "approved" here: their request is stored like any other |
| 400 | `{"error":"..."}` | a field above; the error is a plain phrase the page can show after "Not sent: " |
| 413 | `{"error":"too much text"}` | a body over the cap |
| 429 | `{"error":"too many requests from this connection today; ..."}` | ten requests per connection a day |
| 429 | `{"error":"three confirmation e-mails went to ab1234@wayne.edu today; ..."}` | `MAIL_STUDENTS` on: three confirmation e-mails an AccessID a day; nothing is changed |

**The CV.** Stored as the file's bytes under `cv:<AccessID>` in KV ACCESS, with its name, kind, size and
upload time as metadata; a new request with a CV replaces it, one without keeps it. It is kept 12
months from the request, and again 12 months from the decision (Approve for Beethoven or Lab
membership only); Deny, Remove and Withdraw approval delete it at once. The maintainer's e-mail carries
a **View the CV** link (14 days, one use): opening it shows the file's name, kind and size and one
button; the button answers the file, a PDF shown in the browser tab, a Word file as a download, always
under the service's own name for it (`ab1234-cv.pdf`) and with the type the service chose from the
bytes, `X-Content-Type-Options: nosniff`, no caching and no Referer. A PDF shown in the tab gets only
`frame-ancestors 'none'` as its policy, because a sandbox can stop a browser's PDF viewer from opening
it; a download gets `default-src 'none'; sandbox`. After the one view, `node admin.mjs cv
<AccessID>` saves the file as often as needed, and `/admin/cv` answers it to the admin page.

**Mailbox proof.** Anyone can type an AccessID. With `MAIL_STUDENTS` `"1"` in `wrangler.toml`,
confirmation is required: the Worker first e-mails the student at `<AccessID>@wayne.edu` what was asked
in their name (name, Google account, purpose, the CV's name) and a **Confirm it is you** link (24
hours, one use; GET shows the request and one button, so Safe Links opening it confirms nothing). The
request reaches you only when they press it, and your e-mail then says `Mailbox: confirmed <time>`.
Until then it is on the admin page as unconfirmed, with its age; KV drops an unconfirmed request, and
its CV, 7 days after it was last sent, and the student can send the form again. The link matches only
the request as it was sent: if the form is sent again with changes, the earlier link says the request
has changed. The same form sent twice before confirming gives two e-mails whose links name the one
version; once either is used, the other answers "Already confirmed" and sends nothing. If Resend
refuses the student's address or cannot be reached, you are not e-mailed: the
student is answered 502 ("the confirmation e-mail ... could not be sent just now"), and the request
waits unconfirmed, marked `confirm_mail: "failed"`. When you approve someone for Beethoven, they are
e-mailed "You are approved for Beethoven": install it from the Chrome Web Store, in any Chrome they use
on their own computer, the link being in the Install section of `ONBOARDING_PAGE`
(`https://openspineconsortium.com/beethoven/`), and how it works, on the same page. Until 2026-10-13
the e-mail said to watch for the Google Groups invitation and install from the private listing, or,
when `GROUP_MODE` `"workspace"` had added them to the group itself, that you would send the listing's
link; since the listing is public the e-mail is the same in either mode. With `MAIL_STUDENTS` anything
else (it is `"0"` today) nobody but you is e-mailed, every e-mail says `Mailbox: not verified. Anyone
can type an AccessID; check with the person before approving`, and a request has no end. Turn it on
only after the domain is verified at Resend (below): until then Resend refuses every address but the
account owner's, so with `"1"` every request would be answered "could not be sent" and wait
unconfirmed. One limit remains: a later send of the form in someone's name replaces their request, a
confirmed one included, until they confirm again; it cannot ride on their confirmation, but it can make
them confirm twice.

**Versions.** Every send of the form is a version of the request, named by `ref`. The same form sent
again (a second press; the same CV, or none, attached) keeps the version, its mailbox state and the
links already sent. Any change (a field, a new CV, or a change of `MAIL_STUDENTS`) is a new version,
with a new `ref`. The confirmation link, the three decision links and the CV link all carry the `ref`
of the version they were sent for and act only while it is the one on record: after a changed send,
the older links answer "This request was replaced ... see the newer e-mail" and change nothing; after a
decision, "decided already". So what you approve is what the e-mail showed you.

**A sign-in instead, later.** The stronger proof is a Wayne State sign-in on the request page: Microsoft
Entra ID (Wayne State's tenant) would tell the Worker who the person is, the way `/trial` already asks
Microsoft Graph for the VS Code edition. It needs an application registration in Wayne State's tenant,
which only Wayne State's C&IT can grant (a redirect address on the site, the `User.Read` permission,
and their consent for the tenant). It is not built; the mailbox proof above is what exists.

**The maintainer's e-mail.** Every version of a request is e-mailed to you when it is ready (at once;
with `MAIL_STUDENTS` on, when the student confirms it). The same version sent again adds nothing to your
inbox the same day, and a repeat after 24 hours sends one reminder ("Asked again"), whose links belong
to the same version. A changed version is e-mailed at once, because its links replace the earlier
e-mail's ("Asked again: ..., with changes: links in an earlier e-mail about <AccessID> no longer
work"), three a day an AccessID at most; past that the newest version is on the admin page only.
The e-mail, from `Beethoven access` with the subject `Beethoven access request: <AccessID> (<name>)`
("asked for access to Beethoven", or "to Beethoven for VS Code" when the form names that edition, product
`ashley`, `vscode` or `beethoven-vscode`; an "Asked from" line then names it), says who asked (name,
AccessID, e-mail, Google account when given, what for, the CV's name, kind and size, the mailbox status, "Already:
a lab member" when that is so, when, and which product sent them) and carries three decision links,
**Approve for Beethoven**, **Lab membership only** and **Deny**, the **View the CV** link when there is
a CV, the step after approving (nothing to add them to: Beethoven installs from the Chrome Web Store,
whose link is on the site's Beethoven page) and the admin page's address. A link opens a page with one question and one button; nothing is decided until the
button is pressed, and the question page shows the request as it stands when you open it. Approve for
Beethoven writes the same approved record the admin page writes, with `grants: ["extension","lab"]` and
`by: "e-mail link"` in place of `"admin"`; Lab membership only writes `grants: ["lab"]` (added to what
the person had); Deny writes the same denied record, with no reason, deletes the CV, and leaves a lab
member's membership in place. The audit line says the same. With `MAIL_STUDENTS` `"0"` the student is
not e-mailed about the decision; tell them. With `"1"` they are e-mailed when approved for Beethoven
(not for Lab membership only or Deny). Sending is best effort: if the mail provider fails, the request is still stored
and answered pending, the Worker logs the provider's status (never the key or an address), and the
admin page lists the request as before.

## The store listing

Beethoven is on the Chrome Web Store with **Public** visibility since 20.0.0 (2026-10-13): anyone can
install it, from the link on the site's Beethoven page (https://openspineconsortium.com/beethoven/, the
Install section; the service holds no store link of its own), in any Chrome on their own computer, and
the approval check (`POST /access_check`) is what lets an installation work. That retired the
invitation machinery: the Google account is optional on the request form, the approval e-mails say
where to install from and name no group, and the daily reminder is not sent (the cron is answered with
nothing; `[triggers]` stays in `wrangler.toml`, so a deploy changes no schedule). The Approve page's
invitation step, the admin route `invited` and the `invited_at` marks stay as they were, so the admin
page and older records keep working; nobody needs the mark now.

**Until 20.0.0: the private listing.** Beethoven was published with **Private** visibility, installable
only by the people the listing's Google Group named, and on no other store. The group was the list of
who may install; the approval check what lets an installation work. Both were needed. The steps, as
they were:

1. At https://groups.google.com, signed in with your own Google account, the group is
   **Beethoven-users** (https://groups.google.com/g/beethoven-users). Who can join: "Only invited users";
   who can see members: "Group managers".
2. In the Chrome Web Store developer dashboard, open Beethoven, Distribution: Visibility **Private**,
   and name the group as its trusted testers (the dashboard takes the group's address).
3. After you press Approve for Beethoven, the page that opens shows the next step: the Google account
   in a box with a Copy button, a link to the group's members page
   (https://groups.google.com/g/beethoven-users/members), and **Done, invited**. Invite the account
   there, with the private listing's address in the invitation's message (the student's e-mail says the
   invitation has the link), then press Done, invited: it records `invited_at` on the approval. From the
   admin page it is **Mark invited**; from a terminal, `node admin.mjs invited <AccessID>`
   (`clear` after the id takes the mark away).
4. Once a day (13:00 UTC), if an approval for Beethoven has waited more than an hour without that mark,
   one e-mail lists every such account with its Google account and a Done, invited link each. Not
   listed: lab members only, an account whose installation has checked in, and the store reviewers'
   mock account (`st1234`). One e-mail a
   day at most, and none when nobody is waiting.
5. When someone leaves, Remove (or Withdraw approval) stops Beethoven at its next check; take their
   account out of the group too, so they cannot install it again.

**Why by hand.** A group made at groups.google.com under a personal Google account is a consumer group,
and Google gives a consumer group no API for its members; only a group owned by a Google Workspace can
be managed by a program (the Directory API). So the invitation is one click and a paste for you, and
the service keeps track of it.

**When the lab has a Google Workspace** (`GROUP_MODE` `"workspace"`, off today and never called live):
the service then adds the account itself when you approve, with the Directory API's `members.insert` on
the group `GROUP_ADDRESS` (`beethoven-users@openspineconsortium.com`), and marks it invited (`invited_by:
"workspace"`). Setting it up, once: create the group in the Workspace (and let it have members from
outside the domain, since students use their own Google accounts); in Google Cloud, create a service
account and a JSON key for it; in the Workspace admin console, Security, API controls, Domain-wide
delegation, give that service account's client id the one scope
`https://www.googleapis.com/auth/admin.directory.group.member`; save the key file as
`google_group_sa.json` and the address of a Workspace administrator it acts for as `google_group_admin`,
both in the vendor folder; set `GROUP_MODE = "workspace"` in `wrangler.toml`; deploy both names.
`deploy.sh` sends the two files as the secrets `GROUP_SA_KEY` and `GROUP_ADMIN_SUBJECT` only when both
are there and the key file is a service-account key. Any failure (no key, Google refusing the token or
the insert, Google unreachable) leaves the manual step on the Approve page, with the reason in one
sentence; an account already in the group counts as invited. Google sends no invitation e-mail when
the service adds someone, so nothing carries the private listing's address to them: the Approve page
says to send it yourself, and the student's e-mail says you will. The adapter is tested against a stub of
Google's token endpoint and Directory API (a JWT signed RS256 with the key, checked with the public
key); it has not been run against Google.

The dashboard's exact words for step 2, and whether it takes a group from a developer account that is
not a Google Workspace one, were not checked when this was written: confirm them in the dashboard the
first time.

The mail goes through Resend's HTTP API (the domain's DNS is at Spaceship, not Cloudflare, so
Cloudflare's own mail sending is not available). Until the key exists, nothing is sent, the Worker logs
`mail: no provider configured` for each request, and everything else works as before. Setting it up,
once:

1. Sign up at https://resend.com with go2432@wayne.edu and confirm the address from Resend's e-mail.
2. In Resend, open API Keys, press Create API Key (Sending access is enough), and copy the key; it is shown once.
3. Save it as one line, nothing else, in `C:/Users/grego/.beethoven-vendor/resend_api_key` (open Notepad,
   paste, Save As that name with "All files" so no `.txt` is added). It begins with `re_`; `deploy.sh`
   refuses a file that does not and sends nothing from it, since whatever sits in that file travels to
   Resend in a header with every e-mail.
4. From WSL, in this repository's checkout: `BEETHOVEN_VENDOR_DIR=/mnt/c/Users/grego/.beethoven-vendor PATH=$HOME/node22/bin:$PATH bash deploy.sh`,
   then the same with `WORKER_NAME=ashley-service` in front, so both names send e-mail.
5. Then `BEETHOVEN_VENDOR_DIR=/mnt/c/Users/grego/.beethoven-vendor PATH=$HOME/node22/bin:$PATH node admin.mjs notify-test`: it prints `sent: the provider answered 200` and the test arrives (the first one may land in junk).

Until the domain is verified at Resend, Resend sends only from `onboarding@resend.dev` and only to the
address that owns the Resend account, which is why that account is yours. Later, to send from the
domain or to e-mail students too: in Resend, Domains, add `openspineconsortium.com`; add the DNS
records Resend lists at Spaceship; once Resend says Verified, write a sender such as
`Beethoven access <access@openspineconsortium.com>` into `mail_from` and run `deploy.sh` again.

| File in the vendor folder | Secret | When absent |
|---|---|---|
| `resend_api_key` | `RESEND_API_KEY` | nothing is sent; `deploy.sh` says so and leaves any key already in the Worker in place. A file that does not begin with `re_` is refused the same way and never sent |
| `ip_salt` | `IP_SALT` | `deploy.sh` makes it: 32 random bytes, base64, the same for both Worker names. Delete it and deploy both names to start a new salt (it only restarts the day's per-connection counts) |
| `decide_key` | `DECIDE_KEY` | `deploy.sh` makes it: 32 random bytes, base64. A new key makes every link already sent answer "not valid" |
| `notify_to` | `NOTIFY_TO` | `deploy.sh` writes `go2432@wayne.edu`; several addresses may be given, separated by commas |
| `mail_from` | `MAIL_FROM` | `deploy.sh` writes `Beethoven access <onboarding@resend.dev>` (the file written before 2026-09-30 said Ashley and was rewritten then) |
| `google_group_sa.json`, `google_group_admin` | `GROUP_SA_KEY`, `GROUP_ADMIN_SUBJECT` | only for `GROUP_MODE` `"workspace"` ([The store listing](#the-store-listing)); absent today, and nothing is sent |

`deploy.sh` pipes each file into `wrangler secret put`; no value is on a command line or in its output.
`wrangler.toml` needs no binding for these.

**The link.** `https://<worker>/decide?t=<payload>.<signature>`, where `payload` is the base64url of
the JSON `{"v":1,"access_id":"ab1234","decision":"approve","nonce":"<22 characters>","exp":<seconds>,"ref":"<22 characters>"}`
and `signature` is the base64url of HMAC-SHA256 over `payload` with `DECIDE_KEY`. `decision` is
`approve`, `lab` or `deny` in a request e-mail, `withdraw` in the e-mail about a new installation, and
`invited` on the Approve page (and, until 2026-10-13, in the daily reminder; `move`, with `"install_id"`, the installation
to move to, was in the e-mail about a second installation until 2026-10-11; such a link still verifies
and answers "This link is out of date"); `/cv` takes `cv` and `/confirm` takes `confirm`, and a link of
one kind opened at another address is "not valid". `ref` is the version the link was sent for: of the
request (a decision, the CV, a confirmation), of the notice e-mail (Withdraw; the notice record keeps
it once the e-mail has gone), or of the approval (Done, invited; an approval removed and made again,
with `add` or from a newer request, is another approval, so the older button answers "replaced").
A link whose `ref` is no longer the one on record answers "replaced" (see the newer e-mail),
"decided already", or "no longer on record", and
changes nothing; a link without `ref`, from an e-mail sent before 2026-09-30 afternoon, answers "This
link is out of date" (decide on the admin page instead). `exp` is 14 days after the e-mail was sent (24
hours for a confirmation). The decision links in one e-mail share the nonce, so once one is used, all
are spent; the CV link, the confirmation link and each Done, invited link have their own. The link
carries the AccessID and the decision only; the person's name is read from the record when the page
opens. The pages are not cached (`Cache-Control: no-store`) and send no Referer, so following a link
from them does not pass the token on. They have no scripts, but for one: the Approve page's Copy button,
allowed by its SHA-256 in the page's policy (`script-src 'sha256-...'`) and by nothing else; without it
the box is still a read-only field to select.

**What a link scanner can and cannot do.** Mail programs and scanners (Microsoft's Safe Links at
Wayne State, for one) often open links before you do. Opening a link (GET) only shows the question: it
writes nothing, and the tests hold it to that. Only the button (a POST with `confirm=1`) decides. A
scanner that also pressed buttons on the pages it opened would decide; such scanners are rare, and the
record would say `by: "e-mail link"` with the time; if that ever happens, undo it on the admin page.
Nobody can change a link into another one: a different AccessID or decision breaks the signature and
the page says "not valid". A used link says "already used", a link older than 14 days says "expired",
and both point at the admin page. Anyone who has the e-mail can use its links, so the links are as
private as your inbox: do not forward the e-mail. **"Once" holds after about a minute, not
before.** A used link is recorded in KV, which takes up to a minute to reach every Cloudflare location,
and consecutive requests from one computer do not always reach the same location (in the 2026-09-30
afternoon proof, one call in twelve was answered at MEM instead of ATL). So within that minute a second
press can get through. It happened once in that proof: a Done, invited button pressed again after 4
seconds stamped a second date ([ACCESS_CHECK.md](ACCESS_CHECK.md), the afternoon proof). The same
sequence repeated was refused. For the same decision a second press changes little (a date). Two
different links of one e-mail (Approve, then Deny) pressed within the minute could both apply: wait a
minute, or check the admin page, before pressing a second link of the same e-mail. Making "once" hold at
once needs a strongly consistent store for spending a link (a Durable Object); it is not built.

## Lab storage, read only

Added 2026-10-07 (`storage.js`). Some people need to read lab data on the grid without running Beethoven,
and ask to be put in the Unix group `oschome` for it, which is C&IT's to change and is not the lab's
approved list. They ask on the lab storage page instead (`https://openspineconsortium.com/beethoven/storage.html`,
left out of the site's menus and site map and marked not to be indexed, so the lab lead sends its address):
their AccessID, name, the folders under `/rs/rs_grp_oschome` they need (eight at most, one a line, like
`shared/data`; `STORAGE_ROOT` names another root) and what for. The
request is e-mailed to the maintainer with two links, **Approve read access** and **Deny**, made and
checked as the access links are (signed with `DECIDE_KEY`, 14 days, one use, tied to the version of the
request), but answered at `/storage_decide` only: `/decide` takes neither, and `/storage_decide` takes none
of `/decide`'s. The admin page's section **Lab storage, read only** lists the requests, the readers and the
denials; there the maintainer approves fewer folders than asked for, denies with a reason, adds a reader
directly, sets a reader's folders, or takes a reader off (`storage-approve`, `storage-deny`, `storage-add`,
`storage-remove`; the same with `admin.mjs`). The person asking is never e-mailed; the page tells them the
lab lead decides and lets them know.

**The whole volume.** Since 2026-10-07 (greg gave a lab member the group's read on all of it) a reader may
have the whole of `/rs/rs_grp_oschome`: one folder spelled `.`, which the form and the admin page also take
as the root itself (with or without a slash behind). It is stored and listed as `.`, and it is the reader's
only folder, since it covers every other: a list that names it beside others keeps `.` alone, approving
more folders for a reader of `.` leaves `.`, and approving `.` for a reader of some folders replaces them.
The e-mail and the decision pages say "all of the lab storage (`/rs/rs_grp_oschome`)", never a bare dot,
and say what it gives: everything there the group may read and the volume's owner owns. The grid can add
read only on what the owner owns, so a folder another person owns stays as they set it. Approve or add `.`
only once the copy of `tools/grid_access.sh` that applies the lists (the grid's own chain, or a scheduled
task) takes the line `<AccessID> .` (hpcworker's change of 2026-10-07, on its `main` since that day): an
older one refuses the whole readers list at that line and changes nothing on the grid, so approvals and
removals on the approved list stop reaching the grid too until that copy is updated.

Nothing here reaches the grid. `tools/grid_access.sh` in the `hpcworker` repository fetches both lists
from this service itself on each run (its change of 2026-10-07): the approved list, `GET
/admin/roster.txt`, and the readers, `GET /admin/readers.txt`, one `<AccessID> <folder>` a line
(`<AccessID> .` for the whole volume). Each reader gets `--x` on the root and the lab group's read on
their folders by named ACL entries, never write and never a default entry, and a reader taken off loses
them at the next run. What a reader gets and never gets is that tool's header and
`docs/guides/LAB_LEAD.md` section 9 there. A service deployed before the two text routes answers them
404, and the grid tool then refuses with nothing changed rather than taking anyone's entries away, as on
any answer that is not 200 plain text: deploy the service (both names) before the grid tool that reads
them. `node admin.mjs roster` and `node admin.mjs readers` print the same two bodies byte for byte, for
the maintainer to look at (and end with exit 1, saying to deploy, against a service without them). The
two routes and their grammar are in [ACCESS_CHECK.md, "The lists the grid
reads"](ACCESS_CHECK.md#the-lists-the-grid-reads-2026-10-07); the grid's own job reads them with the grid
token ([The grid token](#the-grid-token)), `admin.mjs` with the admin token.

**How the grid's sync moved (2026-10-07), for the record.** Until that day the maintainer's scheduled
grid task (`tools/grid_access_task.ps1 -Install` in `hpcworker`) ran Beethoven for VS Code's
`tools/intake/admin.mjs roster` and `readers`, named with `-AdminTool`, which built both lists from `GET
/admin/allowlist` and `GET /admin/storage-list`. That file left Beethoven for VS Code with the move to
this repository. The step planned in between, the task registered again with `-AdminTool` naming this
checkout's `admin.mjs`, was overtaken the same day: `grid_access.sh` fetches the two text routes itself
and the task takes `-ServiceUrl` and no `-AdminTool`; and at Wayne State, whose maintainer's PC has no
WSL, the cluster applies the lists itself as a chain of Slurm jobs with the grid token, and the
maintainer's machine runs nothing ([The grid token](#the-grid-token); `docs/guides/LAB_LEAD.md` section
9 in `hpcworker`). What still holds: deploy both names with the text routes before any grid tool that
reads them. In the other order every run refuses and changes nothing, so the volume's entries stop
following the approved list, and someone taken off it keeps theirs until the runs work again.

## The grid token

Added 2026-10-07, so the admin token never sits on the cluster and the maintainer's own machine runs
nothing for the grid: hpcworker's `tools/grid_access.sh` (its change of the same day) runs on the cluster
as a chain of short Slurm jobs, started with `--watch`, and reads the two lists with a token that can
read them and nothing else, from the file `grid_token` in its vendor folder before `admin_token`. The
maintainer makes it on the admin page (`POST /admin/grid-token`), which downloads it as that file. The
service answers the token once, with `cache-control: no-store`, and keeps only its SHA-256 (KV `ACCESS`,
`grid-token`); a lost file is not recovered, only replaced. With it `GET /admin/roster.txt` and
`GET /admin/readers.txt` answer exactly what the admin token gets; every other admin route, the grid
token's own included, answers it the 401 of a wrong admin token. Making a new one replaces the old one at
once where it is made; `POST /admin/grid-token-withdraw` takes it away. KV is eventually consistent, so
for about a minute other Cloudflare locations may still take the old token, or not yet take the new one:
a grid run in that minute may be refused; it then changes nothing and works at its next run.
`GET /admin/grid-token` shows when the token was made and when it last read a list (`made_at`,
`last_read_at`, `null` when none), never the token or its hash; the last read is recorded once an hour at
most, so the lists' readers cost about 24 KV writes a day. It is looked up and written after the answer
(`ctx.waitUntil`), so nothing in it, a failed or unreadable lookup or a failed write, fails or holds up
a read, and a wrong token costs one KV read. A new token's answer always reaches the page once it has
replaced the old one: a failure before that replaces nothing, and a failed audit line after it is logged.
Contract: [ACCESS_CHECK.md, "The lists the grid reads"](ACCESS_CHECK.md#the-lists-the-grid-reads-2026-10-07).

## Publishing your own revocation list

Keys issued by hand with Beethoven for VS Code's licence tool are withdrawn with that tool, and that
repository's own `publish.sh` tells the service, as a client of two routes here: it posts every id in its
bundled list to `POST /admin/revoke-lid` in one call (`{"lids": [...]}`; one call per id would race its own
earlier writes in KV and drop some), with the admin token from `admin_token` in the vendor folder, then
reads `GET /revoked` until it lists them all (KV takes up to a minute to settle). From then on the
service's list is the union of those and its own removals, signed with the trial key. The VS Code
edition's releases bundle only the keys withdrawn with the tool; keys the service withdrew reach
installations through `/revoked`.

## What the service keeps

| Store | Key | Value | Retention |
|---|---|---|---|
| ACCESS | `approved:<AccessID>` | name, e-mail, note, the Google account, when and by whom, the ids of the keys issued, `grants`, `any_installation` when set; the lifecycle: `submitted_at`, `confirmed_at`, `mailbox` and `ref` of the request decided, `decided_at` and `decision` (`approve` or `lab`), `invited_at` and `invited_by` | until removed |
| ACCESS | `pending:<AccessID>` | name, e-mail, note (the purpose), the Google account, the product that sent them, when first asked (`requested_at`) and when this version was sent (`submitted_at`), the CV's name, kind and size and its SHA-256 (`cv_sha256`, to tell a new CV from the same one), the mailbox status (`not_verified`, `waiting`, `confirmed`) and, once confirmed, when (`confirmed_at`; `verified_at` in records from before 2026-09-30 afternoon), `ref` (the version), and while unconfirmed `expires_at` and, if the confirmation e-mail failed, `confirm_mail: "failed"` | until approved or denied; unconfirmed (`MAIL_STUDENTS` `"1"`), 7 days from the last send |
| ACCESS | `denied:<AccessID>` | name, e-mail, note, the Google account, when asked, the lifecycle of the request (`submitted_at`, `confirmed_at`, `mailbox`, `ref`), when (`denied_at`, `decided_at`), `decision: "deny"`, and why | until removed or approved |
| ACCESS | `installed:<AccessID>` | when the account's first installation checked in, and its product and version (the lifecycle's "installed"; its own key, because an access check never writes the approval) | until removed |
| ACCESS | `cv:<AccessID>` | the CV's bytes; metadata: name, kind, size, when sent, when decided | 12 months from the request, renewed for 12 months at the confirmation and at the decision; 7 days while the request is unconfirmed; deleted at once on Deny, Remove or Withdraw approval |
| ACCESS | `seat:<AccessID>` | the installations the account has asked from, up to ten, oldest first: each its identifier, first and last check, product, version (a record from before 2026-10-11 holds one installation at its top level, rewritten at the next check) | until reset or removed; beyond ten, the one least recently seen is dropped |
| ACCESS | `install:<identifier>` | the account an installation serves, and since when | as long as it is on that account's record |
| ACCESS | `conflict:<AccessID>` | refusals: kind (`other_account`; `other_installation` only from before 2026-10-11), count, first and last, the fingerprint of the installation last refused | 12 months from the last refusal, or until reset or removed |
| ACCESS | `notice:<AccessID>` | the last e-mail about a new installation: `ref` (its version, which its Withdraw link must match), when it went, the new installation's fingerprint, how many were on record | 12 months, or until reset or removed |
| ACCESS | `install_notified:<AccessID>` | when the last e-mail about a new installation went (`conflict_notified:<AccessID>` until 2026-10-11) | 24 hours |
| ACCESS | `confirm_mail:<AccessID>:<day>` | confirmation e-mails sent to the student that day (3 at most) | 2 days |
| ACCESS | `revoked`, `revoked_signed` | the withdrawn key ids; the signed list | until replaced |
| ACCESS | `grid-token` | the grid token's SHA-256 (never the token) and when it was made (`made_at`) | until replaced or withdrawn |
| ACCESS | `grid-token-read` | when the grid token last read a list (`last_read_at`, written once an hour at most) and the first 16 characters of its SHA-256 (`sha256_head`), which tie it to that token: a late write from a location still holding a replaced token lands here and never brings that token back | until a new token is made or the token is withdrawn; for about a minute after either, a location that has not seen it yet may write it again for the old token (counted for no token, shown nowhere), and it then stays until the new token's first read replaces it, or after a withdrawal until the next token is made |
| ACCESS | `audit:<time>:<4 hex>` | action, AccessID, by (and the grants of an approval) | for the record |
| ACCESS | `req:<hash>:<day>` | requests from one connection (a salted hash; the address itself is never stored) | 2 days |
| ACCESS | `notified:<AccessID>` | when the last e-mail about this person's request was sent | 24 hours |
| ACCESS | `notify_versions:<AccessID>:<day>` | e-mails that day about new versions of this person's request (3 at most) | 2 days |
| ACCESS | `invite_reminder:<day>` | when that day's invitation reminder went (one a day); none written since 2026-10-13 | 2 days |
| ACCESS | `decide:<nonce>` | a used e-mail link (a decision, a CV view, a confirmation, a Done, invited): AccessID, decision, when | 30 days (a link lives 14 days at most) |
| ACCESS | `storage_pending:<AccessID>` | a lab storage request: name, e-mail, note (what for), `folders`, `requested_at`, `submitted_at`, `ref`, `mailbox: "not_verified"` | until approved, denied or removed |
| ACCESS | `storage:<AccessID>` | a reader: name, e-mail, note, `folders`, `approved_at`, the request decided (`requested_at`, `submitted_at`, `mailbox`, `ref`), `decided_at`, `decision` (`approve` or `add`), `by` | until removed |
| ACCESS | `storage_denied:<AccessID>` | the request denied, with `denied_at`, `decided_at`, `decision: "deny"`, `by` and why | until removed, or lifted by `storage-add` |
| ACCESS | `storage_req:<hash>:<day>`, `storage_notified:<AccessID>`, `storage_notify_versions:<AccessID>:<day>`, `storage_decide:<nonce>` | as `req:`, `notified:`, `notify_versions:` and `decide:`, for lab storage requests and their links | 2 days, 24 hours, 2 days, 30 days |
| ACCESS | `seen:<product>:<AccessID>` | the last access check for that product and account: portal, version, time of the first and the last check, how many, the salted hash of the address, the decision and its reason, when the decision last changed | until the account is removed (Remove or Withdraw approval deletes it for every product) |
| ACCESS | `chk:<AccessID>:<day>`, `chkip:<hash>:<day>` | access checks that day per account (120 at most) and per connection (2000 at most) | 2 days |
| TRIALS | `<AccessID>` | the last key issued: time, key id, e-mail, end date | for the record |
| TRIALS | `issue:<AccessID>:<day>` | keys issued that day | 2 days |
| REPORTS | `rate:<install id>:<day>` | count | 2 days |
| REPORTS | `sig:<signature>` | issue number, count | 365 days |

The reports live in the GitHub issues, where the maintainer reads them (nothing on his side runs on an
API key, and nothing runs Claude Code on them unattended). The access requests live in KV (above)
and in the maintainer's e-mail; they are filed as issues too only when `GITHUB_TOKEN` is set, which it
is not today.

## Limits and checks

Reports are capped at 64 KB, ten per installation per day; every string is stripped of hidden
comments and zero-width characters and truncated. Requests: the AccessID is two letters and four
digits, the e-mail must be `AccessID@wayne.edu`, the name 2 to 80 characters, the purpose (note) 500 at
most and required on the current form, the Google account optional since 2026-10-13 and checked when
given, a CV 5 MB at
most and a PDF or a Word file by its bytes, ten requests per connection per day; the issue body
carries the AccessID, name and note, not the e-mail. A CV costs the Worker CPU time to decode: tens of
milliseconds for 5 MB in plain JavaScript (measured in Node on the maintainer's machine: parse about
15 ms, decode about 50 ms), less where the runtime has `Uint8Array.fromBase64`. Keys require a Microsoft account in the allowed domains (`ALLOWED_DOMAINS`, default
`wayne.edu`) whose user name, or on-premises account name, is an AccessID, and an approved record
for it; anything else is answered with a message that says what to do. `/request` and `/admin/*`
answer browsers from `SITE_ORIGIN` only. `/access_check` answers any origin (the caller is a browser
extension), looks up one account and never returns the list; it is capped at 120 checks per account
and 2000 per connection a day, and the extension itself asks only a few times a day.

## The vendor folder

The private signing keys, the ledger of issued keys and the service's secrets live in
`C:/Users/grego/.beethoven-vendor` (outside OneDrive and outside every repository). It was
`C:/Users/grego/.ashley-vendor` until 2026-09-30; a junction there points at the new folder, so an old
path still works. Every script finds it the same way: `BEETHOVEN_VENDOR_DIR`, then `ASHLEY_VENDOR_DIR`
(the old variable), then `~/.beethoven-vendor`, then `~/.ashley-vendor` (`vendor.mjs`, this repository's
own copy of the VS Code edition's; `deploy.sh` spells out the same order). The trial signing key is
`keys/trial.pem` there, made by the VS Code edition's licence tool and read here by `trial-key.mjs`, with
`BEETHOVEN_VENDOR_PASSPHRASE` when it is encrypted: that layout, not any code, is what the two repositories
share. From WSL, where the home is
not the Windows one, set `BEETHOVEN_VENDOR_DIR=/mnt/c/Users/grego/.beethoven-vendor`.

## Tests

```
node --test test/*.test.mjs
```

Node 22 and nothing to install. An in-memory KV (binary values and metadata included), stubbed Microsoft
Graph, GitHub and Resend (which can refuse one address, as it refuses students' before the domain is
verified), and a signing key made for each run as the trial key; what the Worker signs is read back with a
small verifier in `test/worker.test.mjs`, written from the format `worker.js` signs and answering in the
words of Beethoven for VS Code's own (`grid/license.js` there), in both spellings of the prefixes
(`KEY_PREFIX` unset, `ashley` and `beethoven`); a test of its own shows it refuses a changed key, another
signer, a key past its grace and a changed list. The tests used to load that repository's verifier and
test key; the check of the real verifier against what this Worker signs now belongs to that repository,
through this one's published vectors. The installation rule, grants, the v2 request with and without a CV, the CV
link, the three decision links, the new-installation e-mail and its one link (until 2026-10-11 the
second-installation refusal and its two links), the mailbox proof
with `MAIL_STUDENTS` on and off, and the admin routes `seat`, `reset-seat`, `seat-rule`, `grant` and
`cv` each have their tests. Since 2026-09-30 afternoon also: every link tied to its version (a changed
form, a newer notice e-mail, a decision, a link without `ref`), the retired Move link answering out of
date, the reviewers' exemption on a localhost portal only, removal deleting the
access-check records, mailbox confirmation required (7 days, the refused confirmation e-mail, the
confirmed form sent again), the lifecycle and the stages of `/admin/list` (its whole contract), the
Approve page's invitation step (the copy box and the hash of its script, Done, invited once), `admin
invited`, the cron answering nothing since 2026-10-13 (until then the daily reminder: who was listed,
once a day, only from `REMINDER_FROM`), the student's e-mail at approval (where to install from, since
2026-10-13), the form without a Google account, and the Workspace adapter against a stub of Google (the JWT verified with the public
key, the insert, a member already there, every failure falling back to the manual step, never called
when `GROUP_MODE` is not `"workspace"`). Since 2026-10-01 also: the store reviewers' mock account
approved at localhost from two installations and refused, with nothing written and nobody e-mailed,
from `ondemand.grid.wayne.edu` and any other portal that is not local; absent from the approved list;
refused by `/trial`; left out of the reminder; still on the admin list; and an ordinary approval
unaffected on every one of those routes; and the public `GET /allowlist` naming nobody, whoever asks, while
`GET /admin/allowlist` gives the maintainer the list behind the admin token. Since 2026-10-07 also lab
storage: the request's fields and folders (never a part that starts with a dot or a dash, never a folder
outside the root), its own limit per connection, the maintainer's e-mail and its two
links (refused at `/decide`, as `/decide`'s are refused at `/storage_decide`), approve and deny once,
versions replaced, the admin routes, `GET /admin/roster.txt` and `/admin/readers.txt` (their bodies,
the token, the origin), and `admin.mjs readers` and `roster` run against the Worker behind a local server,
printing those bodies byte for byte (and failing, with exit 1 and nothing on stdout, against a service
without the text routes, a sign-in page in front of it and a wrong token); and the whole volume:
`.` and the root, either way written, as the one folder, in a request, an approval, the union with folders
already read, `storage-add` and `storage-remove`, said in words in the e-mail and on the pages, and printed
`<AccessID> .` by `readers`; and the grid token: kept as its hash and nowhere as itself, read as the two
lists with the admin token's bodies, refused with the admin route's exact 401 everywhere else (a near miss,
the hash given as the token, a kept hash off by one character), replaced and withdrawn at once, its last
read looked up and written once an hour at most after the answer (through `ctx.waitUntil` when there is
one), a failed, unreadable or unanswered lookup or a failed write of it never failing or holding up the
read, a wrong token costing one KV read, an hour to the millisecond not yet older than an hour, a late
write from a location still holding an old record never bringing that token back, and a make that fails
before its record keeping the old token while one whose audit line fails still answers the new token.
`test/vendor.test.mjs` checks the order in which the vendor folder is found, and
`test/trial-key.test.mjs` what `trial-key.mjs` gives `deploy.sh` (the key the Worker imports, an encrypted
one opened with the passphrase variable, nothing printed when it cannot be read or is not the key
`interface/contract/signing-keys.json` names).

`test/interface.test.mjs` holds the published contract (`interface/`, its README says what it is) to the
Worker: `routes.json` names every route `worker.js` and `storage.js` answer, and the vectors are what the
Worker answers now, each passing its route's schemas and line grammar. After a change of what the Worker
answers, `node test/vectors.mjs --write` rewrites them (`node test/vectors.mjs` names the ones that
moved); the test fails until it is run. `test/fake-kv.mjs` (the in-memory KV), `test/schema.mjs` (the
schema check) and `test/vectors.mjs` are helpers, not tests. `test/boundary.test.mjs` holds the
interface standard's rules 1 to 3: nothing here reads, runs or copies another repository's checkout,
what this repository offers is declared in `interface/INTERFACE.json`, and it imports nothing.
