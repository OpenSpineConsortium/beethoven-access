// Where the vendor folder is: the access service's secrets (and the VS Code edition's private signing keys
// and ledger beside them), on the maintainer's own computer and never in a repository. Its name follows the
// product: ~/.beethoven-vendor since 2026-09-30. It was ~/.ashley-vendor before, and a junction left at
// that path points at the new folder, so the old names below are still read for what was set up earlier.
// The first that is set, or exists, wins:
//   BEETHOVEN_VENDOR_DIR, ASHLEY_VENDOR_DIR (the old variable), ~/.beethoven-vendor,
//   ~/.ashley-vendor (the old folder), and ~/.beethoven-vendor when neither folder exists yet.
// deploy.sh spells out the same order in the shell.
//
// This repository's own copy. It started on 2026-10-07 as beethoven-vscode's tools/license/vendor.mjs (at
// 2e74bb6, the commit the access service was split from) and is not kept in step with that file: the two
// repositories share the vendor folder's layout (the order above, admin_token and the other secrets' files,
// keys/<kid>.pem and the passphrase variables), not this code. A change to that layout is made in both.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function vendorFolder(env = process.env, home = os.homedir()) {
  const named = env.BEETHOVEN_VENDOR_DIR || env.ASHLEY_VENDOR_DIR;
  if (named) return path.resolve(named);
  const current = path.join(home, '.beethoven-vendor');
  const old = path.join(home, '.ashley-vendor');
  if (fs.existsSync(current)) return current;
  if (fs.existsSync(old)) return old;
  return current;
}

/** The passphrase of an encrypted signing key; the old variable name is still read. */
export function vendorPassphrase(env = process.env) {
  return env.BEETHOVEN_VENDOR_PASSPHRASE || env.ASHLEY_VENDOR_PASSPHRASE || undefined;
}
