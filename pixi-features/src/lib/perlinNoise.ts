/**
 * Seeded multi-octave 2D noise for the Bousseau "turbulent flow" pass.
 *
 * Uses simplex-noise (cheap, no axis artifacts). One noise function per
 * call site, seeded by plant id so each plant has its own flow pattern.
 */

import { createNoise2D } from 'simplex-noise'
import alea from 'alea'

export type NoiseFn = (x: number, y: number) => number

/** Simple seeded RNG factory — alea is bundled with simplex-noise's recommended setup. */
export function seededNoise2D(seed: number): NoiseFn {
  return createNoise2D(alea(seed.toString()))
}

/**
 * Multi-octave Fractional Brownian Motion sampling. Returns a value in [0, 1].
 *
 * @param baseFreq — frequency of the lowest octave (smaller = larger patches)
 * @param persistence — amplitude falloff per octave (0.5 = standard)
 */
export function fbm2d(
  noise: NoiseFn,
  x: number,
  y: number,
  octaves: number,
  baseFreq: number,
  persistence = 0.5,
): number {
  let total = 0
  let amplitude = 1
  let frequency = baseFreq
  let max = 0
  for (let i = 0; i < octaves; i++) {
    // simplex-noise returns [-1, 1]; remap to [0, 1].
    total += amplitude * (noise(x * frequency, y * frequency) + 1) * 0.5
    max += amplitude
    amplitude *= persistence
    frequency *= 2
  }
  return total / max
}
