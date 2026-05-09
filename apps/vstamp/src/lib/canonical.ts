/**
 * Canonical JSON serialisation.
 *
 * To make a hash of a bracket reproducible by anyone who has the raw bracket
 * data, we need a single deterministic byte representation. Standard
 * JSON.stringify is *not* deterministic across implementations because it
 * preserves object insertion order — two equivalent brackets serialise
 * differently, hash differently, and verification breaks.
 *
 * Rules:
 *   - Object keys sorted lexicographically (UTF-16 code units, the JS default).
 *   - No whitespace anywhere.
 *   - Numbers must be finite. NaN, Infinity, -Infinity are rejected.
 *   - Floats are forbidden — only integers. Brackets express scores, ranks,
 *     and probabilities-as-bps; floats invite cross-language drift. If you
 *     need a probability, encode it as an integer (e.g. parts-per-million).
 *   - undefined keys are dropped (consistent with JSON.stringify).
 *   - Cycles raise a TypeError.
 *
 * The canonicalisation is intentionally a small, auditable subset of RFC 8785
 * (JCS). We don't need full JCS because we control the input shape — but we
 * document the rules so anyone implementing a verifier in another language
 * can match exactly.
 */

export class CanonicalJSONError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJSONError';
  }
}

export function canonicalize(value: unknown): string {
  return serialize(value, new WeakSet());
}

function serialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new CanonicalJSONError('undefined is not a valid JSON value');
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new CanonicalJSONError(`non-finite number not allowed: ${value}`);
      }
      if (!Number.isInteger(value)) {
        throw new CanonicalJSONError(
          `floats are not allowed in canonical JSON; got ${value}. Encode as integer.`,
        );
      }
      return String(value);
    }
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      // BigInt isn't standard JSON but cleanly canonicalises as the integer literal.
      return value.toString();
    case 'object':
      break;
    default:
      throw new CanonicalJSONError(`unsupported type: ${typeof value}`);
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new CanonicalJSONError('cycle detected during canonicalisation');
  }
  seen.add(obj);

  try {
    if (Array.isArray(obj)) {
      const parts = obj.map((item) => {
        if (item === undefined) return 'null';
        return serialize(item, seen);
      });
      return `[${parts.join(',')}]`;
    }

    const entries: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === undefined) continue;
      entries.push([k, v]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const parts = entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v, seen)}`);
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
