import { Prisma } from '@prisma/client';

/**
 * The concrete mechanism behind ARCHITECTURE.md §8.3's "field-level
 * `@Sensitive()` marker": Prisma has no decorator system, so sensitive fields
 * are marked with a `/// @Sensitive` doc-comment in `prisma/schema.prisma`
 * (e.g. `User.passwordHash`, `UserSession.refreshTokenHash`) and read back
 * here from the generated client's DMMF
 * (`Prisma.dmmf.datamodel.models[].fields[].documentation`) — see
 * docs/BUILD_PLAN.md Phase 3.
 *
 * Redaction MATCHES BY FIELD NAME ACROSS ALL MODELS, not per-model: a
 * `passwordHash` key in ANY payload gets redacted regardless of which model
 * (or hand-built diff object) it came from. Deliberate over-redaction — a
 * false positive costs one unreadable audit field; a false negative leaks a
 * hash into the log forever (D13).
 *
 * `redactSensitive` runs BEFORE serialization (BUILD_PLAN.md risk #3): the
 * AuditInterceptor / direct audit writers pass raw entities/diffs through it
 * and only the redacted, JSON-plain result is ever handed to Prisma to
 * serialize into `audit_log.old_value` / `new_value`.
 */

const SENSITIVE_MARKER = '@Sensitive';
const REDACTED = '[redacted]';

let cachedByModel: Map<string, Set<string>> | undefined;
let cachedAllNames: Set<string> | undefined;

function buildMaps(): void {
  const byModel = new Map<string, Set<string>>();
  const allNames = new Set<string>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const fields = new Set<string>();
    for (const field of model.fields) {
      if (field.documentation?.includes(SENSITIVE_MARKER)) {
        fields.add(field.name);
        allNames.add(field.name);
      }
    }
    if (fields.size > 0) {
      byModel.set(model.name, fields);
    }
  }
  cachedByModel = byModel;
  cachedAllNames = allNames;
}

/** Map<modelName, Set<fieldName>> of every `/// @Sensitive` field in the schema. */
export function getSensitiveFieldsByModel(): Map<string, Set<string>> {
  if (!cachedByModel) buildMaps();
  return cachedByModel as Map<string, Set<string>>;
}

/** The union of every `/// @Sensitive` field NAME across all models. */
export function getSensitiveFieldNames(): Set<string> {
  if (!cachedAllNames) buildMaps();
  return cachedAllNames as Set<string>;
}

/**
 * Deep-copies `value` into a plain JSON-safe structure, replacing the value
 * of every key whose name matches a `/// @Sensitive` field (in any model)
 * with `"[redacted]"`. `Date`s become ISO strings, `undefined` object values
 * are dropped (same as JSON.stringify), non-serializable leaves (functions,
 * symbols) become null — the output is always safe to hand to a Prisma Json
 * column with no further transformation (redaction AT the serialization
 * layer, not after it).
 */
export function redactSensitive(value: unknown): unknown {
  return redactValue(value, getSensitiveFieldNames());
}

function redactValue(value: unknown, sensitiveNames: Set<string>): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactValue(item, sensitiveNames));
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry === undefined) continue;
        out[key] = sensitiveNames.has(key) ? REDACTED : redactValue(entry, sensitiveNames);
      }
      return out;
    }
    default:
      // function / symbol — not representable in JSONB.
      return null;
  }
}
