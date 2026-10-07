// What this repository publishes (interface/INTERFACE.json) holds: the manifest is whole, names only files
// that exist and leaves nothing under interface/ unlisted; the contract's schemas use only what every
// client's check reads and every reference in them resolves; routes.json names every route the Worker
// answers and nothing else; the vectors are what the real Worker answers now (vectors.mjs makes them all
// again) and each one passes its route: method, status, content type, schemas and line grammar; and the
// keys and lists in them verify with the vectors' public key. Run with the rest: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Checker, unknownKeywords } from './schema.mjs';
import { produce, dump, VECTORS, VECTOR_KEY } from './vectors.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IFACE = path.join(REPO, 'interface');
const CONTRACT = path.join(IFACE, 'contract');
// the standard's eight kinds of export
const KINDS = new Set(['contract', 'schema', 'data', 'python', 'cli', 'files', 'program', 'text']);
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const manifest = () => read(path.join(IFACE, 'INTERFACE.json'));
const routes = read(path.join(CONTRACT, 'routes.json'));
const texts = read(path.join(CONTRACT, 'lines.json')).texts;

// what is not the repository's own: git's folder and what npm and wrangler leave
const SKIP = new Set(['.git', 'node_modules', '.wrangler']);
function filesUnder(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) out.push(...filesUnder(p));
    }
    else out.push(path.relative(REPO, p).split(path.sep).join('/'));
  }
  return out.sort();
}
// the standard's path rule: "dir/" is every file under it; otherwise "*" stands for any text within one part
const covered = (rel, paths) =>
  paths.some((p) => (p.endsWith('/') ? rel.startsWith(p) : new RegExp(`^${p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`).test(rel)));

// a schema reference of routes.json or lines.json, "<file>" or "<file>#/$defs/<name>", as a checker
function checker(ref) {
  const [file, pointer] = ref.split('#');
  const c = new Checker(CONTRACT, file);
  if (pointer) c.root = c.resolve(`#${pointer}`, c.root)[0];
  return { errors: (v) => c.errors(v, c.root, c.file(file)) };
}

test('the manifest: format 1, its name, the eight kinds, and nothing imported', () => {
  const m = manifest();
  assert.deepEqual([m.format, m.name, m.repository], [1, 'beethoven-access', 'OpenSpineConsortium/beethoven-access']);
  assert.equal(m.standard, 'https://github.com/OpenSpineConsortium/beethoven/blob/main/INTERFACES.md');
  assert.equal(typeof m.summary, 'string');
  const ids = m.exports.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'export ids are unique');
  for (const e of m.exports) {
    assert.deepEqual(Object.keys(e).sort(), ['consumers', 'id', 'kind', 'paths', 'summary', 'version'], e.id);
    assert.ok(KINDS.has(e.kind), `${e.id}: ${e.kind} is not one of the eight kinds`);
    assert.ok(Number.isInteger(e.version) && e.version >= 1, e.id);
    assert.ok(e.paths.length > 0, e.id);
    for (const c of e.consumers) assert.match(c, /^OpenSpineConsortium\/[a-z0-9.-]+$/, e.id);
  }
  // this repository takes nothing from another: interface/README.md says so, and boundary.test.mjs holds it
  assert.deepEqual(m.imports, []);
});

test('every export path names a file, and interface/ holds nothing no export lists', () => {
  const m = manifest();
  const everything = filesUnder(REPO);
  for (const e of m.exports) for (const p of e.paths) assert.ok(everything.some((f) => covered(f, [p])), `${e.id}: ${p} names no file`);
  const listed = m.exports.flatMap((e) => e.paths);
  const loose = filesUnder(IFACE).filter((f) => !['interface/INTERFACE.json', 'interface/README.md'].includes(f) && !covered(f, listed));
  assert.deepEqual(loose, [], 'files under interface/ that no export lists');
});

