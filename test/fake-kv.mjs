// Cloudflare KV, in memory, for the Worker's tests (worker.test.mjs) and the vectors (vectors.mjs):
// get/put/delete and a paged list (two keys a page, to exercise the cursor); the expirationTtl of each put is
// kept in ttl so a test can read it (nothing expires on its own). A string is kept as a string; an
// ArrayBuffer or a typed array as a copy of its bytes, as KV keeps binary values, and read back as text,
// JSON or an ArrayBuffer; the metadata of a put is kept beside the value.
export class FakeKV {
  constructor() {
    this.m = new Map();
    this.ttl = new Map();
    this.meta = new Map();
  }
  async get(k, type) {
    const v = this.m.get(k);
    if (v === undefined) return null;
    const t = type && typeof type === 'object' ? type.type : type;
    const text = v instanceof Uint8Array ? new TextDecoder().decode(v) : v;
    if (t === 'arrayBuffer') return v instanceof Uint8Array ? v.slice().buffer : new TextEncoder().encode(v).buffer;
    return t === 'json' ? JSON.parse(text) : text;
  }
  async getWithMetadata(k, type) {
    return { value: await this.get(k, type), metadata: this.meta.has(k) ? this.meta.get(k) : null };
  }
  async put(k, v, opts) {
    if (v instanceof ArrayBuffer) this.m.set(k, new Uint8Array(v.slice(0)));
    else if (ArrayBuffer.isView(v)) this.m.set(k, new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
    else this.m.set(k, String(v));
    this.ttl.set(k, opts && opts.expirationTtl);
    if (opts && opts.metadata !== undefined) this.meta.set(k, JSON.parse(JSON.stringify(opts.metadata)));
    else this.meta.delete(k);
  }
  async delete(k) {
    this.m.delete(k);
    this.ttl.delete(k);
    this.meta.delete(k);
  }
  async list({ prefix = '', cursor } = {}) {
    const all = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = Number(cursor || 0);
    const keys = all.slice(start, start + 2).map((name) => ({ name }));
    const done = start + 2 >= all.length;
    return { keys, list_complete: done, cursor: done ? undefined : String(start + 2) };
  }
}
