// Minimal draft-07 subset checker (no validator dependency in this repo): type, required, properties, items.
const kindOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v);

export function violations(schema, value, path = "$") {
  const kind = kindOf(value);
  const types = [].concat(schema.type ?? []);
  if (types.length && !types.some((t) => t === kind || (t === "number" && kind === "integer"))) {
    return [`${path}: expected ${types.join("|")}, got ${kind}`];
  }
  const out = [];
  if (kind === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in value)) out.push(`${path}.${key}: required property is missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) out.push(...violations(sub, value[key], `${path}.${key}`));
    }
  }
  if (kind === "array" && schema.items) {
    value.forEach((item, i) => out.push(...violations(schema.items, item, `${path}[${i}]`)));
  }
  return out;
}
