/**
 * Sobel gradient magnitude on RGBA ImageData, masked by alpha.
 *
 * Per Bousseau et al. and our Kimi review: Sobel must NOT sample neighbors
 * outside the silhouette (alpha=0), or it picks up garbage gradients along
 * the silhouette edge that read as a fake "watercolor fringe" outside the
 * shape. We mask each kernel sample by its alpha, falling back to the
 * center pixel where the neighbor is transparent.
 *
 * Returns a Uint8Array length w*h with normalized magnitude in [0, 255].
 */

const SOBEL_X = [
  -1, 0, 1,
  -2, 0, 2,
  -1, 0, 1,
] as const

const SOBEL_Y = [
  -1, -2, -1,
   0,  0,  0,
   1,  2,  1,
] as const

const ALPHA_OPAQUE_THRESHOLD = 16

/** Luminance of an RGB triple (Rec. 709). */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function computeAlphaMaskedSobel(image: ImageData): Uint8Array {
  const w = image.width
  const h = image.height
  const src = image.data
  const out = new Uint8Array(w * h)

  // Two-pass: collect raw magnitudes + max for normalization.
  const raw = new Float32Array(w * h)
  let maxMag = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cIdx = (y * w + x) * 4
      // Skip transparent pixels — they're outside the silhouette.
      if (src[cIdx + 3] < ALPHA_OPAQUE_THRESHOLD) continue

      const cLum = luma(src[cIdx], src[cIdx + 1], src[cIdx + 2])

      let gx = 0
      let gy = 0
      let k = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const nx = x + kx
          const ny = y + ky
          let sampleLum: number
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nIdx = (ny * w + nx) * 4
            // If neighbor is transparent, reuse center luminance — no gradient
            // contribution from the silhouette boundary.
            sampleLum = src[nIdx + 3] < ALPHA_OPAQUE_THRESHOLD
              ? cLum
              : luma(src[nIdx], src[nIdx + 1], src[nIdx + 2])
          } else {
            sampleLum = cLum
          }
          gx += SOBEL_X[k] * sampleLum
          gy += SOBEL_Y[k] * sampleLum
          k++
        }
      }

      const mag = Math.sqrt(gx * gx + gy * gy)
      raw[y * w + x] = mag
      if (mag > maxMag) maxMag = mag
    }
  }

  if (maxMag <= 0) return out

  const scale = 255 / maxMag
  for (let i = 0; i < raw.length; i++) {
    out[i] = Math.min(255, Math.round(raw[i] * scale))
  }
  return out
}
