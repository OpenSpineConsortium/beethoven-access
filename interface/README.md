# What beethoven-access offers other repositories

This repository is one sealed unit of the Beethoven ecosystem: the access service, one Cloudflare
Worker deployed under two names. Another repository reaches it only through what `INTERFACE.json`
lists, at a version, over HTTP or through a copy pinned to a commit on `main`, and never through a
checkout of this tree (the interface standard:
https://github.com/OpenSpineConsortium/beethoven/blob/main/INTERFACES.md). Everything not listed is
private and may change in any pull request: `worker.js`, `storage.js`, `admin.mjs`, the KV records,
the e-mails' wording, the pages a person opens from an e-mail.

| Export | Kind | Version | What it is | Taken by |
| --- | --- | --- | --- | --- |
| `http-api` | contract | 1 | `contract/`: `routes.json` (every route, who calls it, its auth, the schema of each request and of each answer by status), the JSON Schemas (`*.schema.json`), `lines.json` (the plain-text answers: the roster and readers lists, the signed revocation list and trial key), and `vectors/`, what the real Worker answered, with `vectors/key.json`, the public key that signed the vectors' key and list | beethoven-extension, beethoven-vscode, hpcworker, openspineconsortium.github.io |
| `http-api-text` | text | 1 | `ACCESS_CHECK.md` and `README.md` (Routes, The request portal, Lab storage), the same contract written for people | the same |

It takes nothing from another repository (`imports` is empty).

Who takes what, by route (`routes.json` has the full list):

| Client | Routes |
| --- | --- |
| beethoven-extension (Beethoven) | `POST /access_check` |
| beethoven-vscode (Beethoven for VS Code, its grid scripts and `publish.sh`) | `POST /trial`, `GET /revoked`, `POST /report`, `GET /allowlist` (older builds), `POST /admin/revoke-lid` |
| hpcworker (`tools/grid_access.sh`) | `GET /admin/roster.txt`, `GET /admin/readers.txt` |
| openspineconsortium.github.io (the request, lab storage and admin pages) | `POST /request`, `POST /storage_request`, the other `/admin/*` routes |

The addresses themselves reach the extension through the website's `beethoven/services.json`, which
`deploy.sh` prints and the site repository takes in a reviewed commit.

## How a client takes an export

With its own `pull.sh` and its own `gh` sign-in, from a commit `main` contains, only the paths this
manifest lists for the export at that commit, into one folder with an `ORIGIN` record (`repository`,
`commit`, `export <id> <version>`, one `sha256` line per file); its own test run fails when the folder
differs from `ORIGIN`. Each file lands at its path below the folder the export's paths share
(`interface/contract/routes.json` at `routes.json`). A client never reads this repository's checkout
and never runs its code.

What a client checks with it: that what it sends passes the request's schema, and that its reading of
each answer holds for every vector of its routes (status, content type, body). A vector is one
exchange: `request` (method, path, the headers that matter, the JSON body as a value whatever the
content type) and `answer` (status, every header, the body: JSON as a value, text as a string, `null`
for none). Secrets in a request are placeholders (`Bearer <ADMIN_TOKEN>`). The vectors' key and list
are signed by the key id `vectors`, made from a fixed seed in this repository's tests: its public key
is `vectors/key.json`, so a verifier can check them in its own tests, and no verifier may trust it
anywhere else. The schemas use only `type`, `enum`, `const`, `pattern`, `minimum`, `required`,
`properties`, `additionalProperties`, `items`, `anyOf`, `allOf`, `not` and `$ref` (the same set as
hpcworker's contract), and a reader ignores a field it does not know.

## How an export changes here

1. The code and the export change in one pull request. `contract/vectors/` is rewritten by the tool,
   never by hand: `node test/vectors.mjs --write` (it names, and never deletes, a vector no scenario
   makes any more). Until it is, `test/interface.test.mjs` fails, so an answer never moves silently.
   The vectors run the Worker with `wrangler.toml`'s `[vars]`, so a change there shows up here too.
2. An export's `version` goes up when a client must change its code: a field removed, renamed or
   retyped, a status or a reason whose meaning changes, a list line that reads differently, a route
   that goes away. An additive change (a new optional field, a new route, a new `reason` an older
   client reads as a plain no) keeps the version.
3. `routes.json` names every route the Worker answers; the test fails on a route added to the Worker
   and not here, or listed here and gone from the Worker.

## What checks it

- `test/interface.test.mjs`: the manifest's shape, every path names a file, `interface/` holds
  nothing unlisted; the schemas use only the keywords above and every reference resolves, and the
  check refuses what it should; `routes.json` against the Worker's routes; every vector is what the
  Worker answers now, and passes its route's method, status, content type, schemas and line grammar;
  every method of a route for programs has a vector; no vector shows a secret; the key and the list in
  the vectors verify with `key.json` and with no other key.
- `test/boundary.test.mjs`: no tracked file reaches another repository's checkout (a sibling path, a
  variable naming a checkout, a clone, a submodule, a workflow that checks out another repository,
  a dependency by path or git URL), with a known list of exceptions, each with its reason, that fails
  when an entry goes stale (empty today); the manifest's shape, kinds and paths; and no import, so no
  pinned copy anywhere.

Both run with `node --test test/*.test.mjs`, so in `ci.yml` on every pull request.
