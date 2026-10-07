import { isObject } from "./text.ts";

export interface Prop {
  /** `a`, `a.b` for nested objects, `a[].b` for array items. */
  path: string;
  schema: unknown;
  required: boolean;
}

/**
 * Nesting deeper than this is not walked. The prototype has no limit (Python stops at about 1000
 * frames); the deepest fixture is 11 levels, and a 1 MiB paste could otherwise nest ~50,000.
 */
export const MAX_SCHEMA_DEPTH = 64;

/**
 * Every property of an input schema, recursively: nested objects, array items and the branches of
 * anyOf / oneOf / allOf. Port of walk_props; `required` and `properties` of the wrong type count
 * as absent (the prototype crashes or reads them loosely).
 */
export function walkProps(schema: unknown): Prop[] {
  const props: Prop[] = [];
  const walk = (node: unknown, path: string, depth: number): void => {
    if (!isObject(node) || depth > MAX_SCHEMA_DEPTH) return;
    const required = Array.isArray(node.required) ? node.required : [];
    const properties = isObject(node.properties) ? node.properties : {};
    for (const [key, value] of Object.entries(properties)) {
      const propPath = path ? `${path}.${key}` : key;
      props.push({ path: propPath, schema: value, required: required.includes(key) });
      if (!isObject(value)) continue;
      if (value.type === "object" || Object.hasOwn(value, "properties")) {
        walk(value, propPath, depth + 1);
      }
      if (value.type === "array" && isObject(value.items)) {
        walk(value.items, `${propPath}[]`, depth + 1);
      }
    }
    for (const combinator of ["anyOf", "oneOf", "allOf"]) {
      const branches = node[combinator];
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) walk(branch, path, depth + 1);
    }
  };
  walk(schema, "", 0);
  return props;
}
