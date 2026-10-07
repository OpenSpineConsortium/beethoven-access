// The vectors of the http-api export (interface/contract/vectors/): what the real Worker answers to the
// requests its clients send, one exchange a file, so a client's own tests can hold its reading of the
// answers to the service's actual bytes without any of this repository's code. Every vector comes from
// worker.js itself, run in Node with an in-memory KV, stubs for what it calls (Microsoft Graph, Resend,
// GitHub), the [vars] of wrangler.toml as deployed, the deploy's SERVICE_NAME, a clock fixed at
// 2026-10-07T12:00:00Z, random bytes from a fixed seed and a signing key made from a fixed seed (key id
// "vectors"), so the same code gives the same bytes every time. That key is public by construction: it
// signs vectors and nothing else, and no verifier may trust it outside its tests.
//   node test/vectors.mjs           names each vector that differs from what the Worker answers now (exit 1)
//   node test/vectors.mjs --write   rewrites interface/contract/vectors/ from the Worker (and names, never
//                                   deletes, a file no scenario makes any more)
// test/interface.test.mjs fails until the vectors are rewritten after a change of what the Worker answers;
// interface/README.md says when the export's version goes up as well.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker.js';
import { FakeKV } from './fake-kv.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VECTORS = path.join(REPO, 'interface', 'contract', 'vectors');
const ORIGIN = 'https://beethoven-access.openspineconsortium.workers.dev';
const SITE = 'https://openspineconsortium.com';
// a browser extension's origin, as a check from Beethoven carries one
const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const T0 = Date.parse('2026-10-07T12:00:00Z');

// The signing key: an Ed25519 private key is its 32-byte seed behind a fixed PKCS8 head
const SEED = crypto.createHash('sha256').update('beethoven-access interface vectors: a key that signs nothing else').digest();
const PKCS8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]);
const PUBLIC_RAW = (() => {
  const der = crypto.createPublicKey(crypto.createPrivateKey({ key: PKCS8, format: 'der', type: 'pkcs8' })).export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('base64');
})();
export const VECTOR_KEY = { kid: 'vectors', public_key: PUBLIC_RAW };

// The made-up secrets the Worker is given. None is shown in a vector: the admin token and a sign-in token
// are written as placeholders in the recorded request, and no answer carries one.
const ADMIN_TOKEN = 'vectors-admin-token';
const SECRETS = {
  TRIAL_KEY_PKCS8_B64: PKCS8.toString('base64'),
  TRIAL_KID: VECTOR_KEY.kid,
  ADMIN_TOKEN,
  IP_SALT: 'vectors-ip-salt',
  DECIDE_KEY: 'vectors-decide-key',
  RESEND_API_KEY: 'vectors-mail-key',
  NOTIFY_TO: 'maintainer@example.edu',
  GITHUB_TOKEN: 'vectors-github-token',
  GITHUB_REPO: 'example/access-reports',
};
const PLACEHOLDERS = new Map([
  [`Bearer ${ADMIN_TOKEN}`, 'Bearer <ADMIN_TOKEN>'],
  ['Bearer graph-ab1234', "Bearer <a Microsoft sign-in token of ab1234@wayne.edu>"],
  ['Bearer graph-cd5678', "Bearer <a Microsoft sign-in token of cd5678@wayne.edu>"],
]);

// wrangler.toml's [vars], the Worker's configuration as deployed: one KEY = "value" a line
function deployedVars() {
  const out = {};
  let inVars = false;
  for (const line of fs.readFileSync(path.join(REPO, 'wrangler.toml'), 'utf8').split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) inVars = /^\s*\[vars\]\s*$/.test(line);
    const m = inVars && line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const newEnv = (over = {}) => ({ ...deployedVars(), SERVICE_NAME: 'beethoven-access', ACCESS: new FakeKV(), TRIALS: new FakeKV(), REPORTS: new FakeKV(), ...SECRETS, ...over });

// Microsoft Graph, Resend and GitHub: what the Worker calls, answered here
const people = {
  'graph-ab1234': { id: '1', userPrincipalName: 'ab1234@wayne.edu', mail: 'ab1234@wayne.edu', displayName: 'A. Student' },
  'graph-cd5678': { id: '2', userPrincipalName: 'cd5678@wayne.edu', mail: 'cd5678@wayne.edu', displayName: 'C. D.' },
};
function stubs() {
  let mails = 0;
  let issues = 0;
  return async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') return Response.json({ id: `email-${++mails}` });
    if (u.startsWith('https://graph.microsoft.com/')) {
      const me = people[String((init.headers || {}).authorization || '').replace(/^Bearer /, '')];
      return me ? Response.json(me) : new Response('', { status: 401 });
    }
    if (u.startsWith('https://api.github.com/')) return Response.json({ number: ++issues }, { status: 201 });
    throw new Error(`the vectors call nothing else: ${u}`);
  };
}

