// The access service's address, for the maintainer's command-line tool (admin.mjs): BEETHOVEN_SERVICE_URL
// when it is set, else the primary Worker's own address. Either Worker name would do: both hold the same
// records (README.md, "Two names"). The website's services.json is not read here: it is the website's, and
// deploy.sh prints what it should carry.
export const DEFAULT_SERVICE = 'https://beethoven-access.openspineconsortium.workers.dev';

/** { origin, from }: the service's origin and where it was read. */
export function serviceOrigin(env = process.env) {
  if (env.BEETHOVEN_SERVICE_URL) return { origin: new URL(env.BEETHOVEN_SERVICE_URL).origin, from: 'BEETHOVEN_SERVICE_URL' };
  return { origin: DEFAULT_SERVICE, from: 'the default' };
}
