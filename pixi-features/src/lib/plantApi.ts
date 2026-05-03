/**
 * Plant API — fetches the plant list and per-plant SVGs from the Flora backend.
 *
 * Vertical slice scope: per-plant fetch. The /svg-bundle/ zip + IndexedDB cache
 * are deferred until the silhouette pipeline is proven.
 */

import { floraFetchJson, floraFetchBytes, apiBaseUrl } from './floraApi'
import { readSvgFromCache, writeSvgToCache } from './plantCache'

export interface PlantSummary {
  id: number
  scientificName: string
  commonName: string
  /** Hex like "#4a7a3e" or null. */
  planColor: string | null
  /** Diameter in feet. Used for symbol scale. */
  planDiameterFt: number | null
  hasArtwork: boolean
}

interface PlantWithArtworkStatusResponse {
  id: number
  scientific_name: string
  common_name: string
  plan_color: string | null
  plan_diameter_ft: number | null
  artwork_count: number
  has_primary: boolean
}

const PLANT_LIST_PATH = '/api/plants-svg-status/?has_svg=true'
const SVG_QUALITY_DEFAULT = 'simplified'

export async function fetchPlantList(): Promise<PlantSummary[]> {
  const raw = await floraFetchJson<PlantWithArtworkStatusResponse[]>(PLANT_LIST_PATH)
  return raw
    .filter(p => p.artwork_count > 0)
    .map(p => ({
      id: p.id,
      scientificName: p.scientific_name,
      commonName: p.common_name,
      planColor: p.plan_color,
      planDiameterFt: p.plan_diameter_ft,
      hasArtwork: p.has_primary,
    }))
}

/**
 * Fetches a single plant's SVG markup. Cache-first: returns IndexedDB entry
 * when present, otherwise fetches from the backend and writes through.
 *
 * Backend returns gzipped SVG; browser decodes Content-Encoding automatically.
 */
export async function fetchPlantSvg(plantId: number): Promise<string> {
  const cached = await readSvgFromCache(plantId)
  if (cached) return cached

  const path = `/api/plants/${plantId}/svg/?quality=${SVG_QUALITY_DEFAULT}`
  const bytes = await floraFetchBytes(path)
  const svgString = new TextDecoder('utf-8').decode(bytes)
  await writeSvgToCache(plantId, svgString)
  return svgString
}

export { apiBaseUrl }
