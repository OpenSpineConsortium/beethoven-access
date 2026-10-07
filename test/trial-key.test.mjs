// Tests for trial-key.mjs, which deploy.sh pipes into the Worker's secret TRIAL_KEY_PKCS8_B64. Each case runs
// the script as deploy.sh does, with a vendor folder of its own and stdout a pipe; what it prints is imported
// the way worker.js imports the secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../trial-key.mjs', import.meta.url));

function vendorWith(pem, kid = 'trial') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trial-key-vendor-'));
  if (pem !== null) {
    fs.mkdirSync(path.join(dir, 'keys'), { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'keys', `${kid}.pem`), pem, { mode: 0o600 });
  }
  return dir;
}
const run = (vendor, args = [], extra = {}) =>
  new Promise((ok) => execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, BEETHOVEN_VENDOR_DIR: vendor, ...extra } }, (err, stdout, stderr) => ok({ code: err ? err.code : 0, stdout, stderr })));
const rawPublic = (publicKey) => {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('base64');
};

// what worker.js does with the secret: atob, importKey pkcs8 Ed25519, sign
async function signsLikeTheWorker(b64, publicKey) {
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = await crypto.webcrypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  const msg = new TextEncoder().encode('ASHLEY1.payload');
  const sig = Buffer.from(await crypto.webcrypto.subtle.sign('Ed25519', key, msg));
  return crypto.verify(null, msg, publicKey, sig);
}

test('trial-key.mjs prints the key the Worker imports, one line on stdout, and its public key on stderr', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const vendor = vendorWith(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  try {
    const r = await run(vendor);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^[A-Za-z0-9+/]+={0,2}\n$/);
    const b64 = r.stdout.trim();
    assert.equal(b64, privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
    assert.ok(await signsLikeTheWorker(b64, publicKey));
    assert.ok(r.stderr.includes(`trial: public key ${rawPublic(publicKey)}`), r.stderr);
    assert.ok(!r.stderr.includes(b64), 'the private key is never on stderr');
    // --kid names another file of the same folder
    fs.renameSync(path.join(vendor, 'keys', 'trial.pem'), path.join(vendor, 'keys', 'trial-2.pem'));
    assert.equal((await run(vendor, ['--kid', 'trial-2'])).stdout, r.stdout);
  } finally {
    fs.rmSync(vendor, { recursive: true, force: true });
  }
});

test('trial-key.mjs opens an encrypted key with the passphrase variable, and prints nothing without the right one', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const vendor = vendorWith(privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'a passphrase' }));
  try {
    let r = await run(vendor, [], { BEETHOVEN_VENDOR_PASSPHRASE: 'a passphrase' });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(await signsLikeTheWorker(r.stdout.trim(), publicKey));
    // the old variable is still read
    assert.equal((await run(vendor, [], { ASHLEY_VENDOR_PASSPHRASE: 'a passphrase' })).stdout, r.stdout);
    r = await run(vendor);
    assert.deepEqual([r.code, r.stdout], [1, '']);
    assert.match(r.stderr, /is encrypted: set BEETHOVEN_VENDOR_PASSPHRASE/);
    r = await run(vendor, [], { BEETHOVEN_VENDOR_PASSPHRASE: 'not it' });
    assert.deepEqual([r.code, r.stdout], [1, '']);
    assert.match(r.stderr, /could not be opened/);
    assert.ok(!r.stderr.includes('not it'), 'the passphrase is never printed');
  } finally {
    fs.rmSync(vendor, { recursive: true, force: true });
  }
});

test('trial-key.mjs refuses a missing key, a key that is not Ed25519 and a key id that is not a plain name', async () => {
  const none = vendorWith(null);
  const ec = vendorWith(crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
  try {
    let r = await run(none);
    assert.deepEqual([r.code, r.stdout], [1, '']);
    assert.match(r.stderr, /no signing key at .*trial\.pem: Beethoven for VS Code's licence tool makes it once/);
    r = await run(ec);
    assert.deepEqual([r.code, r.stdout], [1, '']);
    assert.match(r.stderr, /is not an Ed25519 key/);
    for (const args of [['--kid', '../trial'], ['--kid', 'Trial'], ['--kid'], ['--other']]) {
      r = await run(none, args);
      assert.deepEqual([r.code, r.stdout], [2, ''], args.join(' '));
    }
  } finally {
    fs.rmSync(none, { recursive: true, force: true });
    fs.rmSync(ec, { recursive: true, force: true });
  }
});
