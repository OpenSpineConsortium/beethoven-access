// The interface standard's rules 1 to 3 for this repository (interface/README.md): nothing here reads,
// runs or copies a file of another Beethoven repository's checkout; what it offers is declared in
// interface/INTERFACE.json and nowhere else; and it takes nothing from another, so there is no pinned copy
// to match an ORIGIN. A line that reaches another checkout fails unless it is on the known list below with
// its reason, and an entry that no longer matches fails too, so the list only shrinks. The patterns are
// those of beethoven-extension's boundary test (hpcworker's framework/tests/test_boundary.py before it),
// with this repository's own old names added. No network and no other checkout: everything read here is
// this tree. Run with the rest: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'beethoven-access';
const STANDARD = 'https://github.com/OpenSpineConsortium/beethoven/blob/main/INTERFACES.md';
const THIS_FILE = 'test/boundary.test.mjs';
// every other repository of the ecosystem and the names their checkouts had (the Desktop folders ashley,
// where this service lived as tools/intake until 2026-10-07, and ashley-bridge), and the website's
const OTHERS = ['beethoven', 'hpcworker', 'beethoven-extension', 'beethoven-desktop', 'beethoven-qa', 'beethoven-agents', 'beethoven-research', 'beethoven-sites', 'beethoven-base', 'beethoven-vscode', 'ashley', 'ashley-bridge', 'openspineconsortium.github.io', 'spinesurg-ct-nnunet', 'u251-xenograft-rat-rnaseq-study'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAMES = [...OTHERS].sort((a, b) => b.length - a.length).map(esc).join('|');
// a path made from this checkout's parent: "../<repo>", or "$(dirname ...)/<repo>", "${parent}/<repo>" and the like
const SIBLING_PATH = new RegExp(`(?:\\.\\./|\\)/|\\}/)(${NAMES})(?![A-Za-z0-9_.-])`, 'g');
// ... except a web address built from an origin, where /beethoven/ is the site's folder, not a checkout
// (`${siteOrigin(env)}/beethoven/request.html`, and the tests' `${SITE}/beethoven/request.html`, SITE being
// the website's origin there)
const WEB_BASE = /origin|\bport\b|url\b|^site$/i;
// the same in Node's spelling: path.join(REPO, '..', '<repo>'), as service.mjs found the website's checkout
const SIBLING_SEGMENTS = new RegExp(`['"]\\.\\.['"]\\s*,\\s*(?:['"][^'"]*['"]\\s*,\\s*)*['"](${NAMES})['"]`, 'g');
// a path from a home folder or a user's folder to another checkout: ~/<repo>, $HOME/x/<repo>, /home/<user>/<repo>,
// C:\Users\<user>\...\<repo> and the Windows folders as Git Bash and WSL see them. A path on the grid, such as
// /rs/rs_grp_oschome/shared/beethoven, starts nowhere of these and is not a checkout
const HOME_PATH = new RegExp(`(?:~|\\$HOME|\\$\\{HOME\\}|%USERPROFILE%|/home/[^/\\s"'\`]+|/root|/Users/[^/\\s"'\`]+|(?:/mnt)?/[a-z]/Users/[^/\\s"'\`]+|[A-Za-z]:[\\\\/]+Users[\\\\/]+[^\\\\/\\s"'\`]+)(?:[\\\\/]+[^\\\\/\\s"'\`]+)*?[\\\\/]+(${NAMES})(?![A-Za-z0-9_.-])`, 'g');
// a variable whose value is another repository's checkout: the names the ecosystem uses, and SITE_REPO and
// REPO_ROOT, with any prefix (BEETHOVEN_SITE_REPO, ASHLEY_SITE_REPO), with which deploy.sh and service.mjs found
// the website's checkout and deploy.sh read the VS Code edition's keys before 2026-10-07. Never
// BEETHOVEN_VENDOR_DIR: the vendor folder is the maintainer's, not a repository.
const CHECKOUT_VAR = /\b((?:[A-Z][A-Z0-9]*_)*(?:SITE_REPO|REPO_ROOT)|(?:HPCWORKER|ASHLEY|SITES|QA|INTAKE|BEETHOVEN_(?:SERVICE|QA|AGENTS|RESEARCH|SITES?|EXTENSION|DESKTOP|VSCODE|BASE|HUB))_DIR)\b/g;
// a clone of another repository of the organisation
const CLONE = new RegExp(`\\b(?:git clone|gh repo clone)\\b[^\\n]*?OpenSpineConsortium/(${NAMES})\\b`, 'gi');
// a climb out of this checkout: '..' segments, one after another in a path ("../..", "$HERE/../..", "cd ..") or
// as arguments ('..', '..'), more of them than the file is deep. A test one folder down climbs one to the root;
// a file at the root, or a workflow (which runs at the root), climbs none. A comment is not a path.
const CLIMB_SLASH = /(?<![A-Za-z0-9_.-])\.\.(?:[\\/]\.\.)*(?![A-Za-z0-9_.-])/g;
const CLIMB_ARGS = /(?:['"]\.\.['"]\s*,\s*)*['"]\.\.['"]/g;
// a workflow that checks out another repository (block or flow style), or runs a workflow or action of one
const CHECKOUT_ACTION_REPO = /\brepository\s*:/;
const OTHER_REPO_USES = /\buses\s*:\s*['"]?OpenSpineConsortium\//;
const KINDS = ['contract', 'schema', 'data', 'python', 'cli', 'files', 'program', 'text'];

/** what still reaches another checkout today: the file, what matched, why it is still here and who removes it */
const KNOWN = [];

/** the repository's files: git's list where git is at hand, else the tree without .git and what tools leave */
function tracked() {
  const r = spawnSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8' });
  const files = r.status === 0 ? r.stdout.split('\0').filter(Boolean) : [];
  if (files.length) return files;
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.wrangler'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) found.push(path.relative(REPO, full).split(path.sep).join('/'));
    }
  };
  walk(REPO);
  return found;
}
const FILES = tracked();

const utf8 = new TextDecoder('utf-8', { fatal: true });
/** a file's text, or '' for one that is not UTF-8 text */
function text(rel) {
  try {
    return utf8.decode(fs.readFileSync(path.join(REPO, rel)));
  } catch {
    return '';
  }
}

/** how many folders a file is below the root its paths are read from: a workflow's are the checkout's root */
const depthOf = (rel) => (rel.startsWith('.github/') ? 0 : rel.split('/').length - 1);

/** every reach of another checkout in one line of a file depth folders down, as the names that matched */
function reaches(line, depth = 0) {
  const out = [];
  for (const m of line.matchAll(SIBLING_PATH)) {
    const at = m.index ?? 0;
    const close = line[at];
    if (close === '}' || close === ')') {
      const open = line.lastIndexOf(close === '}' ? '${' : '$(', at);
      if (open >= 0 && WEB_BASE.test(line.slice(open + 2, at))) continue;
    }
    out.push(m[1]);
  }
  for (const rx of [SIBLING_SEGMENTS, HOME_PATH, CHECKOUT_VAR, CLONE]) for (const m of line.matchAll(rx)) out.push(m[1]);
  if (!/^\s*(?:\/\/|#|\*|\/\*)/.test(line)) {
    const climbs = [...line.matchAll(CLIMB_SLASH), ...line.matchAll(CLIMB_ARGS)].map((m) => m[0].match(/\.\./g).length);
    if (Math.max(0, ...climbs) > depth) out.push('..');
  }
  return out;
}

/** the tracked files an export path names: "dir/" every file under it, "*" within one part of a path */
function covered(p) {
  if (p.endsWith('/')) return FILES.filter((f) => f.startsWith(p));
  const re = new RegExp(`^${p.split('*').map(esc).join('[^/]*')}$`);
  return FILES.filter((f) => re.test(f));
}

const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO, 'interface', 'INTERFACE.json'), 'utf8'));