// An export copies files whole into other repositories, and the website's is public: an AccessID in one is
// a person's, told to whoever reads it, when the service answers about one account yes or no and nothing else
// about anyone (ACCESS_CHECK.md, The decision). So an exported file names only the AccessIDs made up for tests
// and proofs (zq and zz, and the few below), the store reviewers' mock account (st1234) and the maintainer's
// own (go2432); and the website takes no text export, since the texts carry dated records of the service.
const NAMED = new Set(['ab1234', 'cd5678', 'rd5678', 'ef0001', 'gh0002', 'st1234', 'go2432']);
const MADE_UP = /^(?:zq|zz)[0-9]{4}$/;
const PUBLIC = new Set(['OpenSpineConsortium/openspineconsortium.github.io']);
const strangers = (body) => [...new Set(body.match(/\b[a-z]{2}[0-9]{4}\b/g) || [])].filter((id) => !NAMED.has(id) && !MADE_UP.test(id));

test('no export names a person\'s AccessID, and the public website takes no text export', () => {
  assert.deepEqual(strangers('approved go2432, ab1234, zq0001, st1234; hy0001 pending'), ['hy0001'], 'the check finds one');
  const everything = filesUnder(REPO);
  for (const e of manifest().exports) {
    for (const f of everything.filter((x) => covered(x, e.paths))) {
      assert.deepEqual(strangers(fs.readFileSync(path.join(REPO, f), 'utf8')), [], `${e.id}: ${f} names an AccessID that is not one made up here`);
    }
    if (e.kind === 'text') assert.deepEqual(e.consumers.filter((c) => PUBLIC.has(c)), [], `${e.id}: a public repository takes it`);
  }
});

test('the schemas use only the keywords every client\'s check reads, and every reference resolves', () => {
  const names = fs.readdirSync(CONTRACT).filter((n) => n.endsWith('.schema.json'));
  assert.ok(names.length >= 10);
  for (const name of names) {
    const schema = read(path.join(CONTRACT, name));
    assert.deepEqual(unknownKeywords(schema), [], name);
    assert.equal(schema.$id, `https://github.com/OpenSpineConsortium/beethoven-access/interface/contract/${name}`);
    const c = new Checker(CONTRACT, name);
    const walk = (x) => {
      if (!x || typeof x !== 'object') return;
      if (typeof x.$ref === 'string') assert.doesNotThrow(() => c.resolve(x.$ref, c.root), `${name}: ${x.$ref}`);
      for (const v of Object.values(x)) walk(v);
    };
    walk(schema);
  }
  // and every schema routes.json and lines.json name
  const refs = [];
  for (const r of routes.routes) {
    for (const m of Object.values(r.methods)) {
      if (m.request && m.request.schema) refs.push(m.request.schema);
      for (const a of Object.values(m.answers)) if (a.schema) refs.push(a.schema);
    }
  }
  for (const a of Object.values(routes.auth)) for (const x of Object.values(a.answers || {})) refs.push(x.schema);
  for (const t of Object.values(texts)) if (t.payload) refs.push(t.payload);
  for (const ref of refs) assert.doesNotThrow(() => checker(ref).errors({}), ref);
});

