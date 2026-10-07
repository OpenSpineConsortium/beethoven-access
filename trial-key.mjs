#!/usr/bin/env node
// The trial signing key, for the Worker's secret TRIAL_KEY_PKCS8_B64: the private key of one key id as base64
// PKCS8 DER on stdout, and nothing else there.
//   node trial-key.mjs [--kid trial] | wrangler secret put TRIAL_KEY_PKCS8_B64      (deploy.sh does this)
// The key is the file keys/<kid>.pem in the vendor folder (vendor.mjs), encrypted or not; an encrypted one
// is opened with BEETHOVEN_VENDOR_PASSPHRASE (ASHLEY_VENDOR_PASSPHRASE still read). That file, its place and
// the passphrase variables are the interface with Beethoven for VS Code's licence tool, which makes the key
// once (beethoven-license.mjs init --kid trial in that repository) and records its public key in that
// edition's grid/license_keys.json; nothing of that repository is read or run here. The public half must be
// the one interface/contract/signing-keys.json names for the key id, this repository's own record of what
// that edition trusts: a wrong or stale vendor folder would otherwise have the service sign keys and
// withdrawals no installation accepts, and since an installation acts only on a withdrawal it can verify,
// nothing would say so. A key rotated on purpose goes into that file in a reviewed commit first.
// stdout must not be a terminal: the key goes into a pipe, never onto a screen or into a scrollback.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorFolder, vendorPassphrase } from './vendor.mjs';

const TRUSTED = path.join(path.dirname(fileURLToPath(import.meta.url)), 'interface', 'contract', 'signing-keys.json');

function die(msg, code = 1) {
  process.stderr.write(`trial-key: ${msg}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
let kid = 'trial';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--kid' && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) kid = args[++i];
  else die(`usage: node trial-key.mjs [--kid <key id>] | wrangler secret put TRIAL_KEY_PKCS8_B64 (not ${args[i]})`, 2);
}
// the rule the licence tool names a key by, so the id can never point outside keys/
if (!/^[a-z0-9-]{1,16}$/.test(kid)) die('--kid is lower-case letters, digits and dashes, 16 at most', 2);
if (process.stdout.isTTY) die('the private key is written only into a pipe: node trial-key.mjs | wrangler secret put TRIAL_KEY_PKCS8_B64', 2);

const file = path.join(vendorFolder(), 'keys', `${kid}.pem`);
if (!fs.existsSync(file)) die(`no signing key at ${file}: Beethoven for VS Code's licence tool makes it once (beethoven-license.mjs init --kid ${kid})`);
const pem = fs.readFileSync(file, 'utf8');
const encrypted = pem.includes('ENCRYPTED');
const passphrase = encrypted ? vendorPassphrase() : undefined;
if (encrypted && !passphrase) die(`${file} is encrypted: set BEETHOVEN_VENDOR_PASSPHRASE`);
let key;
try {
  key = crypto.createPrivateKey({ key: pem, format: 'pem', passphrase });
} catch {
  // the reason stays out of the message: it can only be the file or the passphrase, and neither is shown
  die(`${file} could not be opened${encrypted ? ' (is BEETHOVEN_VENDOR_PASSPHRASE the one it was encrypted with?)' : ''}`);
}
// the Worker imports the secret as Ed25519 and nothing else
if (key.asymmetricKeyType !== 'ed25519') die(`${file} is not an Ed25519 key`);
const der = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
const pub = der.subarray(der.length - 32).toString('base64');
const trusted = JSON.parse(fs.readFileSync(TRUSTED, 'utf8')).keys || {};
if (!Object.hasOwn(trusted, kid)) die(`interface/contract/signing-keys.json names no public key for "${kid}": the service signs only with a key Beethoven for VS Code trusts, so add it there in a reviewed commit once that edition lists it`);
if (trusted[kid] !== pub) die(`${file} is not the "${kid}" key Beethoven for VS Code trusts: its public key is ${pub}, and interface/contract/signing-keys.json names ${trusted[kid]}. Is BEETHOVEN_VENDOR_DIR the right folder? Nothing was printed for the Worker`);
process.stderr.write(`trial-key: ${kid}: public key ${pub}, the one interface/contract/signing-keys.json names\n`);
process.stdout.write(`${key.export({ type: 'pkcs8', format: 'der' }).toString('base64')}\n`);