test('the patterns find what they look for, and leave the website\'s addresses and the vendor folder alone', () => {
  for (const line of [
    'node ../hpcworker/framework/bin/hpcworker', 'cp "$(dirname "$HERE")/beethoven-vscode/grid/license.js" .', 'const k = `${parent}/openspineconsortium.github.io/beethoven/services.json`;', 'SITE_REPO=${SITE_REPO:-../site}', 'export HPCWORKER_DIR=/x', 'git clone https://github.com/OpenSpineConsortium/beethoven-extension', 'const k = `${siteRepo}/beethoven/services.json`;',
    // this repository's own lines at the split (6fefe8d), when it was the VS Code edition's tools/intake
    "const REPO = path.resolve(HERE, '..', '..');",
    "const site = env.BEETHOVEN_SITE_REPO || env.ASHLEY_SITE_REPO || path.join(REPO, '..', 'openspineconsortium.github.io');",
    'HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"',
    'SITE_REPO="${BEETHOVEN_SITE_REPO:-${ASHLEY_SITE_REPO:-$REPO/../openspineconsortium.github.io}}"',
    // and the other spellings of the same
    "const L = require(path.join(HERE, '..', 'beethoven-vscode', 'grid', 'license.js'));",
    'node "$BEETHOVEN_SITE_REPO/tools/build_site.py"',
    'bash /home/claude/hpcworker/tools/grid_access.sh',
    'bash "$HOME/hpcworker/tools/grid_access.sh"',
    'node ~/beethoven-extension/scripts/x.mjs',
    'node C:\\Users\\grego\\OneDrive\\Desktop\\ashley\\tools\\intake\\admin.mjs roster',
    'node /mnt/c/Users/grego/OneDrive/Desktop/ashley/tools/intake/admin.mjs roster',
    'cd "$HERE/.." && bash hpcworker/tools/grid_access.sh',
    'cd .. && ls',
  ]) {
    assert.ok(reaches(line).length > 0, line);
  }
  for (const line of [
    'return `${siteOrigin(env)}/beethoven/request.html`;', 'const PAGE = `${SITE}/beethoven/request.html`;', 'BEETHOVEN_VENDOR_DIR=/mnt/c/vendor node trial-key.mjs', 'BEETHOVEN_SERVICE_URL=https://x', 'GITHUB_REPO: "example/beethoven-vscode"', 'const ROOT = "/rs/rs_grp_oschome/shared/beethoven";',
    'const SHARED = "/rs/rs_grp_oschome/shared/beethoven/hpcworker/current";', 'VENDOR="$HOME/.beethoven-vendor"', 'CLAUDE_CONFIG_DIR="$HOME/.beethoven/claude"', 'BEETHOVEN_VENDOR_DIR=/mnt/c/Users/grego/.beethoven-vendor',
    "standard: 'https://github.com/OpenSpineConsortium/beethoven/blob/main/INTERFACES.md'", 'const f = (...args) => g(...args);', 'const STORAGE_ROOT = env.STORAGE_ROOT || DEFAULT_ROOT;',
    '// never "..", never a hidden folder',
  ]) {
    assert.deepEqual(reaches(line), [], line);
  }
  // one folder down, one climb is this checkout's root, and two leave it
  for (const line of ["const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');", "import worker from '../worker.js';", "for (const f of ['..', 'lab/..', '../etc']) {"]) assert.deepEqual(reaches(line, 1), [], line);
  for (const line of ["const REPO = path.resolve(HERE, '..', '..');", 'node ../../x.mjs']) assert.deepEqual(reaches(line, 1), ['..'], line);
});

