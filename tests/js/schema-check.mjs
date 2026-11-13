// Minimal draft-07 subset checker (no validator dependency in this repo): type, required, properties, items, enum, additionalProperties:false.
const kindOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v);

export function violations(schema, value, path = "$") {
  const kind = kindOf(value);
  const types = [].concat(schema.type ?? []);
  if (types.length && !types.some((t) => t === kind || (t === "number" && kind === "integer"))) {
    return [`${path}: expected ${types.join("|")}, got ${kind}`];
  }
  const out = [];
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join("|")}`);
  if (kind === "object") {
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties ?? {}))) out.push(`${path}.${key}: additional property is not allowed`);
      }
    }
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