test('the check refuses what it should: a pass would mean nothing otherwise', () => {
  const request = checker('access-check.request.schema.json');
  assert.deepEqual(request.errors({ v: 1, access_id: 'ab1234', portal: 'ondemand.grid.wayne.edu', product: 'bridge', version: '15.0.0' }), []);
  assert.ok(request.errors({ v: 2, access_id: 'ab1234', portal: 'ondemand.grid.wayne.edu', product: 'bridge', version: '15.0.0' }).some((e) => e.includes('$.v')));
  assert.ok(request.errors({ v: 1, access_id: 'ab1234', portal: 'https://ondemand.grid.wayne.edu/', product: 'bridge', version: '15.0.0' }).some((e) => e.includes('$.portal')));
  assert.ok(request.errors({ v: 1, portal: 'x', product: 'bridge', version: '1' }).some((e) => e.includes('access_id is missing')));
  const answer = checker('access-check.answer.schema.json');
  assert.ok(answer.errors({ approved: 'yes', access_id: 'ab1234' }).length);
  assert.ok(answer.errors({ approved: false, access_id: 'ab1234' }).length, 'a no always carries requestPage');
  assert.ok(answer.errors({ approved: false, access_id: 'ab1234', reason: 'tired', requestPage: 'https://x' }).length);
  assert.ok(checker('allowlist.answer.schema.json').errors({ about: '', accessIds: ['ab1234'] }).length, 'the public list names nobody');
  // a trial key names one person: what names an institution, every VS Code build refuses
  const trialKey = checker('trial-key.payload.schema.json');
  const payload = { v: 1, kid: 'trial', lid: 'L-AAAAAAAAAAAA', product: 'ashley', edition: 'trial', sub: 'ab1234', email: 'ab1234@wayne.edu', iat: 1, nbf: 1, exp: 2, grace_days: 3 };
  assert.deepEqual(trialKey.errors(payload), []);
  assert.ok(trialKey.errors({ ...payload, domain: 'wayne.edu' }).length, 'a key with a domain');
  assert.ok(trialKey.errors({ ...payload, edition: 'site' }).length, 'a site key');
  assert.ok(checker('admin.schema.json#/$defs/seat.answer').errors({ accessId: 'ab1234', any_installation: false, seat: { install_short: '0123456789abcdef0123456789abcdef', first_seen: 'x', last_seen: 'x' }, conflict: null }).length, 'a fingerprint, never the identifier');
  assert.equal(listErrors('roster', 'ab1234\nAB1234\n').length > 0, true);
  assert.equal(listErrors('roster', 'ab1234').length > 0, true, 'every line ends with a newline');
  assert.equal(listErrors('roster', '\n').length > 0, true, 'an empty list is an empty body');
  assert.equal(listErrors('roster', 'zz9999\nab1234\n').length > 0, true, 'sorted');
  assert.equal(listErrors('readers', 'ab1234 ../etc\n').length > 0, true);
  assert.equal(listErrors('readers', 'ab1234 -rf\n').length > 0, true);
  assert.equal(listErrors('readers', 'ab1234 shared/data\r\n').length > 0, true);
  assert.deepEqual(listErrors('readers', 'ab1234 .\ncd5678 shared/data\n'), []);
});

// a list text against lines.json: every line ends with \n, an empty list is an empty body, each line matches,
// none is longer than max_line, and the lines are sorted without repeats
function listErrors(name, body) {
  const t = texts[name];
  if (body === '') return [];
  const out = [];
  if (!body.endsWith('\n')) out.push('the last line has no newline');
  if (body.includes('\r')) out.push('a carriage return');
  const lines = body.replace(/\n$/, '').split('\n');
  for (const l of lines) {
    if (!new RegExp(t.line).test(l)) out.push(`${JSON.stringify(l)} does not match ${t.line}`);
    if (t.max_line && l.length > t.max_line) out.push(`${JSON.stringify(l)} is longer than ${t.max_line}`);
  }
  if (lines.join('\n') !== [...new Set(lines)].sort().join('\n')) out.push('not sorted, or repeated');
  return out;
}

// a signed text: one token whose payload passes its schema and whose signature verifies with the key given
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
function tokenErrors(name, token, key = VECTOR_KEY) {
  const t = texts[name];
  if (!new RegExp(t.token).test(token)) return [`${token.slice(0, 40)} does not match ${t.token}`];
  const [prefix, body, sig] = token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const out = checker(t.payload).errors(payload);
  if (payload.kid !== key.kid) out.push(`kid ${payload.kid}, not ${key.kid}`);
  const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(key.public_key, 'base64')]), format: 'der', type: 'spki' });
  if (!crypto.verify(null, Buffer.from(`${prefix}.${body}`, 'ascii'), pub, Buffer.from(sig, 'base64url'))) out.push('the signature does not verify');
  return out;
}