// The fixed clock and the seeded random bytes, put in place only while the vectors are made
function fixedWorld() {
  const clock = { now: T0 };
  const RealDate = globalThis.Date;
  class FixedDate extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(clock.now);
    }
    static now() {
      return clock.now;
    }
  }
  let counter = 0;
  const seeded = (arr) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let off = 0; off < bytes.length; off += 32) bytes.set(crypto.createHash('sha256').update(`vectors-random-${counter++}`).digest().subarray(0, bytes.length - off), off);
    return arr;
  };
  const saved = { Date: globalThis.Date, random: globalThis.crypto.getRandomValues, fetch: globalThis.fetch, log: console.log, error: console.error };
  globalThis.Date = FixedDate;
  globalThis.crypto.getRandomValues = seeded;
  globalThis.fetch = stubs();
  // the Worker's "mail: ..." lines say what it sent; nothing to show while making vectors
  const quiet = (real) => (...a) => (String(a[0]).startsWith('mail:') ? undefined : real(...a));
  console.log = quiet(saved.log);
  console.error = quiet(saved.error);
  return () => {
    globalThis.Date = saved.Date;
    globalThis.crypto.getRandomValues = saved.random;
    globalThis.fetch = saved.fetch;
    console.log = saved.log;
    console.error = saved.error;
  };
}

// One exchange with the Worker. origin: the Origin header a browser would send (null: none, as curl or a
// program sends); admin: the admin token in the authorization header.
async function exchange(env, { method, path: p, origin = SITE, admin = false, auth, type, body }) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (admin) headers.authorization = `Bearer ${ADMIN_TOKEN}`;
  if (auth) headers.authorization = auth;
  let text;
  if (body !== undefined) {
    text = typeof body === 'string' ? body : JSON.stringify(body);
    headers['content-type'] = type || 'application/json';
  }
  const res = await worker.fetch(new Request(`${ORIGIN}${p}`, { method, headers: { ...headers, 'cf-connecting-ip': '203.0.113.7' }, body: text }), env, { waitUntil: () => {} });
  const answerType = res.headers.get('content-type') || '';
  const raw = await res.text();
  const shown = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, PLACEHOLDERS.get(v) || v]));
  for (const v of Object.values(shown)) if (v.includes(ADMIN_TOKEN)) throw new Error('a vector would show the admin token');
  return {
    request: { method, path: p, headers: shown, ...(body === undefined ? {} : { body }) },
    answer: {
      status: res.status,
      headers: Object.fromEntries([...res.headers].sort(([a], [b]) => a.localeCompare(b))),
      body: answerType.startsWith('application/json') ? JSON.parse(raw) : raw === '' && res.status === 204 ? null : raw,
    },
  };
}

// Steps a scenario takes before the exchange it records; their answers are not kept
const admin = (env, route, body) => exchange(env, { method: 'POST', path: `/admin/${route}`, admin: true, body });
const check = (env, accessId, installId, over = {}) =>
  exchange(env, { method: 'POST', path: '/access_check', origin: EXTENSION, type: 'text/plain;charset=UTF-8', body: { v: 1, access_id: accessId, portal: 'ondemand.grid.wayne.edu', product: 'bridge', version: '15.0.0', ...(installId ? { install_id: installId } : {}), ...over } });