test('rule 1: reads, runs and copies no file of another checkout, but what the known list names', () => {
  const found = new Map();
  for (const rel of FILES) {
    // prose may name another repository; this file names them to look for them
    if (rel.endsWith('.md') || rel === THIS_FILE) continue;
    text(rel).split('\n').forEach((line, i) => {
      for (const name of reaches(line, depthOf(rel))) {
        const key = `${rel}\t${name}`;
        if (!found.has(key)) found.set(key, `${rel}:${i + 1}: ${line.trim().slice(0, 160)}`);
      }
    });
  }
  const known = new Set(KNOWN.map((k) => `${k.file}\t${k.match}`));
  const fresh = [...found].filter(([k]) => !known.has(k)).map(([, where]) => where);
  assert.deepEqual(fresh, [], "these lines reach another repository's checkout; take what is needed from that repository's interface instead (interface/README.md)");
  const stale = [...known].filter((k) => !found.has(k)).map((k) => k.replace('\t', ': '));
  assert.deepEqual(stale, [], `fixed: remove these from KNOWN in ${THIS_FILE}`);
  for (const k of KNOWN) assert.ok(k.why.length > 40, `${k.file}: say why it is still here and who removes it`);
});

test('rule 1: no submodule, and no workflow checks out another repository', () => {
  assert.equal(fs.existsSync(path.join(REPO, '.gitmodules')), false);
  const workflows = FILES.filter((f) => f.startsWith('.github/workflows/'));
  assert.ok(workflows.length >= 2);
  for (const rel of workflows) {
    assert.equal(CHECKOUT_ACTION_REPO.test(text(rel)), false, `${rel} checks out another repository`);
    assert.equal(OTHER_REPO_USES.test(text(rel)), false, `${rel} runs a workflow or an action of another repository`);
  }
});

