/** Barcode identity stays a string: leading zeroes are significant. */
function validGtin(value: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false
  let sum = 0
  for (let i = value.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(value[i]) * weight
  }
  return (10 - (sum % 10)) % 10 === Number(value[value.length - 1])
}

export function normalizeBarcode(value: string): string {
  const code = String(value ?? '').trim()
  return /^\d{12}$/.test(code) && validGtin(code) ? `0${code}` : code
}

/** Explicit format is required for camera output; manual input may also be a SKU. */
export function validateBarcode(value: string, format?: string): boolean {
  const code = String(value ?? '').trim()
  if (code.length < 4 || code.length > 64 || !/^[\x21-\x7e]+$/.test(code)) return false
  const kind = format?.toLowerCase()
  if (kind === 'ean_13') return /^\d{13}$/.test(code) && validGtin(code)
  if (kind === 'ean_8') return /^\d{8}$/.test(code) && validGtin(code)
  if (kind === 'upc_a') return /^\d{12}$/.test(code) && validGtin(code)
  if (kind === 'code_128') return true // The decoder verifies Code 128's internal checksum.
  if (kind) return false
  if (/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return validGtin(code)
  return true
}

/** Two matching consecutive reads; a held barcode never creates repeated cart lines. */
export class ScanStabilityGate {
  private candidate = ''
  private candidateAt = 0
  private count = 0
  private emitted = ''
  private absentAt: number | null = null

  reset() {
    this.candidate = ''
    this.count = 0
    this.emitted = ''
    this.absentAt = null
  }

  observe(value: string | null, format: string | undefined, now: number): string | null {
    if (!value || !validateBarcode(value, format)) {
      this.candidate = ''
      this.count = 0
      if (this.absentAt === null) this.absentAt = now
      if (now - this.absentAt >= 700) this.emitted = ''
      return null
    }
    const code = normalizeBarcode(value)
    this.absentAt = null
    if (this.candidate === code && now - this.candidateAt <= 700) this.count++
    else { this.candidate = code; this.count = 1 }
    this.candidateAt = now
    if (this.count < 2 || this.emitted === code) return null
    this.emitted = code
    return code
  }
}
