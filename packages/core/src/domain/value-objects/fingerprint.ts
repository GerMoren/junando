import { createHash } from 'node:crypto'
import type { NormalizedAlert } from '../entities/alert.js'

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint — a Value Object in DDD terms.
// Immutable, identity based on value not reference.
// Encapsulates the hashing algorithm so it's swappable in one place.
// ─────────────────────────────────────────────────────────────────────────────

export class Fingerprint {
  private constructor(readonly value: string) {}

  static fromAlert(alert: NormalizedAlert): Fingerprint {
    const input = [
      alert.serviceName.toLowerCase().trim(),
      alert.errorType.toLowerCase().trim(),
      alert.endpointPath.toLowerCase().trim(),
    ].join('|')

    const hash = createHash('sha256').update(input).digest('hex')
    return new Fingerprint(hash)
  }

  equals(other: Fingerprint): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