// The routes the Worker's code answers: every path it compares p with (a prefix it tests with startsWith as
// "<prefix>*"), and every admin route it compares route with or switches on, in worker.js and storage.js.
// Any spelling counts, digits, capitals and dashes too, so a route can never be added unseen.
function routesIn(worker, storage) {
  const paths = [...worker.matchAll(/\bp === '(\/[^']*)'/g)].map((m) => m[1]);
  const prefixes = [...worker.matchAll(/\bp\.startsWith\('(\/[^']*)'\)/g)].map((m) => `${m[1]}*`);
  const admin = [...worker.matchAll(/\broute === '([^']+)'/g), ...worker.matchAll(/^\s+case '([^']+)':/gm), ...storage.matchAll(/\broute === '([^']+)'/g)].map((m) => `/admin/${m[1]}`);
  return { paths, prefixes, admin };
}

test('the route scan sees a route whatever its spelling', () => {
  const all = (w, s) => Object.values(routesIn(w, s)).flat();
  for (const [line, route] of [
    ["    if (p === '/access_check2') return accessCheck(request, env, ctx);", '/access_check2'],
    ["    if (p === '/status-v2') return json(200, { ok: true });", '/status-v2'],
    ["    if (p === '/Trial') return trial(request, env);", '/Trial'],
    ["    if (p.startsWith('/files/')) return files(request, env);", '/files/*'],
    ["  if (route === 'grant2') return reply(200, {});", '/admin/grant2'],
    ["    case 'seat-v2':", '/admin/seat-v2'],
  ]) {
    assert.deepEqual(all(`${line}\n`, ''), [route], line);
  }
  assert.deepEqual(all('', "    if (route === 'storage-x2') {\n"), ['/admin/storage-x2']);
  // a comparison that is not a route is not one
  assert.deepEqual(all("    if (typeof p === 'string') return p;\n", ''), []);
});

test('routes.json names every route the Worker answers, and nothing else', () => {
  const { paths, prefixes, admin } = routesIn(fs.readFileSync(path.join(REPO, 'worker.js'), 'utf8'), fs.readFileSync(path.join(REPO, 'storage.js'), 'utf8'));
  assert.ok(paths.length >= 10 && admin.length >= 20 && prefixes.includes('/admin/*'), 'the scan found the routes');
  const answered = [...new Set([...paths, ...prefixes, ...admin])].sort();
  assert.deepEqual(routes.routes.map((r) => r.path).sort(), answered);
  for (const r of routes.routes) {
    assert.ok(Object.hasOwn(routes.auth, r.auth), `${r.path}: auth ${r.auth}`);
    assert.ok(['programs', 'people'].includes(r.for), r.path);
    assert.ok(r.callers.length > 0, r.path);
  }
});

test('the vectors are what the Worker answers now', async () => {
  const made = await produce();
  const kept = fs.readdirSync(VECTORS).filter((n) => n.endsWith('.json')).sort();
  assert.deepEqual(kept, [...made.keys()].sort(), 'a vector no scenario makes, or a scenario with no vector: node test/vectors.mjs --write');
  for (const [name, v] of made) {
    assert.equal(fs.readFileSync(path.join(VECTORS, name), 'utf8'), dump(v), `${name}: the Worker's answer moved; if on purpose, node test/vectors.mjs --write, and raise the export's version when a client must change (interface/README.md)`);
  }
});

const kept = () => fs.readdirSync(VECTORS).filter((n) => n.endsWith('.json') && n !== 'key.json').map((n) => read(path.join(VECTORS, n)));

test('each vector passes its route: method, status, content type, schemas and line grammar', () => {
  const byPath = new Map(routes.routes.map((r) => [r.path, r]));
  const vectors = kept();
  assert.ok(vectors.length >= 50);
  for (const v of vectors) {
    const where = v.vector;
    const route = byPath.get(v.route);
    assert.ok(route, `${where}: no route ${v.route}`);
    const p = v.request.path.split('?')[0];
    assert.ok(v.route === p || (v.route === '/admin/*' && p.startsWith('/admin/') && !byPath.has(p)) || (v.route === '/admin/*' && v.request.method === 'OPTIONS'), `${where}: ${p} is not ${v.route}`);
    const method = route.methods[v.request.method] || route.methods['*'];
    assert.ok(method, `${where}: ${v.request.method} on ${v.route}`);
    const answers = { ...(routes.auth[route.auth].answers || {}), ...((route.methods['*'] || {}).answers || {}), ...method.answers };
    const spec = answers[String(v.answer.status)];
    assert.ok(spec, `${where}: status ${v.answer.status} is not listed for ${v.request.method} ${v.route}`);
    const type = v.answer.headers['content-type'];
    if (spec.type) assert.equal(spec.type.includes(';') ? type : (type || '').split(';')[0], spec.type, where);
    if (v.answer.status === 204) assert.equal(v.answer.body, null, where);
    if (spec.schema) assert.deepEqual(checker(spec.schema).errors(v.answer.body), [], `${where}: the answer and ${spec.schema}`);
    if (spec.text && texts[spec.text].line) assert.deepEqual(listErrors(spec.text, v.answer.body), [], where);
    if (spec.text && texts[spec.text].token && v.answer.body !== '') assert.deepEqual(tokenErrors(spec.text, v.answer.body), [], where);
    // what a client sent and the service took passes the request's schema
    if (v.answer.status < 300 && method.request && method.request.schema && 'body' in v.request) assert.deepEqual(checker(method.request.schema).errors(v.request.body), [], `${where}: the request and ${method.request.schema}`);
  }
});

test('every method of a route for programs has a vector, and no vector shows a secret', () => {
  const vectors = kept();
  for (const r of routes.routes.filter((x) => x.for === 'programs')) {
    for (const m of Object.keys(r.methods).filter((x) => x !== '*')) {
      assert.ok(vectors.some((v) => v.route === r.path && v.request.method === m), `no vector for ${m} ${r.path}`);
    }
  }
  const all = fs.readdirSync(VECTORS).map((n) => fs.readFileSync(path.join(VECTORS, n), 'utf8')).join('\n');
  for (const secret of ['vectors-admin-token', 'vectors-ip-salt', 'vectors-decide-key', 'vectors-mail-key', 'vectors-github-token', 'graph-ab1234', 'graph-cd5678']) assert.ok(!all.includes(secret), secret);
  assert.ok(!all.includes('302e020100300506032b657004220420'), 'the private key is never in a vector');
});

test('the key and the list in the vectors verify with the vectors\' public key, and with no other', () => {
  const issued = read(path.join(VECTORS, 'trial-issued.json')).answer.body.key;
  const list = read(path.join(VECTORS, 'revoked-list.json')).answer.body;
  assert.deepEqual(tokenErrors('trial-key', issued), []);
  assert.deepEqual(tokenErrors('signed', list), []);
  assert.deepEqual(read(path.join(VECTORS, 'key.json')).public_key, VECTOR_KEY.public_key);
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' });
  const stranger = { kid: VECTOR_KEY.kid, public_key: other.subarray(other.length - 32).toString('base64') };
  assert.ok(tokenErrors('trial-key', issued, stranger).includes('the signature does not verify'));
  // a changed payload fails too: the signature covers it
  const [pre, body, sig] = issued.split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const changed = `${pre}.${Buffer.from(JSON.stringify({ ...p, sub: 'zz9999' })).toString('base64url')}.${sig}`;
  assert.ok(tokenErrors('trial-key', changed).includes('the signature does not verify'));
  // the list names what the revoke-lid vector withdrew
  const lp = JSON.parse(Buffer.from(list.split('.')[1], 'base64url').toString('utf8'));
  assert.deepEqual(lp.revoked, ['L-AAAAAAAAAAAA', 'L-BBBBBBBBBBBB']);
});
