# beethoven-access — working context

Beethoven's access service: one Cloudflare Worker (`worker.js`, `storage.js`, `wrangler.toml`) deployed
under two names, `beethoven-access` and `ashley-service`, with the maintainer's tools beside it
(`admin.mjs`, `deploy.sh`, `trial-key.mjs`, `register_subdomain.sh`). It holds the approved list and
answers the access check (Beethoven, the browser extension), issues trial keys and signs the revocation
list (Beethoven for VS Code), takes the website's request and lab storage forms, serves the admin page,
and gives the grid its two lists (`/admin/roster.txt`, `/admin/readers.txt`, which hpcworker's
`tools/grid_access.sh` applies). It was Beethoven for VS Code's `tools/intake` until 2026-10-07. Vendor:
Gregory Schwing, trading as OpenSpineConsortium. Beethoven runs Claude Code and is not an Anthropic
product; "Claude" and "Claude Code" are Anthropic's marks, used here to say what it runs; "Open
OnDemand" is the mark of its publisher.

## Read first

- `README.md` (routes, the two names, deploying, the request portal, lab storage, what the service
  keeps) and `ACCESS_CHECK.md` (the access check, the admin routes, the lists the grid reads).
- `interface/README.md`: what this repository offers others, and how that changes.

## Rules that are not negotiable

- **Each repository stands alone** (greg, 2026-10-07). Nothing here reads, runs or copies another
  repository's code or checkout; others reach this service over HTTP and through
  `interface/INTERFACE.json` (the standard: `INTERFACES.md` in `OpenSpineConsortium/beethoven`).
  `test/boundary.test.mjs` holds it; its known list of exceptions may only shrink. What the VS Code
  edition and this service share is the vendor folder's layout (`vendor.mjs`, `keys/<kid>.pem`, the
  passphrase variables), not code.
- **A change to what the Worker answers changes the contract in the same commit.** Rewrite the
  vectors with `node test/vectors.mjs --write` (never by hand); `test/interface.test.mjs` fails until
  then. A new route goes into `interface/contract/routes.json` with its schemas and a vector. Raise
  the export's version when a client must change its code (`interface/README.md`).
- **No Claude credential and no API key anywhere** (greg, 2026-10-04 13:27Z: "no api key anywhere
  thats the only fundamental rule of this software"). Nothing here touches a Claude sign-in. The only
  student credential that ever reaches the Worker is the Microsoft sign-in token `/trial` uses once to
  ask Microsoft who the person is.
- **Secrets never on a command line, in argv, a log or a job file.** The Worker's secrets come from the
  vendor folder through `deploy.sh` into `wrangler secret put` by pipe; `trial-key.mjs` refuses a
  terminal. A token sent with curl goes in a header file (`curl -H @file`, mode 0600) or through
  `--config -`, never as `-H "Authorization: Bearer $T"`. The deploy workflow's two Cloudflare secrets
  reach the environment of two steps only, the namespace check and the deploy. Nothing logs a token, an
  e-mail or an IP address.
- **The public name is Beethoven.** Old names stay only where installed builds need them: the Worker
  name `ashley-service`, the prefixes `ASHLEY1`/`ASHLEYREV1` (`KEY_PREFIX`), the wire value
  `product: "bridge"`, the vendor folder's old name and variables.
- **Nothing is deleted outside what the service owns.** `test/vectors.mjs --write` names a stale vector
  and never deletes it.
- Plain words in anything a student or the maintainer reads. Comments say why, not what, like the
  surrounding code. Versions are integers. Never the word that starts "prov" and ends "enance" for
  the history of a file or data; say origin, source or record.

## Building and testing

```
node --test test/*.test.mjs       # Node 22, nothing to install; helpers under test/ are not tests
node test/vectors.mjs             # names each vector that moved; --write rewrites them
bash -n deploy.sh register_subdomain.sh
```

CI (`.github/workflows/ci.yml`) runs the tests and `bash -n` on every pull request and push to `main`,
with no secret. `.github/workflows/deploy.yml` deploys both names after the tests when `worker.js`,
`storage.js` or `wrangler.toml` changes on `main`, once `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` are saved as secrets of the environment `cloudflare`, limited to `main` (never
as repository secrets, which every branch's run can read; `README.md`, "Deploying from GitHub"), the
token made from Cloudflare's "Edit Cloudflare Workers" template and limited to the one account. Before
deploying, the job lists the account's KV namespaces with the token and refuses when the listing fails or
the three in `wrangler.toml` are not among them (run against a stand-in wrangler only so far; with a real
token not yet measured). The workflow and `deploy.sh` both run the wrangler
`.github/deploy/package-lock.json` fixes by hash; `deploy.sh` stays the way to make a name, its KV
namespaces and its secrets. The first run (2026-10-07) reached Cloudflare and failed at the deploy itself
with its error 10041, "KV namespace not found", before that check existed; no deploy from this repository
has succeeded yet.

## Layout

- `worker.js`, `storage.js`, `wrangler.toml`: the Worker.
- `admin.mjs` (the maintainer's command line), `service.mjs` (its address), `vendor.mjs` (where the
  vendor folder is), `deploy.sh`, `trial-key.mjs`, `register_subdomain.sh`.
- `.github/workflows/` (`ci.yml`, `deploy.yml`) and `.github/deploy/` (`package.json` and the lock that
  pin wrangler for the workflow and for `deploy.sh`).
- `interface/`: `INTERFACE.json`, `README.md`, `contract/` (routes, schemas, line grammar, vectors).
- `test/`: `worker.test.mjs`, `interface.test.mjs`, `boundary.test.mjs`, `trial-key.test.mjs`,
  `vendor.test.mjs`; helpers `fake-kv.mjs`, `schema.mjs`, `vectors.mjs`.

## How to be useful here

A state that is wrong but plausible is the failure to fear: an answer the tests never asked for, a
vector rewritten without reading what moved, a "deployed" nobody checked with `/health`. Check against
something outside the computation: the vectors' diff, the deployed Worker's answer, the e-mail that
arrived. Say plainly what is not known; "not yet measured" is the preferred form.