const INSTALL_A = '0123456789abcdef0123456789abcdef';
const INSTALL_B = 'fedcba9876543210fedcba9876543210';
const requestBody = (over = {}) => ({ v: 2, access_id: 'cd5678', name: 'C. D.', email: 'cd5678@wayne.edu', google_account: 'c.d.student@gmail.com', purpose: 'spine segmentation for my thesis', product: 'bridge', ...over });
const storageBody = (over = {}) => ({ v: 1, access_id: 'rd5678', name: 'R. D.', email: 'rd5678@wayne.edu', folders: ['shared/data', 'lab/scans'], purpose: 'the scans for my project', ...over });
const reportBody = { v: 1, install_id: '01234567-89ab-cdef-0123-456789abcdef', version: '5.0.0', grid_scripts_version: '9', vscode: '1.104.0', os: 'win32 10.0.26100', arch: 'x64', when: '2026-10-07T11:59:00Z', root_causes: ['ssh-key'], nodes: [{ id: 'ssh-key', status: 'fail', ms: 12, detail: 'no key', root_cause: 'ssh-key', repair: 'make a key' }], errors: [], signature: '0123456789abcdef' };

// Each vector: [name, its route (a path of routes.json), what it shows, the scenario, which returns the
// exchange to keep, and settings that differ from wrangler.toml's]
const SCENARIOS = [
  ['health', '/health', 'The health check deploy.yml reads after each deploy', (env) => exchange(env, { method: 'GET', path: '/health', origin: null })],
  ['allowlist', '/allowlist', 'The old public list names nobody, with one person approved', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    return exchange(env, { method: 'GET', path: '/allowlist', origin: null });
  }],
  ['access-check-preflight', '/access_check', 'A preflight, should a browser send one', (env) => exchange(env, { method: 'OPTIONS', path: '/access_check', origin: EXTENSION })],
  ['access-check-approved', '/access_check', 'An approved account, from its first installation: yes, and the installation is bound', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    return check(env, 'ab1234', INSTALL_A);
  }],
  ['access-check-not-approved', '/access_check', 'An account not on the list: a plain no with the request page', (env) => check(env, 'zz9999', INSTALL_A)],
  ['access-check-other-installation', '/access_check', 'An approved account from a second installation: no, reason other_installation', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    await check(env, 'ab1234', INSTALL_A);
    return check(env, 'ab1234', INSTALL_B);
  }],
  ['access-check-other-account', '/access_check', 'An installation bound to one approved account, asking for another: no, reason other_account', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    await admin(env, 'add', { accessId: 'cd5678', name: 'C. D.' });
    await check(env, 'ab1234', INSTALL_A);
    return check(env, 'cd5678', INSTALL_A);
  }],
  ['access-check-update-required', '/access_check', 'With REQUIRE_INSTALL_ID "1" (wrangler.toml has "0" today), a check without install_id: no, reason update_required', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    return check(env, 'ab1234', null);
  }, { REQUIRE_INSTALL_ID: '1' }],
  ['access-check-malformed', '/access_check', 'A body the service does not take: 400 with a sentence', (env) => check(env, 'ab1234', INSTALL_A, { v: 2 })],
  ['access-check-wrong-method', '/access_check', 'Any method but POST and OPTIONS: 405', (env) => exchange(env, { method: 'GET', path: '/access_check', origin: EXTENSION })],
  ['trial-issued', '/trial', 'An approved person signed in with Microsoft: a signed trial key', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    return exchange(env, { method: 'POST', path: '/trial', origin: null, auth: 'Bearer graph-ab1234', body: { product: 'ashley' } });
  }],
  ['trial-no-sign-in', '/trial', 'No Microsoft sign-in token: 401', (env) => exchange(env, { method: 'POST', path: '/trial', origin: null, body: { product: 'ashley' } })],
  ['trial-not-approved', '/trial', 'A person not approved: 403 with the request page', (env) => exchange(env, { method: 'POST', path: '/trial', origin: null, auth: 'Bearer graph-cd5678', body: { product: 'ashley' } })],
  ['revoked-empty', '/revoked', 'Nothing withdrawn yet: an empty body', (env) => exchange(env, { method: 'GET', path: '/revoked', origin: null })],
  ['revoked-list', '/revoked', 'Two key ids withdrawn: the signed list', async (env) => {
    await admin(env, 'revoke-lid', { lids: ['L-AAAAAAAAAAAA', 'L-BBBBBBBBBBBB'] });
    return exchange(env, { method: 'GET', path: '/revoked', origin: null });
  }],
  ['report-filed', '/report', 'An error report from an installation that allows them: filed as an issue', (env) => exchange(env, { method: 'POST', path: '/report', origin: null, body: reportBody })],
  ['report-malformed', '/report', 'Not a report: 400', (env) => exchange(env, { method: 'POST', path: '/report', origin: null, body: { v: 1 } })],
  ['request-pending', '/request', 'The request page, with MAIL_STUDENTS "1": stored, and the confirmation e-mail sent', (env) => exchange(env, { method: 'POST', path: '/request', body: requestBody() })],
  ['request-malformed', '/request', 'An e-mail that is not <AccessID>@wayne.edu: 400 with a sentence the page shows', (env) => exchange(env, { method: 'POST', path: '/request', body: requestBody({ email: 'cd5678@gmail.com' }) })],
  ['request-other-origin', '/request', 'A page of another site: 403', (env) => exchange(env, { method: 'POST', path: '/request', origin: 'https://example.com', body: requestBody() })],
  ['request-preflight', '/request', 'The request page\'s preflight', (env) => exchange(env, { method: 'OPTIONS', path: '/request' })],
  ['storage-request-preflight', '/storage_request', 'The lab storage page\'s preflight', (env) => exchange(env, { method: 'OPTIONS', path: '/storage_request' })],
  ['storage-request-pending', '/storage_request', 'The lab storage page: stored, and the maintainer e-mailed', (env) => exchange(env, { method: 'POST', path: '/storage_request', body: storageBody() })],
  ['storage-request-malformed', '/storage_request', 'A folder outside the lab storage: 400 with a sentence the page shows', (env) => exchange(env, { method: 'POST', path: '/storage_request', body: storageBody({ folders: ['/home/rd5678'] }) })],
  ['admin-preflight', '/admin/*', 'The admin page\'s preflight', (env) => exchange(env, { method: 'OPTIONS', path: '/admin/approve' })],
  ['admin-no-token', '/admin/roster.txt', 'An admin route without the token: 401', (env) => exchange(env, { method: 'GET', path: '/admin/roster.txt', origin: null })],
  ['admin-other-origin', '/admin/list', 'An admin route from a page of another site: 403, whatever the token', (env) => exchange(env, { method: 'GET', path: '/admin/list', origin: 'https://example.com', admin: true })],
  ['admin-list', '/admin/list', 'The admin page\'s list: one request waiting for its mailbox, one approval bound to an installation, one denial', async (env) => {
    await exchange(env, { method: 'POST', path: '/request', body: requestBody() });
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    await check(env, 'ab1234', INSTALL_A);
    await exchange(env, { method: 'POST', path: '/request', body: requestBody({ access_id: 'ef0001', name: 'E. F.', email: 'ef0001@wayne.edu', google_account: 'e.f.student@gmail.com' }) });
    await admin(env, 'deny', { accessId: 'ef0001', reason: 'not in the lab' });
    return exchange(env, { method: 'GET', path: '/admin/list', admin: true });
  }],
  ['admin-allowlist', '/admin/allowlist', 'The approved list as JSON, for the maintainer', async (env) => {
    for (const id of ['zz9999', 'ab1234']) await admin(env, 'add', { accessId: id, name: 'Someone' });
    return exchange(env, { method: 'GET', path: '/admin/allowlist', admin: true });
  }],
  ['admin-roster-txt', '/admin/roster.txt', 'The approved list as the grid reads it; a lab-only approval and the store reviewers\' mock account are not on it', async (env) => {
    for (const id of ['zz9999', 'ab1234', 'st1234']) await admin(env, 'add', { accessId: id, name: 'Someone' });
    await admin(env, 'add', { accessId: 'ef9012', name: 'E. F.', grants: ['lab'] });
    await admin(env, 'seat-rule', { accessId: 'st1234', any: true });
    return exchange(env, { method: 'GET', path: '/admin/roster.txt', origin: null, admin: true });
  }],
  ['admin-roster-txt-empty', '/admin/roster.txt', 'Nobody approved: an empty body, never a blank line', (env) => exchange(env, { method: 'GET', path: '/admin/roster.txt', origin: null, admin: true })],
  ['admin-readers-txt', '/admin/readers.txt', 'The readers as the grid reads them, the whole volume as "."', async (env) => {
    await admin(env, 'storage-add', { accessId: 'rd5678', folders: ['shared/access', 'lab'] });
    await admin(env, 'storage-add', { accessId: 'cd5678', folders: ['/rs/rs_grp_oschome/shared/data'] });
    await admin(env, 'storage-add', { accessId: 'zq0006', folders: ['.'] });
    return exchange(env, { method: 'GET', path: '/admin/readers.txt', origin: null, admin: true });
  }],
  ['admin-storage-list', '/admin/storage-list', 'The admin page\'s lab storage section: one request, one reader, one denial', async (env) => {
    await exchange(env, { method: 'POST', path: '/storage_request', body: storageBody() });
    await admin(env, 'storage-add', { accessId: 'zq0006', folders: ['.'] });
    await exchange(env, { method: 'POST', path: '/storage_request', body: storageBody({ access_id: 'gh0002', name: 'G. H.', email: 'gh0002@wayne.edu' }) });
    await admin(env, 'storage-deny', { accessId: 'gh0002', reason: 'not this folder' });
    return exchange(env, { method: 'GET', path: '/admin/storage-list', admin: true });
  }],
  ['admin-add', '/admin/add', 'An approval without a request', (env) => admin(env, 'add', { accessId: 'ab1234', name: 'A. Student', note: 'added by hand' })],
  ['admin-approve', '/admin/approve', 'Approve for Beethoven and the lab: the record and the next step, the invitation', async (env) => {
    await exchange(env, { method: 'POST', path: '/request', body: requestBody() });
    return admin(env, 'approve', { accessId: 'cd5678' });
  }],
  ['admin-approve-none', '/admin/approve', 'No request to approve: 404', (env) => admin(env, 'approve', { accessId: 'cd5678' })],
  ['admin-deny', '/admin/deny', 'Deny a request, with a reason', async (env) => {
    await exchange(env, { method: 'POST', path: '/request', body: requestBody() });
    return admin(env, 'deny', { accessId: 'cd5678', reason: 'not in the lab' });
  }],
  ['admin-invited', '/admin/invited', 'Mark invited to the Google Group', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    return admin(env, 'invited', { accessId: 'ab1234' });
  }],
  ['admin-grant', '/admin/grant', 'Lab membership only', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    return admin(env, 'grant', { accessId: 'ab1234', grants: ['lab'] });
  }],
  ['admin-seat-rule', '/admin/seat-rule', 'The store reviewers\' mock account', async (env) => {
    await admin(env, 'add', { accessId: 'st1234', name: 'Store reviewers' });
    return admin(env, 'seat-rule', { accessId: 'st1234', any: true });
  }],
  ['admin-seat', '/admin/seat', 'The installation an account is bound to, by fingerprint, and its refusals', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    await check(env, 'ab1234', INSTALL_A);
    await check(env, 'ab1234', INSTALL_B);
    return admin(env, 'seat', { accessId: 'ab1234' });
  }],
  ['admin-reset-seat', '/admin/reset-seat', 'Clear the binding', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    await check(env, 'ab1234', INSTALL_A);
    return admin(env, 'reset-seat', { accessId: 'ab1234' });
  }],
  ['admin-remove', '/admin/remove', 'Remove a person: their keys go on the revocation list', async (env) => {
    await admin(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    await exchange(env, { method: 'POST', path: '/trial', origin: null, auth: 'Bearer graph-ab1234', body: { product: 'ashley' } });
    return admin(env, 'remove', { accessId: 'ab1234' });
  }],
  ['admin-revoke-lid', '/admin/revoke-lid', 'Withdraw key ids, several in one call (the VS Code edition\'s publish.sh)', (env) => admin(env, 'revoke-lid', { lids: ['L-AAAAAAAAAAAA', 'L-BBBBBBBBBBBB'] })],
  ['admin-cv-none', '/admin/cv', 'No CV on record: 404 (with one, the answer is the file)', (env) => admin(env, 'cv', { accessId: 'ab1234' })],
  ['admin-notify-test', '/admin/notify-test', 'A test e-mail to the maintainer', (env) => admin(env, 'notify-test', {})],
  ['admin-unknown', '/admin/*', 'A write the service does not know: 404', (env) => admin(env, 'nothing', { accessId: 'ab1234' })],
  ['admin-storage-add', '/admin/storage-add', 'A reader without a request', (env) => admin(env, 'storage-add', { accessId: 'zq0006', folders: ['/rs/rs_grp_oschome/'] })],
  ['admin-storage-approve', '/admin/storage-approve', 'Approve fewer folders than asked for', async (env) => {
    await exchange(env, { method: 'POST', path: '/storage_request', body: storageBody() });
    return admin(env, 'storage-approve', { accessId: 'rd5678', folders: ['shared/data'] });
  }],
  ['admin-storage-deny', '/admin/storage-deny', 'Deny a storage request, with a reason', async (env) => {
    await exchange(env, { method: 'POST', path: '/storage_request', body: storageBody() });
    return admin(env, 'storage-deny', { accessId: 'rd5678', reason: 'not these folders' });
  }],
  ['admin-storage-remove', '/admin/storage-remove', 'Take a reader off', async (env) => {
    await admin(env, 'storage-add', { accessId: 'rd5678', folders: ['shared/data'] });
    return admin(env, 'storage-remove', { accessId: 'rd5678' });
  }],
];

