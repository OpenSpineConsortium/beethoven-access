// A JSON Schema check for the contract's schemas (interface/contract/*.schema.json), with nothing installed.
// It knows the keywords the schemas use and nothing more, and refuses a schema that uses another, so a schema
// never says more than every client's check can read: type, enum, const, pattern, minimum, required,
// properties, additionalProperties, items, anyOf, allOf, not, $ref (inside the file, "#/$defs/<name>"; to a
// schema beside it, "<file>.schema.json"; or to a definition there, "<file>.schema.json#/$defs/<name>"), and
// the annotations $schema, $id, $defs, title and description. The same set as hpcworker's contract uses, so
// a client that reads both needs one check. Patterns use only what JavaScript and Python share.
import * as fs from 'node:fs';
import * as path from 'node:path';

export const KNOWN = new Set(['type', 'enum', 'const', 'pattern', 'minimum', 'required', 'properties', 'additionalProperties', 'items', 'anyOf', 'allOf', 'not', '$ref', '$schema', '$id', '$defs', 'title', 'description']);

/** The keywords a schema uses that this check does not know, each with where it is. */
export function unknownKeywords(schema, where = '#') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const bad = [];
  for (const [k, v] of Object.entries(schema)) {
    if (!KNOWN.has(k)) bad.push(`${where}/${k}`);
    if (k === 'properties' || k === '$defs') for (const [name, sub] of Object.entries(v)) bad.push(...unknownKeywords(sub, `${where}/${k}/${name}`));
    else if (k === 'anyOf' || k === 'allOf') v.forEach((sub, i) => bad.push(...unknownKeywords(sub, `${where}/${k}/${i}`)));
    else if (k === 'items' || k === 'not' || k === 'additionalProperties') bad.push(...unknownKeywords(v, `${where}/${k}`));
  }
  return bad;
}

const TYPES = {
  object: (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
  array: Array.isArray,
  string: (x) => typeof x === 'string',
  boolean: (x) => typeof x === 'boolean',
  null: (x) => x === null,
  integer: Number.isInteger,
  number: (x) => typeof x === 'number' && Number.isFinite(x),
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A checker of values against one schema file of folder; refs to the files beside it are read on demand. */
export class Checker {
  constructor(folder, name) {
    this.folder = folder;
    this.files = new Map();
    this.root = this.file(name);
  }

  file(name) {
    if (!this.files.has(name)) this.files.set(name, JSON.parse(fs.readFileSync(path.join(this.folder, name), 'utf8')));
    return this.files.get(name);
  }

  resolve(ref, root) {
    const [file, pointer] = ref.split('#');
    const base = file ? this.file(file) : root;
    if (!pointer) return [base, base];
    const name = pointer.replace(/^\/\$defs\//, '');
    if (!base.$defs || !Object.hasOwn(base.$defs, name)) throw new Error(`no definition ${ref}`);
    return [base.$defs[name], base];
  }

  /** The places where value breaks the schema, each with why; [] when it holds. */
  errors(value, schema = this.root, root = this.root, at = '$') {
    const out = [];
    if (schema.$ref) {
      const [sub, subRoot] = this.resolve(schema.$ref, root);
      out.push(...this.errors(value, sub, subRoot, at));
    }
    if (schema.type) {
      const names = [].concat(schema.type);
      if (!names.some((n) => TYPES[n](value))) return [...out, `${at}: ${JSON.stringify(value)} is not of type ${names.join('/')}`];
    }
    if (schema.enum && !schema.enum.some((x) => same(x, value))) out.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    if ('const' in schema && !same(schema.const, value)) out.push(`${at}: ${JSON.stringify(value)} is not ${JSON.stringify(schema.const)}`);
    if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) out.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    if ('minimum' in schema && typeof value === 'number' && value < schema.minimum) out.push(`${at}: ${value} is below ${schema.minimum}`);
    if (TYPES.object(value)) {
      for (const k of schema.required || []) if (!Object.hasOwn(value, k)) out.push(`${at}: ${k} is missing`);
      const props = schema.properties || {};
      for (const [k, v] of Object.entries(value)) {
        if (Object.hasOwn(props, k)) out.push(...this.errors(v, props[k], root, `${at}.${k}`));
        else if (schema.additionalProperties === false) out.push(`${at}: ${k} is not a field here`);
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') out.push(...this.errors(v, schema.additionalProperties, root, `${at}.${k}`));
      }
    }
    if (Array.isArray(value) && schema.items) value.forEach((v, i) => out.push(...this.errors(v, schema.items, root, `${at}[${i}]`)));
    if (schema.anyOf && !schema.anyOf.some((s) => this.errors(value, s, root, at).length === 0)) out.push(`${at}: matches none of anyOf`);
    for (const s of schema.allOf || []) out.push(...this.errors(value, s, root, at));
    if (schema.not && this.errors(value, schema.not, root, at).length === 0) out.push(`${at}: matches what not refuses`);
    return out;
  }
}
