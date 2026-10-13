# The access check: how Beethoven asks whether an account is approved

Beethoven, the browser extension, has no keys. (Beethoven is its name since 2026-09-29; it was built
as Ashley Bridge before, and its builds still send product `bridge`.) A person signs in to their own
Open OnDemand portal with their university account; the extension reads the account name the portal's
dashboard shows for that session and asks this service whether that account is approved. The answer
comes from the same approved list the admin page manages for Beethoven for VS Code (KV
`approved:<AccessID>`), so one approval serves both editions. Since 2026-09-30 (Beethoven 8.0.0) the
check also carries the installation's random identifier. Since 2026-10-11 an approved account works on
any number of its own installations, which the service records, and one installation serves one
account; from 2026-09-30 until then one approved account worked on one installation, and a second was
refused ([Installations](#installations)). This file is the contract as built in `worker.js`
(`accessCheck`, `installationRule`) and pinned by `test/worker.test.mjs`; both sides code to exactly this.
The same contract for programs, with the JSON Schemas and answers the real Worker gave, is
`interface/contract/` (`routes.json`, `access-check.request.schema.json`, `access-check.answer.schema.json`,
`vectors/access-check-*.json`).

## Where the address comes from

| Build | File read (key `access_check`) | Address |
|---|---|---|
| Beethoven 7.0.0 on | `https://openspineconsortium.com/beethoven/services.json` | `https://beethoven-access.openspineconsortium.workers.dev/access_check` |
| Beethoven 4.0.0 to 6.0.0 (built as Ashley Bridge) | `https://openspineconsortium.com/ashley/services.json` | `https://ashley-service.openspineconsortium.workers.dev/access_check` |

The two hosts are one Worker deployed under two names: the same code, the same KV namespaces, the
same secrets (README.md, "Two names"), so they give the same answer to the same check. The new file
is in the site repository and names the new host for every route (`deploy.sh` prints the service
addresses, and the site repository takes them in a reviewed commit); the old file is kept byte for byte
for the builds that read it. The extension caches
`services.json` for a day. The site repository's copies are published when that repository is pushed.

## Request

```
POST <access_check>
Content-Type: text/plain;charset=UTF-8

{"v":1,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"8.0.0","install_id":"0123456789abcdef0123456789abcdef"}
```

`text/plain` keeps the request simple (no CORS preflight); an `application/json` body is read the
same way. The body is JSON, 8 KiB at most. `v` stays 1: `install_id` is an added field, and a Worker
from before it ignores fields it does not know, so an 8.0.0 build works against either.

| Field | Rule | If it fails |
|---|---|---|
| `v` | the number 1 | 400 |
| `access_id` | the account name the portal shows: letters, digits, `.` `_` `@` `-`, 64 at most, case and surrounding spaces ignored | 400 |
| `portal` | the portal's hostname (a `:port` is allowed, for a mock portal on localhost); not a URL | 400 |
| `product` | a short name: `bridge` is what every Beethoven build sends (its name when it was built as Ashley Bridge, kept on the wire so 4.0.0 on keep working); `beethoven` is taken as the same product; any other short name is accepted, recorded under its own name, and answered with `REQUEST_PAGE` | 400 |
| `version` | the extension's version, like `4.0.0` | 400 |
| `install_id` | Beethoven 8.0.0 on: the random identifier the extension makes when it is installed (`storage.local` `bridge.install_id`, 16 random bytes as 32 hexadecimal characters; not derived from the device; a reinstall makes a new one). Taken: 16 to 64 of `0-9 a-f -`, case ignored. Absent, `null` or `""` is a build before 8.0.0 | 400 when present and not of that shape |

## Answers

Every answer, the refusals included, carries `access-control-allow-origin: *`, `cache-control:
no-store` and `content-type: application/json`; none carries `access-control-allow-credentials`.

| Status | Body | When |
|---|---|---|
| 204 | none, with `access-control-allow-methods: POST, OPTIONS`, `access-control-allow-headers: content-type`, `access-control-max-age: 600` | `OPTIONS` (a preflight, should a browser send one) |
| 200 | `{"approved":true,"access_id":"st1234","checked":"<ISO time>","until":null}` | the account is on the approved list with the grant `extension` and the installation rule lets it through; `until` is the approval's end date when the record has one (none does today) |
| 200 | `{"approved":false,"access_id":"st1234","requestPage":"https://openspineconsortium.com/beethoven/request.html"}` | the account is not on the list (never approved, pending, denied or removed), is a lab member only (grants `["lab"]`), is the store reviewers' mock account checked from a portal that is not local (The decision, step 2), or the name is not one the list can hold. `requestPage` is `BEETHOVEN_REQUEST_PAGE` in `wrangler.toml` for product `bridge` or `beethoven`, and `REQUEST_PAGE` for any other; both are `https://openspineconsortium.com/beethoven/request.html` since 2026-09-30, the one request page of both editions (before, `REQUEST_PAGE` was `/ashley/request.html`, which now redirects there) |
| 200 | `{"approved":false,"access_id":"st1234","reason":"other_account","requestPage":"..."}` | approved, but this installation is on another approved account's record (one installation serves one account) |
| 200 | `{"approved":false,"access_id":"st1234","reason":"update_required","requestPage":"..."}` | approved, but the check carries no `install_id` (a build before 8.0.0) and `REQUIRE_INSTALL_ID` is not `"0"`. What the extension said until 20.0.0: "Install the current Beethoven from the lab's private listing."; the listing is public since 20.0.0 (2026-10-13), and the extension's words are its own |
| 400 | `{"error":"..."}` | a malformed body (see the table above), or not JSON |
| 405 | `{"error":"POST the check here"}` | any method but POST and OPTIONS |
| 413 | `{"error":"too much text"}` | a body over 8 KiB |
| 429 | `{"error":"too many checks ... today; the last answer stands until tomorrow"}` | the day's cap: 120 checks per account, 2000 per connection (salted hash of the address) |
| 503 | `{"error":"the access service is not open yet"}` | the Worker has no `IP_SALT` secret (a deployment error) |

`reason` appears only on a refusal of an approved account, and before `requestPage`; a plain no has
none, so a build that does not know the field reads every refusal as a plain no. `requestPage` is on
every no, so older builds always have a page to open. A third reason, `other_installation` (approved,
but bound to another installation), was answered from 2026-09-30 to 2026-10-11 and is not any more: an
approved account works on every installation of its own. The extension still reads it, unchanged, for a
service deployed before that day.

The extension opens `requestPage` with `?access_id=<account>` appended; `request.html` fills its
first field from that and sends nothing until the person presses the button.

## The decision

In order:

1. `approved:<access_id>` exists in KV ACCESS, its `until` (an ISO date), if any, has not passed, and
   its `grants` include `extension`. A record written before grants existed has no `grants` field and
   counts as `["extension","lab"]`; a lab member only (`["lab"]`) gets a plain no, and nothing is
   bound. That record is written by the admin routes (`add`, `approve`, `grant`, `seat-rule`) and the
   e-mail links, and deleted by `remove` and Withdraw approval; nothing on this route writes it.
2. A record with `any_installation: true` is the store reviewers' mock account (set with
   `admin.mjs seat-rule <id> any`; today `st1234`, the name the mock portal signs in as). It is an
   approval **only when `portal` is `localhost` or a name ending in `.localhost`** (a port is allowed):
   the reviewers' mock portal runs on their own machine. There it is approved from any installation,
   with or without `install_id`, and records none. From any other portal it is not approved at all: the
   answer is the plain no an unknown account gets (no `reason`), no installation is recorded or changed, no
   refusal is recorded and nobody is e-mailed; only the `seen` record of the check is kept, as for any
   check. A check that names no portal is refused as malformed (400) and is never taken for a local
   one. The reason: `st1234` has the shape of a real Wayne State AccessID, so a real person may hold it,
   and the mock must grant that person nothing. (Changed 2026-10-01. From 2026-09-30 afternoon until
   then, a check from another portal was treated as an ordinary approval held to one installation, so
   the mock account could approve a first installation at the real portal.) The same test leaves the
   mock account off the approved list (`GET /admin/allowlist`), refuses it a key at `/trial` and leaves
   it out of the daily reminder while that was sent, until 2026-10-13 (`approvedFor` in `worker.js`).
3. Otherwise the installation rule decides ([Installations](#installations)).

The list itself is never returned on this route: one id in, yes or no out. Since 2026-10-01 it is not
returned anywhere else either: `GET /allowlist` answers an empty list to anyone (it gave every approved
AccessID to anyone until then, which the browser edition's privacy statement, version 8, does not
allow: "The service answers yes or no, and nothing else about you or anyone else"), and the services
files no longer name it. The maintainer reads the list at `GET /admin/allowlist`. It lists only the
accounts with the grant `extension` (since 2026-09-30), and never the store reviewers' mock account.

Cloudflare KV is eventually consistent: an approval or a removal can take up to about a minute to
reach every edge, so a check right after a click on the admin page may still see the old answer.

## Installations

An approved account works on any number of its own installations of Beethoven, and one installation
works for one account (the owner's decision of 2026-10-11; from 2026-09-30 until then one approved
account worked on one installation, and a second was refused with reason `other_installation`). The
installation is named by `install_id`, the random identifier the extension made when it was installed;
nothing about the computer goes into it, and a reinstall is a new installation. The service keeps, per
account, the ten installations most recently seen: identifier, first and last check, product and
version; it reads nothing else about them.

| The check | The answer | What is written |
|---|---|---|
| no `install_id`, `REQUIRE_INSTALL_ID` not `"0"` | `reason: "update_required"` | nothing but `seen` |
| no `install_id`, `REQUIRE_INSTALL_ID` `"0"` | yes, from the approved list alone (builds before 8.0.0 keep working) | nothing but `seen` |
| the installation is on the account's record | yes | its `last_seen`, `product`, `version` |
| the installation is not on the record, and serves no other account | yes: it joins the record | `seat:<access_id>` (the installation added; beyond ten, the one least recently seen is dropped and its index entry deleted) and `install:<install_id>`; `installed:<access_id>` once; when the record already held another installation, `notice:<access_id>` and one e-mail to the maintainer per account a day (below) |
| the installation is on another account's record (its `install:<install_id>` names that account, and that account's record lists it) | `reason: "other_account"`; nothing joins | `conflict:<access_id>` (kind `other_account`); no e-mail |

The e-mail about a new installation goes to `NOTIFY_TO`. It is a notice, not a refusal: "<name>
(<AccessID>) is using Beethoven on a new installation; nothing was refused.", the installations on record
(how many; each by fingerprint, the first 8 hexadecimal characters of a SHA-256 of the identifier, with
its first and last check and version), the new one (fingerprint, time, version, portal), and one signed
one-use link (14 days; GET shows a page and only its button acts): **Withdraw approval**, the same as
`admin.mjs remove`. The text shows only fingerprints. Its advice: a new installation is a new computer,
a new browser profile, Chrome Sync putting Beethoven on another computer, or a reinstall; nothing was
refused, and the approval works there from its first check; if the account is being shared, withdraw
it; the account name in a check is not proved, so ask the person first; doing nothing keeps Beethoven
working on every installation that asks. Without `DECIDE_KEY` the e-mail carries no link and names
`admin.mjs remove` and `reset-seat` instead.

The link carries `ref`, the version of the e-mail it came in, which the notice record keeps once that
e-mail has gone. It acts only while it is the one on record, so:

- a later e-mail about the same account (the next day's, after another new installation) replaces it:
  the older link answers "This e-mail was replaced ... see the newer e-mail" and changes nothing;
- once the account's installations are reset or the approval removed, the notice record is gone and the
  link answers that the e-mail is no longer on record;
- a link without `ref` (an e-mail sent before 2026-09-30 afternoon) answers "This link is out of date".

Until 2026-10-11 the e-mail was about a refusal and carried a second link, **Move the approval to the
new installation**. A Move link from one of those e-mails still verifies and answers "This link is out
of date", on GET and POST alike: there is nothing to move, since the installation it names is approved
at its first check after that day. It is never acted on, and the decision `move` is answered no other
way.

The maintainer's commands: `admin.mjs seat <id>` (the installations on record, one a line by
fingerprint, oldest first, with their first and last check, product and version, and the last refusal),
`admin.mjs reset-seat <id>` (clears the record and every index entry: each installation is recorded
again at its next check, and one freed may serve another account from then on), `admin.mjs seat-rule
<id> any|one`, and `remove`, which deletes the record with everything else, including the account's
access-check records. `admin.mjs list` shows how many installations each approval has, when the oldest
was first seen and when the newest was last seen.

What this does not do: the service answers yes or no to what the extension sends; it proves nothing
about the computer. A modified copy of the extension could skip the check or send another installation's
identifier copied out of its storage. The rule stops two accounts on one installation (`other_account`)
and tells the maintainer when an account turns up on a new one; it does not stop one account on several
computers, which is allowed, nor someone determined to get around it. Nor does the service know who
sends a check: the account name is whatever the check says, so anyone who knows an approved AccessID can
send checks in its name; that adds installations to the person's record and causes the e-mail, and
nothing else. A notice is not proof of sharing: ask the person before withdrawing. And while
`REQUIRE_INSTALL_ID` is `"0"` (as deployed on 2026-09-30), a build before 8.0.0 sends no identifier and
is answered from the approved list alone, recorded nowhere.

Two accounts checking from one installation for the first time within the same minute can both record
it (KV is eventually consistent; the index written last names the account the other is refused for at
its next check). A refusal of kind `other_installation` recorded before 2026-10-11 stays on the admin
routes until a new installation of that account is approved, which deletes it, or until `reset-seat` or
`remove`.

## What the service records

| Key | Value | Kept |
|---|---|---|
| `seen:<product>:<access_id>` | `access_id`, `product`, `portal`, `version` (of the last check), `first_seen`, `last_seen`, `checks` (how many), `approved` (the last decision), `reason` (when the last check was refused for one), `ip_hash` (salted SHA-256 of the address, 32 hex characters, salt `IP_SALT`, the same for both Worker names, kept in the vendor folder's `ip_salt`; a new salt only when that file is replaced), `changed_at` (when the decision last changed) | until the account is removed (Remove, `admin.mjs remove`, or Withdraw approval deletes the records of every product for that account, since 2026-09-30 afternoon); a check after that starts a new record |
| `seat:<access_id>` | `installs`: up to ten `{install_id, first_seen, last_seen, product, version}`, the installations the account has asked from, oldest first (a record written before 2026-10-11 holds its one installation at the top level, with `moved_at` and `by` after a Move, and is rewritten in this shape at the account's next check) | until reset or removed; an installation beyond the ten most recently seen is dropped |
| `install:<install_id>` | `access_id`, `bound_at`: which account the installation serves | as long as it is on that account's record |
| `installed:<access_id>` | `at`, `product`, `version`: when the account's first installation checked in (the lifecycle's "installed"; a check never writes the approved record itself, so a check that raced a removal cannot bring the approval back) | until removed; a reset keeps it |
| `conflict:<access_id>` | `kind` (`other_account`; `other_installation` only on a record from before 2026-10-11, which goes when a new installation of the account is approved), `count`, `first_at`, `last_at`, `other_install_short` (the fingerprint of the installation last refused) | 12 months from the last refusal, or until reset or removed |
| `notice:<access_id>` | `ref` (the version of the last e-mail about a new installation; its Withdraw link acts only while it is the one on record), `sent_at`, `install_short` (the new installation's fingerprint), `installations` (how many were on record then) | 12 months, or until reset or removed |
| `install_notified:<access_id>` | when the last e-mail about a new installation went (`conflict_notified:<access_id>` until 2026-10-11) | 24 hours |
| `chk:<access_id>:<day>`, `chkip:<ip_hash>:<day>` | the day's counters | 2 days |

The network address itself is never stored, and an installation that was refused is kept only as its
fingerprint; the identifiers on an account's record leave the service nowhere (`admin.mjs seat` shows
fingerprints). A refused check (400, 413, 429, 503) writes no `seen` record; only the per-connection
counter is touched. The checks are listed, newest first, as `checks` in `GET /admin/list` and
`admin.mjs list`, and the installations and refusals as `seats` and `conflicts` there, with counts and
dates and no identifier or fingerprint; none of it is on a public route.

## What the extension does with the answer

Approved: works; the answer is cached for 24 hours and kept up to 7 days when the service cannot be
reached. Not approved: the strip's one button reads "Ask for access"; the answer is cached for 10
minutes. `other_account`: "This installation of Beethoven is already set up for another account. Ask
your lab lead to move it to yours." with no button; the maintainer's remedy is `reset-seat` or
`remove` on the other account, which frees the installation (there is no Move). `update_required`:
"Install the current Beethoven from the lab's private listing." (its words until 20.0.0; the listing is
public since 2026-10-13). `other_installation`, which the
service answered until 2026-10-11, is still read as before ("This account is already set up on
another computer. Ask your lab lead to move it here." with no button), for a service deployed before
that day. Re-checked on a click of the icon once the last answer is a day old or was no, and about
once a day, and only after the agreement is accepted, the portal is connected and the dashboard
identity is known. Approval withdrawn (Remove on the admin page, `admin.mjs remove`, or Withdraw
approval in the e-mail) means the next check answers no and the extension stops starting workers and
says so. Because an approval is cached for a day, a withdrawal reaches an installation that was
approved at its next check after that day, and up to 7 days later when it cannot reach the service.
A new installation of an approved account needs no step of anyone's: it is approved at its first
check.

## The VS Code edition

`/trial`, `/revoked` and `/report` behave as before, with two changes. Since 2026-09-30 a lab member
only (grants `["lab"]`) gets no key from `/trial`; every record written before grants existed counts
as both, so nobody approved before then is affected. Since 2026-10-01 the store reviewers' mock
account (`any_installation: true`, today `st1234`) gets no key from `/trial` either: it is an approval
on a local mock portal only.

`/allowlist` changed on 2026-10-01: it names nobody, to anyone. Ashley for VS Code 3.0.0 and Beethoven
for VS Code 4.0.0 read it only when their services file (`/ashley/services.json`,
`/beethoven/services.json`) names it, and neither does since that day. With no list address and a
`license_service` address, both builds skip the list at the Wayne State sign-in step (`allowlist()`
answers null, "the service decides"), and `/trial` refuses a person who is not approved, with the
request page, which both builds show. A build that still holds the old address in its one-hour cache
reads the empty list and refuses the sign-in step to anyone without a key until it fetches the file
again; so the site goes out first and the Worker an hour or more later. A person who set
`beethoven.allowlistUrl` or `ashley.allowlistUrl` by hand (empty by default) is refused at that step,
unless they hold a key in their own name, until they clear it. The VS Code edition's privacy statement
(version 5) still says it fetches the list of approved AccessIDs daily; that is broader than what it
now does, and its next version should say so.

Ashley for VS Code 3.0.0 on the Marketplace and Beethoven for VS Code 4.0.0 keep their own key flow; the
keys are still signed `ASHLEY1.` (README.md, "The key prefixes"). The VS Code edition does not call
`/access_check`, so the installation rule does not apply to it.

## The admin routes: the admin page's contract

Written 2026-09-30 for the admin page (`tools/pages/beethoven/admin/body.html` in the site repository)
and `admin.mjs`. Nothing here is public: every route is behind the bearer token.

**Every call.** `https://beethoven-access.openspineconsortium.workers.dev/admin/<route>` (the page reads
the address from `license_service`'s origin in `/beethoven/services.json`; either Worker name answers the
same). Header `Authorization: Bearer <admin token>` (the vendor folder's `admin_token`; the two lists the
grid reads also take the grid token, [The lists the grid reads](#the-lists-the-grid-reads-2026-10-07)). From a browser
the `Origin` must be `SITE_ORIGIN` (`https://openspineconsortium.com`); any other origin gets 403 with no
CORS header. `OPTIONS` answers 204 with `access-control-allow-origin: https://openspineconsortium.com`,
`access-control-allow-credentials: true`, `access-control-allow-methods: GET, POST, OPTIONS`,
`access-control-allow-headers: authorization, content-type`. `GET` for `list`; every other route is
`POST` with a JSON body (`content-type: application/json`, 8 KiB at most) naming `accessId` (two letters
and four digits). Errors are `{"error":"<plain sentence>"}` with 400 (a bad body), 401 (token missing or
wrong), 404 (no such route, or nobody by that AccessID where one is needed) or 409 (the state does not
allow it); the page shows the sentence as it is.

**Since 2026-10-13 (Beethoven 20.0.0) the store listing is public** (README.md, The store listing). That
retired the invitation: the request form's Google account is optional, the approval e-mails say Beethoven
installs from the Chrome Web Store (the link is on https://openspineconsortium.com/beethoven/), and the
daily reminder is not sent. The `group`, `invite`, `invited` and `invited_at` parts below stay as they
were, so the admin page and older records keep working; nobody needs the mark now.

**`GET /admin/list`** answers 200:

```
{
  "now": "<ISO time of the answer>",
  "group": { "name": "Beethoven-users", "members_url": "https://groups.google.com/g/beethoven-users/members",
             "mode": "manual" | "workspace", "address": "beethoven-users@openspineconsortium.com" (workspace only) },
  "pending":  [ <request> ... ],     sorted by accessId
  "approved": [ <approval> ... ],    sorted by accessId
  "denied":   [ <denial> ... ],
  "revoked":  [ "L-..." ... ],
  "checks":   [ <seen record> ... ],  newest first (What the service records)
  "seats":    [ { accessId, installations, first_seen, last_seen, product, version } ... ],
  "conflicts":[ { accessId, kind, count, first_at, last_at } ... ]
}
```

A **request** (`pending`):

| Field | Meaning |
|---|---|
| `accessId`, `name`, `email` | as the form sent them (`email` is always `<accessId>@wayne.edu`) |
| `google_account` | the Google account given, when one was (optional since 2026-10-13; absent on a request from the older form); until then the one to invite |
| `note` | what they will use Beethoven for (the form's "purpose") |
| `cv` | `{ "name", "kind": "pdf"\|"docx"\|"doc", "size" }` when a CV came with it; fetch it with `POST /admin/cv` |
| `mailbox` | `"waiting"` (the confirmation e-mail went; not confirmed yet), `"confirmed"`, or `"not_verified"` (MAIL_STUDENTS is `"0"`: nobody checked the mailbox) |
| `stage` | `"unconfirmed"` (mailbox `waiting`) or `"submitted"` (ready for a decision) |
| `requested_at` | the first time this AccessID asked; `submitted_at` the time this version of the request was sent |
| `confirmed_at` | when the student used the confirmation link (confirmed only) |
| `age_hours` | whole hours since `submitted_at` |
| `expires_at` | unconfirmed only: when KV drops the request and its CV (7 days after it was last sent); the student can send the form again |
| `confirm_mail` | `"failed"` when the confirmation e-mail could not be sent (the student was told; the request waits unconfirmed) |
| `asked_from`, `v`, `ref` | the product named on the form, the form version, the version stamp of the request (the e-mail links carry it) |

An **approval** (`approved`):

| Field | Meaning |
|---|---|
| `accessId`, `name`, `email`, `google_account`, `note` | carried from the request, or given with `add` |
| `grants` | `["extension","lab"]`, `["lab"]` or `["extension"]` |
| `stage` | `"lab"` (lab member only), `"approved"` (Beethoven, not marked invited), `"invited"` (a mark made until 2026-10-13), `"installed"` (its first installation has checked in) |
| `approved_at` | the first approval; `decided_at` and `decision` (`"approve"` or `"lab"`) the latest decision |
| `submitted_at`, `confirmed_at`, `mailbox` | the lifecycle of the request it came from, when it came from one |
| `invited_at`, `invited_by` | when it was marked invited to Beethoven-users (a step of the private listing, until 2026-10-13), and by what (`"e-mail link"`, `"admin"`, `"workspace"`) |
| `installed_at` | when the first installation checked in (set once; a reset keeps it) |
| `seat` | `{ "bound": true, "installations", "first_seen", "last_seen", "product", "version" }` or `{ "bound": false }`: how many installations the account has asked from (the ten most recently seen are kept), the oldest one's first check, the newest one's last check and what it runs (since 2026-10-11; before, one installation and `moved_at` after a Move) |
| `conflicts` | the number of refusals on record (0 when none); `conflict_last_at` the last one |
| `any_installation` | `true` only for the store reviewers' mock account: approved in an access check from a localhost portal only (from any installation, recording none), refused from any other portal, not on the approved list, no key from `/trial`, never in the daily reminder while it was sent. Absent on every other approval. The page's Installation column says "Any installation: binds none: the store reviewers' mock account, on a localhost portal only", and its stage reads "Store reviewers" while the stage is `approved` |
| `lids` | the licence ids issued to them by `/trial` |

**`GET /admin/allowlist`** answers 200 with `{"about":"AccessIDs approved to use Beethoven","accessIds":[...]}`:
the AccessIDs with the grant `extension`, sorted, without the store reviewers' mock account; the list
the public `GET /allowlist` gave to anyone until 2026-10-01. The page does not use it. The same AccessIDs
as plain text are `GET /admin/roster.txt` ([The lists the grid reads](#the-lists-the-grid-reads-2026-10-07)).

A **denial** (`denied`): `accessId`, `name`, `email`, `google_account`, `note`, `requested_at`,
`submitted_at`, `confirmed_at`, `mailbox`, `ref`, `denied_at`, `decided_at` (the same time), `decision: "deny"`,
`reason`, `by`.

**Writes** (each leaves an audit line; each answers 200 with the JSON shown):

| Route | Body | Answer | What it does |
|---|---|---|---|
| `approve` | `{ accessId, grants?, note? }` (`grants` absent = `["extension","lab"]`; `["lab"]` = Lab only) | `{ status: "approved", accessId, record, invite }`; 404 when there is no request | the Approve buttons. `invite` is `null` for Lab only; otherwise `{ group: "Beethoven-users", members_url, google_account (null when the older form gave none), invited: bool, mode: "manual"\|"workspace", address? (workspace), invited_at? (set when the service added them), error? (why the service could not add them) }`. When `invited` is false the page shows "Next: add <google_account> to the Google Group Beethoven-users", the address with a copy button, the members page and a Mark invited button; since 2026-10-13 the listing is public, so there is no group to add anyone to, and the step and the mark stay for older records' sake |
| `deny` | `{ accessId, reason? }` | `{ status: "denied", accessId, lab_member? }`; 409 when approved for Beethoven | Deny |
| `invited` | `{ accessId }`, or `{ accessId, clear: true }` | `{ status: "invited", accessId, invited_at }` (`already: true` added when it was marked before; the date is not changed) or `{ status: "not-invited", accessId }`; 404 when not approved, 409 when lab only | Mark invited (stamps `invited_at`, `invited_by: "admin"`) |
| `reset-seat` | `{ accessId }` | `{ status: "reset", accessId, had_seat }` | Reset seat: the account's installations are forgotten (the record, every index entry, the refusal and the notice); each is recorded again at its next check, and one freed may serve another account |
| `remove` | `{ accessId }` | `{ status: "removed", accessId, revoked: [lids] }` | Remove: every record of the person (approved, pending, denied, seat with every index entry, installed, conflict, notice, CV, and `seen:<product>:<accessId>` for every product), keys revoked |
| `cv` | `{ accessId }` | the file itself: `content-type` application/pdf or a Word type, `content-disposition: attachment; filename="<accessId>-cv.<ext>"` (exposed to the page), 404 JSON when none | the CV link: fetch, make a blob URL, open or save it |
| `seat` | `{ accessId }` | `{ accessId, any_installation, installs: [ {install_short, first_seen, last_seen, product, version} ... ], conflict: {kind, count, first_at, last_at, other_install_short} \| null }` | the installations by fingerprint, oldest first (empty when none), and the last refusal, for the command line |
| `add`, `grant`, `seat-rule`, `revoke-lid`, `notify-test` | as before (README.md, "The approved list, day to day") | | |

The page never sees an installation identifier or a decision link: the lists carry dates, counts and
stages only, and the links in the e-mails stay in the e-mails.

### Lab storage, read only (`storage.js`, 2026-10-07)

The admin page's section **Lab storage, read only** and `admin.mjs storage-*` and `readers`. Same address,
token, origin, CORS and error shapes as above. A **folder** is a path under the root (`/rs/rs_grp_oschome`
unless `STORAGE_ROOT` names another) as `tools/grid_access.sh` takes it: parts of letters, digits, dots,
dashes and underscores, each starting with a letter, a digit or an underscore, joined by `/`, 200
characters at most; a list holds one to eight, sorted, without repeats. A write's `folders` may be a list
or one text with a folder a line; the root written in front is taken off, and anything else absolute is
refused with 400. The whole volume (since 2026-10-07) is one folder spelled `.`: a write may name it as `.`
or as the root itself, with or without a slash behind, and it is stored, listed and printed as `.`. It
covers every folder, so it is always a reader's only one: a list that names it beside others is `["."]`,
and an approval that adds folders to a reader of `.`, or `.` to a reader of folders, leaves `["."]`. The
e-mail and the decision pages say "all of the lab storage (`/rs/rs_grp_oschome`)", never a bare `.`.

**`GET /admin/storage-list`** answers 200 (404 from a service deployed before it; the page then hides the
section):

```
{
  "now": "<ISO time>",
  "root": "/rs/rs_grp_oschome",
  "pending": [ { accessId, name, email, note, folders, requested_at, submitted_at, ref, mailbox: "not_verified", age_hours } ... ],
  "readers": [ { accessId, name, email, note, folders, approved_at, decided_at, decision: "approve"|"add", by,
                 requested_at?, submitted_at?, mailbox?, ref? } ... ],
  "denied":  [ { accessId, name, email, note, folders, requested_at, submitted_at, ref, mailbox, denied_at, decided_at,
                 decision: "deny", by, reason } ... ]
}
```

each sorted by `accessId`. `note` is what the person said they need the folders for.

| Route | Body | Answer | What it does |
|---|---|---|---|
| `storage-approve` | `{ accessId, folders? }` | `{ status: "approved", accessId, added, record }`; 404 when there is no request | adds `folders` (the request's when absent; fewer, or others, when given) to what the reader reads; the request goes, and so does a denial |
| `storage-deny` | `{ accessId, reason? }` | `{ status: "denied", accessId, reads? }`; 404 when there is no request | the request becomes a denial; a reader keeps their folders (`reads`); the storage page answers "denied" while the denial is on record |
| `storage-add` | `{ accessId, folders, name?, note? }` | `{ status: "approved", accessId, record }` | a reader without a request, or a reader's folders set exactly (an empty list is refused: use `storage-remove`); a request or a denial on record goes |
| `storage-remove` | `{ accessId }` | `{ status: "removed", accessId, folders? }`; 404 when there is no storage record | every storage record of the person: their folders, a request and a denial |

`admin.mjs readers` prints `GET /admin/readers.txt` as it comes: `<accessId> <folder>` for each reader and
folder, sorted, and nothing else (`<accessId> .` for a reader of the whole volume), what
`tools/grid_access.sh` in `hpcworker` applies ([The lists the grid reads](#the-lists-the-grid-reads-2026-10-07)).

### The lists the grid reads (2026-10-07)

Two plain-text routes give the lists `tools/grid_access.sh` in `hpcworker` applies on the grid, and
`admin.mjs roster` and `admin.mjs readers` print their bodies byte for byte. Same address, origin and CORS
as above; the token is the admin token or the grid token (below), and the two get the same answers. A
wrong or missing token is the JSON 401 and another site's page the JSON 403 of every admin route; a POST
to either is an unknown write (404) with the admin token, and the 401 with the grid token.

| Route | Body (`text/plain; charset=utf-8`, `cache-control: no-store`) |
|---|---|
| **`GET /admin/roster.txt`** | the approved list: one AccessID a line, the same AccessIDs in the same order as `GET /admin/allowlist` (the grant `extension`, sorted, without the store reviewers' mock account) |
| **`GET /admin/readers.txt`** | the readers of lab storage: `<AccessID> <folder>` a line, by AccessID and then folder, `<AccessID> .` for a reader of the whole volume |

The grammar, which `hpcworker`'s tool checks again on its side: every line ends with a newline (`\n`, never
`\r`), and an empty list is an empty body, never a blank line. A roster line is an AccessID, two lower-case
letters and four digits (`^[a-z]{2}[0-9]{4}$`). A readers line is an AccessID, one space and a folder as
`storage.js` stores it: `.`, or parts of letters, digits, dots, dashes and underscores, each starting with
a letter, a digit or an underscore, joined by `/`, 200 characters at most. The published contract has
both grammars (`interface/contract/lines.json`) and answers the real Worker gave (`vectors/`).

A service deployed before these routes answers them 404 (as any unknown admin route); the grid tool,
which fetches them itself, then refuses with nothing changed rather than taking anyone's entries away, as
on any answer that is not 200 plain text (a sign-in page in front of the service, say), and `admin.mjs`
says to deploy and ends with exit 1, with nothing on stdout. Deploy the service (both names) before a
grid tool that reads them.

**The grid token** (2026-10-07). The job on the grid reads the two lists with a token of its own, so the
admin token never sits on the cluster: `tools/grid_access.sh` reads the file `grid_token` in its vendor
folder, and `admin_token` only when there is none. The maintainer makes the grid token on the admin page,
which downloads it as that file. It reads `GET /admin/roster.txt` and `GET /admin/readers.txt` and
nothing else: on every other admin route, the three below included, it is answered exactly as a wrong
admin token (401, `{"error":"admin token missing or wrong"}`), and from another site's page the 403 comes
first, as for any token. The service keeps only its SHA-256 (KV `ACCESS`, `grid-token`, with `made_at`),
compares the hash of the bearer value with it over every character, and shows the token once, in the
answer that makes it.

| Route (admin token only) | Body | Answer |
|---|---|---|
| **`POST /admin/grid-token`** | `{}` (a JSON object, as every admin write) | `{ "token": "<64 lower-case hexadecimal characters>", "made_at": "<ISO time>", "replaced": true\|false }`, `cache-control: no-store`. A new token replaces any earlier one (`replaced: true`), which reads nothing from then on. The page saves `token` as the file `grid_token`; a lost token is not recovered, only replaced |
| **`POST /admin/grid-token-withdraw`** | `{}` | `{ "withdrawn": true\|false }` (`false` when there was none): the lists answer the token 401 from then on |
| **`GET /admin/grid-token`** | | `{ "made_at": "<ISO time>"\|null, "last_read_at": "<ISO time>"\|null }`: when the token was made and when it last read a list, `null` when there is none or it has not read one since it was made; never the token or its hash |

**When a change takes hold.** KV is eventually consistent: a new token, or a withdrawal, holds at once at
the Cloudflare location that made it, and other locations may take the old token, or refuse the new one,
for about a minute. A grid run in that minute may be refused; it then changes nothing and works at its
next run.
**The last read** is recorded when the grid token reads a list and the last record is absent, another
token's, or more than an hour old (exactly an hour is not more), so the lists' readers cost about 24 KV
writes a day. Only the token's record is read before the answer, so a wrong token costs one KV read; the
last read is looked up and, when due, written after the answer, handed to `ctx.waitUntil`, and nothing in
that, a lookup that fails, never answers or finds a record that is not JSON, or a failed write, fails or
holds up the read (a record that is not JSON counts as none, and the next read writes a good one). It is
kept under a key of its own (`grid-token-read`), tied to its token by the first 16 characters of the hash,
so a late write from a location still holding a replaced or withdrawn record never brings that token
back; such a write may land for about a minute after the change, and counts for no token.
**Making one** takes the old token's last read away first and then writes the new record, so a failure
before the new record replaces nothing and the old token still reads; once the new record is written the
answer always carries the new token, and a failed audit line is logged by the error's name.

## The proofs, as they were recorded

The sections below are records of what was run against the deployed Worker, each on its date, and are
kept as they were written. They were run in Beethoven for VS Code's repository, where this service lived
as `tools/intake` until 2026-10-07, so their commands and test counts name that layout
(`node tools/intake/admin.mjs ...`, `worker.test.mjs`, `tools/license/vendor.test.mjs`). From this
repository's root the same commands are `node admin.mjs ...`, and the tests are
`node --test test/*.test.mjs`. One change only: this file is exported to other repositories
(`interface/INTERFACE.json`), so a student who was on the approved list then is called "a student"
below instead of by their AccessID. Every other AccessID below is the maintainer's, the store reviewers'
mock account or made up for the proof.

## Proof, 2026-09-29 afternoon (before the public name changed)

This one predates Beethoven: a no then named Ashley's request page for product `bridge`. The proof
for the two names follows it.

Taken with curl from Windows against the deployed Worker, right after `deploy.sh` and
`admin.mjs add st1234 "Store reviewer (mock portal)" st1234@wayne.edu "store-reviewer mock username"`.
Cloudflare's own headers (`date`, `server`, `cf-ray`, `nel`, `report-to`, `alt-svc`) are left out.

```
$ curl -i -X OPTIONS -H 'Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop' .../access_check
HTTP/2 204
access-control-allow-origin: *
cache-control: no-store
access-control-allow-headers: content-type
access-control-allow-methods: POST, OPTIONS
access-control-max-age: 600

$ curl -i -X POST -H 'Content-Type: text/plain;charset=UTF-8' -H 'Origin: chrome-extension://...' \
    --data '{"v":1,"access_id":"zz9876","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"4.0.0"}' .../access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/ashley/request.html"}

$ curl -i -X POST -H 'Content-Type: text/plain;charset=UTF-8' -H 'Origin: chrome-extension://...' \
    --data '{"v":1,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"4.0.0"}' .../access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":true,"access_id":"st1234","checked":"2026-09-29T17:44:54.874Z","until":null}

$ curl -i -X POST -H 'Content-Type: text/plain;charset=UTF-8' -H 'Origin: chrome-extension://...' --data 'not json' .../access_check
HTTP/2 400
access-control-allow-origin: *
cache-control: no-store

{"error":"not JSON"}

$ curl -i -X POST ... --data '{"v":2,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"4.0.0"}' .../access_check
HTTP/2 400
access-control-allow-origin: *
cache-control: no-store

{"error":"v must be 1"}

$ curl -i .../access_check
HTTP/2 405
access-control-allow-origin: *
cache-control: no-store

{"error":"POST the check here"}

$ curl -i -X POST -H 'Content-Type: application/json' \
    --data '{"v":1,"access_id":"john.doe","portal":"localhost:8080","product":"bridge","version":"4.0.0"}' .../access_check
HTTP/2 200
access-control-allow-origin: *
cache-control: no-store

{"approved":false,"access_id":"john.doe","requestPage":"https://openspineconsortium.com/ashley/request.html"}
```

`admin.mjs list` afterwards showed `approved (2)`: go2432 and st1234 (note "store-reviewer mock
username", `lids: []`), and `checks (3)`: zz9876 not approved, st1234 approved, john.doe not approved,
each with `portal`, `version 4.0.0`, the times and a 32-character `ip_hash`; no address anywhere.
`GET /allowlist` still answers `{"about":"AccessIDs approved to use Ashley","accessIds":[...]}` with
`access-control-allow-origin: *` and `cache-control: max-age=60`, as Ashley in VS Code 3.0.0 expects.

## Proof, two names, 2026-09-29 evening

Both names deployed from WSL with `deploy.sh` (`WORKER_NAME=beethoven-access` for the second), then
taken with curl from Windows at about 20:08 Detroit time (00:08 UTC on 2026-09-30). The new name
answers on `https://beethoven-access.openspineconsortium.workers.dev`. Cloudflare's own headers
(`date`, `server`, `cf-ray`, `nel`, `report-to`, `alt-svc`, `content-length`, `vary`) are left out.
`EXT` is `chrome-extension://abcdefghijklmnopabcdefghijklmnop`.

The new host:

```
$ curl -i -X OPTIONS -H "Origin: $EXT" https://beethoven-access.openspineconsortium.workers.dev/access_check
HTTP/2 204
access-control-allow-origin: *
cache-control: no-store
access-control-allow-headers: content-type
access-control-allow-methods: POST, OPTIONS
access-control-max-age: 600

$ curl -i -X POST -H 'Content-Type: text/plain;charset=UTF-8' -H "Origin: $EXT" \
    --data '{"v":1,"access_id":"zz9876","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"7.0.0"}' \
    https://beethoven-access.openspineconsortium.workers.dev/access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/beethoven/request.html"}

$ curl -i -X POST ... --data '{"v":1,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"7.0.0"}' \
    https://beethoven-access.openspineconsortium.workers.dev/access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":true,"access_id":"st1234","checked":"2026-09-30T00:08:14.614Z","until":null}

$ curl -i -X POST ... --data '{"v":1,"access_id":"zz9876","portal":"ondemand.grid.wayne.edu","product":"ashley","version":"3.0.0"}' \
    https://beethoven-access.openspineconsortium.workers.dev/access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/ashley/request.html"}

$ curl -i https://beethoven-access.openspineconsortium.workers.dev/health
HTTP/2 200
content-type: application/json
cache-control: no-store

{"ok":true}

$ curl -i -X OPTIONS -H 'Origin: https://openspineconsortium.com' -H 'Access-Control-Request-Method: POST' \
    https://beethoven-access.openspineconsortium.workers.dev/request
HTTP/2 204
access-control-allow-origin: https://openspineconsortium.com
access-control-allow-credentials: true
access-control-allow-headers: authorization, content-type
access-control-allow-methods: GET, POST, OPTIONS
access-control-max-age: 600

$ curl -s https://beethoven-access.openspineconsortium.workers.dev/revoked
ASHLEYREV1.eyJ2IjoxLCJra...    (305 characters; SHA-256 begins 1887a2e3e53a5768)
```

The old host, `https://ashley-service.openspineconsortium.workers.dev`, gave the same answers to the
same seven calls: the 204 preflight with the same four headers, the same `/request` preflight,
`{"ok":true}`, the same signed `/revoked` list (305 characters, the same SHA-256), and these bodies,
each with `content-type: application/json`, `access-control-allow-origin: *` and
`cache-control: no-store`:

```
product bridge, zz9876: {"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/beethoven/request.html"}
product bridge, st1234: {"approved":true,"access_id":"st1234","checked":"2026-09-30T00:08:32.738Z","until":null}
product ashley, zz9876: {"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/ashley/request.html"}
```

`GET /allowlist` hashed the same on both hosts, and
`GET /admin/list` with the one admin token answered on both with the same counts (approved 3, pending
0, denied 0, checks 6), so the two names share the KV namespaces and the admin secret. `wrangler secret
list` shows the same seven secret names on both: `ADMIN_TOKEN`, `DECIDE_KEY`, `IP_SALT`, `MAIL_FROM`,
`NOTIFY_TO`, `TRIAL_KEY_PKCS8_B64`, `TRIAL_KID`. At about 20:15, once `resend_api_key` in the vendor
folder held a Resend key, both names were deployed again and both list an eighth, `RESEND_API_KEY`;
`admin.mjs notify-test` through the new host printed `sent: the provider answered 200`.

Until the site repository publishes `https://openspineconsortium.com/beethoven/request.html`, that
address answers 404 (checked at the same time), so a no sends a person to a page that is not there
yet; `https://openspineconsortium.com/ashley/request.html` still works for the same approved list.

## Proof, the rename to Beethoven, 2026-09-30 early morning

Both names deployed again from WSL with `deploy.sh`, `beethoven-access` now the default and
`WORKER_NAME=ashley-service` the second, with the vendor folder at its new place
(`BEETHOVEN_VENDOR_DIR=/mnt/c/Users/grego/.beethoven-vendor`; `mail_from` rewritten to
`Beethoven access <onboarding@resend.dev>` first). Both found the three KV namespaces by the ids in
`wrangler.toml`, `deploy.sh` put the same eight secrets on both from the vendor folder, and it left the site's `beethoven/services.json`
unchanged, since it already named `beethoven-access` for all six routes. Then, read-only, from WSL
(`chrome-extension://...` as the Origin of the checks, product `bridge` and product `ashley`, version
3.0.0), the same answers from both hosts:

```
health:        {"ok":true}
allowlist:     {"about":"AccessIDs approved to use Beethoven","accessIds":[ ...
revoked:       ASHLEYREV1. ...
check bridge:  {"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/beethoven/request.html"}
check ashley:  {"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/beethoven/request.html"}
trial no auth: 401
decide bad:    <h1>This link is not valid</h1> href="https://openspineconsortium.com/beethoven/admin.html"
report bad:    {"error":"not a Beethoven report"}
```

`admin.mjs notify-test`, once through each name, printed `sent: the provider answered 200` both times
(subject `Beethoven access: test e-mail`, sender from `mail_from`). At the same time
`https://openspineconsortium.com/beethoven/admin.html` answered 404 (the site repository had not been
pushed with it yet) while `/ashley/admin.html` answered 200: until that push, the admin-page link in
the e-mails and on the `/decide` pages leads nowhere, and `/ashley/admin.html` is the admin page. The
Approve and Deny links themselves do not depend on it.

## Proof, one installation per account, 2026-09-30 morning

Both names deployed from WSL with `deploy.sh` (`SKIP_SITE=1` for the first; the second with
`WORKER_NAME=ashley-service`), `wrangler.toml` saying `REQUIRE_INSTALL_ID = "0"` and `MAIL_STUDENTS = "0"`.
Both found the three KV namespaces by their ids, got the same eight secrets, and answered `/health`
`{"ok":true}`. The checks were taken with Git Bash's curl on Windows at 14:04 to 14:05 UTC; `admin.mjs`
ran from WSL, because Windows node timed out connecting to Cloudflare (`UND_ERR_CONNECT_TIMEOUT`).
`zz0007` and `zz0008` are made-up AccessIDs, removed at the end. Every answer below also carried
`content-type: application/json`, `access-control-allow-origin: *` and `cache-control: no-store`.
`EXT` is `chrome-extension://abcdefghijklmnopabcdefghijklmnop`, `IA` is
`0123456789abcdef0123456789abcdef` and `IB` is `fedcba9876543210fedcba9876543210`.

```
$ node tools/intake/admin.mjs add zz0007 "Service proof (made-up account)" zz0007@wayne.edu "made up for the 2026-09-30 proof; removed after"
{"status":"approved","accessId":"zz0007","record":{..., "lids":[],"grants":["extension","lab"]}}

POST https://beethoven-access.openspineconsortium.workers.dev/access_check   (text/plain, Origin: EXT)
{"v":1,"access_id":"zz0007","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"8.0.0","install_id":"IA"}
HTTP/2 200  {"approved":true,"access_id":"zz0007","checked":"2026-09-30T14:04:59.211Z","until":null}      (binds)

the same again
HTTP/2 200  {"approved":true,"access_id":"zz0007","checked":"2026-09-30T14:05:02.159Z","until":null}      (repeats)

{"v":1,"access_id":"zz0007","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"8.0.0","install_id":"IB"}
HTTP/2 200  {"approved":false,"access_id":"zz0007","reason":"other_installation","requestPage":"https://openspineconsortium.com/beethoven/request.html"}

{"v":1,"access_id":"zz0007","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"7.0.0"}
HTTP/2 200  {"approved":true,"access_id":"zz0007","checked":"2026-09-30T14:05:07.108Z","until":null}      (REQUIRE_INSTALL_ID "0")

POST https://ashley-service.openspineconsortium.workers.dev/access_check, IA, then IB
HTTP/2 200  {"approved":true,"access_id":"zz0007","checked":"2026-09-30T14:05:09.073Z","until":null}
HTTP/2 200  {"approved":false,"access_id":"zz0007","reason":"other_installation","requestPage":"https://openspineconsortium.com/beethoven/request.html"}

{"v":1,"access_id":"zz0007","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"8.0.0","install_id":"not-hex"}
HTTP/2 400  {"error":"install_id is the random identifier Beethoven makes when it is installed (32 hexadecimal characters)"}

$ node tools/intake/admin.mjs seat zz0007
{"accessId":"zz0007","any_installation":false,
 "seat":{"install_short":"3eb1bd43","first_seen":"2026-09-30T14:04:59.211Z","last_seen":"2026-09-30T14:05:09.073Z","product":"bridge","version":"8.0.0"},
 "conflict":{"kind":"other_installation","count":2,"first_at":"2026-09-30T14:05:04.824Z","last_at":"2026-09-30T14:05:11.353Z","other_install_short":"4ba68aa8"}}

POST https://beethoven-access.openspineconsortium.workers.dev/request   (application/json, Origin: https://openspineconsortium.com)
{"v":2,"access_id":"zz0008","name":"Service proof (made-up account)","email":"zz0008@wayne.edu","google_account":"service.proof@example.com","purpose":"a made-up request to prove the service after the 2026-09-30 deploy; removed after","product":"bridge"}
HTTP/2 202  {"status":"pending","mailbox":"not_verified"}      (access-control-allow-origin: https://openspineconsortium.com)
```

The two installations answered the same on both hosts, so both names run the new code on the same
records. The refusals counted across both (`count` 2), and one e-mail went: KV afterwards held
`conflict_notified:zz0007` (14:05:05) and `notified:zz0008` (14:04:04), which the Worker writes only
after Resend accepted the message. What the e-mails looked like in the inbox was not seen from here.

A check without `install_id` answered **yes**, because `REQUIRE_INSTALL_ID` is `"0"`: every Beethoven
7.0.0 in use (and 4.0.0 to 6.0.0 through `ashley-service`) sends no identifier, and requiring one now
would refuse them all. `update_required` is therefore proved by the tests only
(`worker.test.mjs`, "without install_id an approved account is refused update_required, unless
REQUIRE_INSTALL_ID is \"0\""), not live. It goes live when `wrangler.toml` says `"1"` and both names are
deployed again, after Beethoven 8.0.0 is on the private listing.

**A slip in the first pass, and what it showed.** The first attempt ran `admin.mjs add zz0007` with
Windows node, which timed out, so `zz0007` was not approved when the next call sent it a v2 request
with a 5 MB PDF-shaped CV (6,990,766 bytes of JSON, meant to measure the decoding on an approved account
that stores nothing). It was stored as a pending request instead, `202 {"status":"pending","mailbox":"not_verified"}`
in 2.2 seconds with the upload, and e-mailed to the maintainer (`notified:zz0007`, 14:04:08). So the
deployed Worker read, checked and stored a 5 MB CV without hitting a CPU limit. The e-mails of this
proof (two requests, one second installation) carry live-looking links; all are inert now: the
accounts are gone, so each decision page answers "Nothing changed" and the CV link "No CV on record".

Clean-up, from WSL: `admin.mjs remove zz0007` and `remove zz0008` (both `{"status":"removed",...,"revoked":[]}`);
then `seat zz0007` answered `"seat":null,"conflict":null`, `cv zz0007` answered
`HTTP 404: {"error":"no CV on record for zz0007"}`, `wrangler kv key get seat:zz0007` answered 404, and
`admin.mjs list` counted pending 0, seats 0, conflicts 0, approved 3 (as before the proof).

Last, `admin.mjs seat-rule st1234 any` answered `{"status":"seat-rule","accessId":"st1234","any_installation":true}`:
the store reviewers' mock account works from every reviewer's own installation and binds none. Its record
has no `grants` field, so it counts as both.

## Proof, versions, the Move guard, the localhost exemption, removal and the invitation step, 2026-09-30 afternoon

Both names deployed from WSL with `deploy.sh` (`SKIP_SITE=1`), `wrangler.toml` saying
`REQUIRE_INSTALL_ID = "0"`, `MAIL_STUDENTS = "0"` and `GROUP_MODE = "manual"`. Each deploy reported
`cron schedule: 0 13 * * *`; `wrangler versions view` of beethoven-access's current version (made by
the secret updates after the deploy) lists `SERVICE_NAME ("beethoven-access")`, `REMINDER_FROM`,
`SERVICE_ORIGIN`, `GROUP_MODE ("manual")`, `MAIL_STUDENTS ("0")` and `REQUIRE_INSTALL_ID ("0")`. Both
were deployed once more at 16:05 UTC after two changes to the pages (the copy box's width at phone
size, a missing full stop), and answered `/health` `{"ok":true}` at 16:08.

The calls were made with Git Bash's curl on Windows, 15:52 to 16:08 UTC. The admin token was piped into
curl's header list from the vendor folder. The e-mails of this proof went to the maintainer's inbox,
which is not read from here, so the decision links were signed locally with the vendor folder's
`decide_key` (piped) for exactly the `ref` on record. They were read from `/admin/list` for a request,
and from KV (`wrangler kv key get`, from WSL) for a refusal. `zq0001` to `zq0006` are made-up
AccessIDs, all removed at the end. The installations are `IA`, `IB` and `IC` as in the morning's proof,
plus `11111111222222223333333344444444`.

**F1 b, the exemption on a localhost portal only.** `zq0003` added, then `seat-rule zq0003 any`:

```
portal localhost:8080, IA          -> {"approved":true,...}
portal localhost:8080, IB          -> {"approved":true,...}
portal reviewers.localhost, IC     -> {"approved":true,...}
admin seat zq0003                  -> "seat":null
portal ondemand.grid.wayne.edu, IA -> {"approved":true,...}
admin seat zq0003                  -> "any_installation":true, "seat":{"install_short":"3eb1bd43",...}
portal ondemand.grid.wayne.edu, IB -> {"approved":false,...,"reason":"other_installation",...}
portal localhost.example.com, IC   -> {"approved":false,...,"reason":"other_installation",...}
portal localhost:8080, IC          -> {"approved":true,...}
```

The first `admin seat` after `seat-rule` still showed `"any_installation":false`. That was KV's minute:
the checks already honoured the rule, and the next read showed `true`. At 16:08 the reviewers' own
account, `st1234`, from `localhost:8080`, answered `{"approved":true,...}`.

**F1 a, Move refused while the installation is another account's seat.** `zq0001` bound
`1111...4444` and `zq0002` bound `IC` (fingerprint `8b54c291`), both through the product `bridge`, and
`zq0002` also through `beethoven`. `zq0001` checking from `IC` was refused `other_installation`, and
KV then held `conflict:zq0001` with `"ref":"5wcz0kDsVezBaIPJ3oU83A"` and `conflict_notified:zq0001`
(15:53:48): the e-mail had gone. The Move link for `IC` with that ref:

```
GET  /decide           -> HTTP 409 "This installation is in use by another account"
                          "The installation 8b54c291, which Proof F1a (made-up) (zq0001) asked from, is the one zq0002 uses: ..."
                          "To go on, withdraw the approval of zq0002 first (Remove on the admin page, or
                           node tools/intake/admin.mjs remove zq0002); or, ... reset its seat ...
                           Then open this link again: it was not used up."  "Nothing was changed."
POST /decide confirm=1 -> the same page, HTTP 409; admin seat zq0001 unchanged (install_short bc941d2b)
admin remove zq0002    -> {"status":"removed","accessId":"zq0002","revoked":[]}
POST /decide confirm=1 -> (the same link) HTTP 200 "Moved."; seat zq0001: install_short 8b54c291,
                          moved_at, by "e-mail link"; conflict null
POST again             -> HTTP 410 "This link was already used"
```

**F1 c, links tied to their version.** A Move link with another ref answered HTTP 409 "This e-mail was
replaced"; a Withdraw link with no ref answered HTTP 410 "This link is out of date". For requests, a
v2 request for `zq0004` (Google account `proof.f1c@example.com`) was sent, `202
{"status":"pending","mailbox":"not_verified"}`, with ref `H6iAgP7KDPD-5AtRvWcj1g`. The same form again
kept that ref and `submitted_at`. The Approve link for that ref opened its question (HTTP 200). The form
was then sent with a changed purpose, and the new ref was `IUqds_R24PIogCgqmrh6IQ`. After that, the first
version's links answered:

```
Approve, opened and pressed -> HTTP 409 "This request was replaced" ("... see the newer e-mail ... Nothing was changed.")
CV, pressed                 -> HTTP 409 "This request was replaced" ("... Nothing was sent.")
Approve with no ref         -> HTTP 410 "This link is out of date"   (also at ashley-service, 16:08)
```

**F3, the Approve page.** The second version's Approve link, pressed: HTTP 200 "Approved.", "They are not told
automatically; let them know.", "Next: add proof.f1c@example.com to the Google Group
Beethoven-users.", the address in a read-only box with a Copy button, "Invite them on the group's
members page" (`https://groups.google.com/g/beethoven-users/members`), and a Done, invited button. Its
policy was `default-src 'none'; style-src 'unsafe-inline'; script-src
'sha256-INwhXZoqo4hQAUAlfL90O8Q8ccXrCOPJAg3xWtat2UE='; form-action 'self'; base-uri 'none';
frame-ancestors 'none'`. The page had one script, and its SHA-256 is that value. The Done, invited
token named `zq0004`, `invited`, and the approval's ref. Opened, it asked "Mark Proof F1c (made-up)
(zq0004) as invited to Beethoven-users?". Pressed, it said "Marked invited.". `admin invited zq0004`
then answered `"already":true`; `clear` answered `{"status":"not-invited",...}`; marking again stamped a
new date. `/admin/list` answered the keys `now, group, pending, approved, denied, revoked, checks,
seats, conflicts` and `group` `{"name":"Beethoven-users",...,"mode":"manual"}`. `zq0001` showed `stage
"installed"`, `installed_at` its first binding (15:53:45, kept through the move), and `seat.bound`
true. The page was rendered in Edge at 1440 and inside a 390 px and a 320 px frame. The text wraps, and
since the second deploy the box and its button share one line at both phone widths.

**Once, a second press got through.** Pressing that Done, invited button a second time, 4 seconds after
the first, answered "Marked invited." again instead of "This link was already used", and it stamped a
second date (15:56:36; `admin invited` then reported it). The same sequence repeated on fresh made-up
accounts was refused correctly: press, then press after 2 s, at 16:00; open, press, then press after 2 s,
at 16:03. The cause is not established. The likely one is KV's consistency: the used link is recorded
in KV, which can take up to a minute to reach another Cloudflare location. Consecutive requests from
this one computer do not always reach the same location: of twelve calls to `/health`, eleven were
answered at ATL and one at MEM. For Done, invited the effect was a second date. For two different
links of one request e-mail (Approve, then Deny) pressed within that minute, both could apply. Closing
this needs a strongly consistent store for spending a link (a Durable Object), which is not built.
README.md, "What a link scanner can and cannot do", says so.

**F1 d, removal clears the access-check records.** Before `remove zq0002`, KV held `seen:bridge:zq0002` and
`seen:beethoven:zq0002`. After removing `zq0001` to `zq0006`, a KV listing (`wrangler kv key list`, from
WSL) found no key under any of the made-up ids or installations: no `seen:`, `seat:`, `install:`,
`installed:`, `conflict:`, `approved:`, `pending:`, `denied:` or `cv:` key. What is left expires on its
own: the day's counters (`chk:`, `notify_versions:`), the 24-hour e-mail flags (`notified:zq0004`,
`conflict_notified:zq0001`, `conflict_notified:zq0003`), and the spent links (`decide:<nonce>`, 30
days). `admin.mjs list` afterwards: pending 0, and approved 3 (go2432, a student, st1234), as before the
proof.

**Not proved live, by the tests only:** the daily reminder (`worker.test.mjs`, "the daily reminder lists
approved accounts ..."), the student's e-mail at approval and every other part of `MAIL_STUDENTS` `"1"`
(it stays `"0"`), and the Workspace adapter (against a stub of Google; `GROUP_MODE` stays `"manual"`).
The first reminder runs at 13:00 UTC on 2026-10-01. It will list go2432 and that student (approved for
Beethoven, not marked invited, no installation checked in; st1234 is left out) unless they are marked
invited first: `admin.mjs invited go2432`, or Mark invited on the admin page.

E-mails this proof sent to the maintainer: the refusals of `zq0003` and `zq0001`, and the two versions
of `zq0004`'s request. Only `zq0001`'s e-mail is confirmed from here, by its flag in KV. All their links
are now inert, because the accounts are gone.

## Integration pass, 2026-09-30 16:30 to 16:42 UTC: three edge cases from the review, fixed and redeployed

The review of the afternoon's work found three edge cases and left them unfixed, so that the deployed
code would stay the code under review. They were fixed in the integration pass, each with a test that
fails on the earlier `worker.js` and passes now, and both names were deployed again from WSL
(`deploy.sh`, then `WORKER_NAME=ashley-service deploy.sh`; versions `0c6468d1` at 16:36:53 and
`94cd3269` at 16:38:11; `MAIL_STUDENTS` `"0"`, `REQUIRE_INSTALL_ID` `"0"`, `GROUP_MODE` `"manual"`,
`REMINDER_FROM` `beethoven-access`, each name its own `SERVICE_NAME`, handlers fetch and scheduled).

1. **An old Done, invited link after remove and add.** The check compared refs only when both the link
   and the approval had one, and an approval made by `add` has none; so a Done, invited button from
   before a remove and add still stamped `invited_at`, and the reminder stopped listing someone who may
   never have been invited. Now the link's ref and the approval's must be equal, a missing one counting
   as empty: either way round it answers "This approval was replaced" and changes nothing. A link and an
   approval that both have no ref (the reminder's link for an approval made by `add`, as go2432's and
   that student's were) still work.
2. **A second confirmation link for one version.** The same form sent twice before confirming gives
   two confirmation e-mails for one version; using the second after the first confirmed it again and
   e-mailed the maintainer a second set of decision links. Now it answers "Already confirmed", writes
   nothing and sends nothing. Inactive live while `MAIL_STUDENTS` is `"0"`.
3. **The student's e-mail in workspace mode.** With `GROUP_MODE` `"workspace"` the service adds the
   account itself and Google sends no invitation, but the student's approval e-mail said to watch for
   the invitation, which "has the link". Now, when the service added them, it says they are in the
   group and that the lab lead sends the listing's link; the Approve page and the admin page's
   next-step box say to send it. When Google refuses, the manual step and the old text stay. Never
   called live.

Live, from WSL, `scratchpad/integ/live_check.mjs` (tokens read from the vendor folder, never printed):

```
GET  beethoven-access/health, ashley-service/health  -> 200 {"ok":true} each
POST beethoven-access/request v2 zq0301              -> 202 {"status":"pending","mailbox":"not_verified"}
POST ashley-service/request v2 zq0302                -> 202 {"status":"pending","mailbox":"not_verified"}
admin add zq0303                                     -> 200; the approval has no ref
POST /decide, invited, with a ref zq0303 lacks       -> 409 "This approval was replaced" at both names;
                                                        invited_at unset (the earlier code stamped it)
GET  /decide, invited, no ref                        -> 200, the question (opened, not pressed)
admin remove zq0301, zq0302, zq0303                  -> 200 each
/admin/list 65 s later, both names                   -> pending 0; approved go2432, a student, st1234;
                                                        no made-up id mentioned anywhere
```

The two requests e-mailed the maintainer (marked "Mailbox: not verified"); their links are inert, since
the requests are gone. `node --test` in `tools/intake`: 55 of 55; with `tools/license/vendor.test.mjs`,
57 of 57.
