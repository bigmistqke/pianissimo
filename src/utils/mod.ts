/** mod utility that also handles negative values */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}
