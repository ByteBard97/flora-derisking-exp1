/**
 * IndexedDB cache for plant SVGs and extracted silhouettes.
 *
 * Two object stores:
 *   - svg:        key = plantId (number), value = { svgString, fetchedAt }
 *   - silhouette: key = `${plantId}|${dilation}|${tolerance}`, value = { polygons, rasterSize, fetchedAt }
 *
 * No eviction yet — the dataset is bounded (~410 plants × 30KB ≈ 12MB) and
 * IndexedDB quota is generous. Add LRU later if needed.
 */

import type { Vec2 } from './silhouette'

const DB_NAME = 'flora-pixi-features'
const DB_VERSION = 1
const STORE_SVG = 'svg'
const STORE_SILHOUETTE = 'silhouette'

interface SvgEntry {
  plantId: number
  svgString: string
  fetchedAt: number
}

interface SilhouetteEntry {
  cacheKey: string
  polygons: Vec2[][]
  rasterSize: number
  fetchedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_SVG)) {
        db.createObjectStore(STORE_SVG, { keyPath: 'plantId' })
      }
      if (!db.objectStoreNames.contains(STORE_SILHOUETTE)) {
        db.createObjectStore(STORE_SILHOUETTE, { keyPath: 'cacheKey' })
      }
    }
  })
  return dbPromise
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function readSvgFromCache(plantId: number): Promise<string | null> {
  const db = await openDb()
  const tx = db.transaction(STORE_SVG, 'readonly')
  const entry = await promisify<SvgEntry | undefined>(
    tx.objectStore(STORE_SVG).get(plantId) as IDBRequest<SvgEntry | undefined>,
  )
  return entry?.svgString ?? null
}

export async function writeSvgToCache(plantId: number, svgString: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_SVG, 'readwrite')
  const entry: SvgEntry = { plantId, svgString, fetchedAt: Date.now() }
  await promisify(tx.objectStore(STORE_SVG).put(entry))
}

export function silhouetteKey(plantId: number, dilation: number, tolerance: number): string {
  return `${plantId}|d${dilation}|t${tolerance}`
}

export async function readSilhouetteFromCache(
  cacheKey: string,
): Promise<{ polygons: Vec2[][]; rasterSize: number } | null> {
  const db = await openDb()
  const tx = db.transaction(STORE_SILHOUETTE, 'readonly')
  const entry = await promisify<SilhouetteEntry | undefined>(
    tx.objectStore(STORE_SILHOUETTE).get(cacheKey) as IDBRequest<SilhouetteEntry | undefined>,
  )
  if (!entry) return null
  return { polygons: entry.polygons, rasterSize: entry.rasterSize }
}

export async function writeSilhouetteToCache(
  cacheKey: string,
  polygons: Vec2[][],
  rasterSize: number,
): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_SILHOUETTE, 'readwrite')
  const entry: SilhouetteEntry = { cacheKey, polygons, rasterSize, fetchedAt: Date.now() }
  await promisify(tx.objectStore(STORE_SILHOUETTE).put(entry))
}

export async function clearAllCaches(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([STORE_SVG, STORE_SILHOUETTE], 'readwrite')
  await Promise.all([
    promisify(tx.objectStore(STORE_SVG).clear()),
    promisify(tx.objectStore(STORE_SILHOUETTE).clear()),
  ])
}