test('the workflow patterns find a checkout of another repository however it is written, and its workflows', () => {
  for (const t of ['      - uses: actions/checkout@v4\n        with:\n          repository: OpenSpineConsortium/hpcworker\n', '        with: { repository: OpenSpineConsortium/beethoven-vscode, path: vs }\n']) {
    assert.ok(CHECKOUT_ACTION_REPO.test(t), t);
  }
  for (const t of ['    uses: OpenSpineConsortium/hpcworker/.github/workflows/ci.yml@main\n', "      - uses: 'OpenSpineConsortium/beethoven-qa/plugin@v2'\n"]) assert.ok(OTHER_REPO_USES.test(t), t);
  for (const t of ['      - uses: actions/checkout@3d3c42e5\n        with:\n          persist-credentials: false\n', '      - uses: ./.github/actions/local\n']) {
    assert.ok(!CHECKOUT_ACTION_REPO.test(t) && !OTHER_REPO_USES.test(t), t);
  }
});

test('rule 1: no dependency by path or git URL', () => {
  // nothing is installed today; should a package.json come, it takes packages from the registry only
  const bad = [];
  const local = /^(?:file:|link:|git\+|git:|github:|gitlab:|bitbucket:|ssh:|\.{0,2}\/|~\/|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#.*)?$)|\.git(?:#.*)?$/;
  for (const rel of FILES.filter((f) => path.posix.basename(f) === 'package.json')) {
    const pkg = JSON.parse(text(rel));
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'overrides']) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) if (typeof spec === 'string' && local.test(spec)) bad.push(`${rel} ${field}.${name}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('rule 2: the manifest of format 1, named for this repository', () => {
  assert.equal(MANIFEST.format, 1);
  assert.equal(MANIFEST.name, SELF);
  assert.equal(MANIFEST.repository, `OpenSpineConsortium/${SELF}`);
  assert.equal(MANIFEST.standard, STANDARD);
  assert.ok(typeof MANIFEST.summary === 'string' && MANIFEST.summary.length > 20);
  assert.ok(Array.isArray(MANIFEST.exports) && Array.isArray(MANIFEST.imports));
});

test('rule 2: every export named by kind and version, and every export path names a tracked file', () => {
  const ids = MANIFEST.exports.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'an export id is used once');
  for (const e of MANIFEST.exports) {
    assert.match(e.id, /^[a-z][a-z0-9-]*$/, 'an id is lower-case words joined by -');
    assert.ok(KINDS.includes(e.kind), `${e.id}: kind ${e.kind}`);
    assert.ok(Number.isInteger(e.version) && e.version >= 1, `${e.id}: version is an integer from 1`);
    assert.ok(typeof e.summary === 'string' && e.summary.length > 10, `${e.id}: summary`);
    assert.ok(Array.isArray(e.paths) && e.paths.length > 0, `${e.id}: paths`);
    for (const c of e.consumers) assert.match(c, /^OpenSpineConsortium\/[A-Za-z0-9._-]+$/, `${e.id}: a consumer is a repository`);
    for (const p of e.paths) {
      assert.ok(!(p.startsWith('/') || p.split('/').includes('..')), `${e.id}: ${p} is relative to the repository's root`);
      assert.ok(covered(p).length > 0, `${e.id}: ${p} names no tracked file`);
    }
  }
});

test('rule 3: nothing is imported, and nothing in the tree looks like a pinned copy', () => {
  // When this repository first takes an export, the import is named in the manifest with its folder and
  // ORIGIN, and the check that the copy equals its ORIGIN comes with it (beethoven-extension's boundary
  // test is the model). Until then a folder with an ORIGIN or a pull.sh would be a copy nobody declared.
  assert.deepEqual(MANIFEST.imports, []);
  assert.deepEqual(FILES.filter((f) => ['ORIGIN', 'pull.sh'].includes(path.posix.basename(f))), []);
});