/** Every vector, made now from the Worker: a Map of file name to its object. */
export async function produce() {
  const out = new Map();
  const restore = fixedWorld();
  try {
    for (const [name, route, summary, scenario, over] of SCENARIOS) {
      const { request, answer } = await scenario(newEnv(over));
      out.set(`${name}.json`, { vector: name, route, summary, ...(over ? { settings: over } : {}), request, answer });
    }
    out.set('key.json', { vector: 'key', summary: 'The public key of the key id "vectors", which signed the keys and lists in these vectors and nothing else: the raw 32 bytes of the Ed25519 key, base64, as a verifier lists its keys. It is public by construction; a verifier never trusts it outside its tests.', ...VECTOR_KEY });
  } finally {
    restore();
  }
  return out;
}

export const dump = (v) => `${JSON.stringify(v, null, 1)}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const write = process.argv.includes('--write');
  const made = await produce();
  const kept = fs.existsSync(VECTORS) ? fs.readdirSync(VECTORS).filter((n) => n.endsWith('.json')) : [];
  const differ = [...made].filter(([n, v]) => !kept.includes(n) || fs.readFileSync(path.join(VECTORS, n), 'utf8') !== dump(v)).map(([n]) => n);
  const stale = kept.filter((n) => !made.has(n));
  if (write) {
    fs.mkdirSync(VECTORS, { recursive: true });
    for (const [n, v] of made) fs.writeFileSync(path.join(VECTORS, n), dump(v));
    console.log(`vectors: ${made.size} written to ${path.relative(REPO, VECTORS)} (${differ.length} changed)`);
    // nothing is deleted here: a vector no scenario makes any more is the person's to remove, in the same commit
    for (const n of stale) console.log(`no scenario makes ${n} any more: git rm ${path.relative(REPO, path.join(VECTORS, n))}`);
  } else {
    for (const n of differ) console.log(`differs: ${n}`);
    for (const n of stale) console.log(`no scenario makes: ${n}`);
    if (differ.length || stale.length) {
      console.log('the Worker\'s answers moved; if on purpose: node test/vectors.mjs --write (interface/README.md)');
      process.exit(1);
    }
    console.log(`vectors: all ${made.size} are what the Worker answers now`);
  }
}
