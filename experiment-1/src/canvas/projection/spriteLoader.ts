import type { SpeciesType } from '@/stores/docStore';

const SPRITE_URLS: Record<SpeciesType, string> = {
  oak: '/sprites/oak.svg',
  magnolia: '/sprites/magnolia.svg',
  azalea: '/sprites/azalea.svg',
  fern: '/sprites/fern.svg',
};

// Rasterize SVGs at 1024px — large enough to look sharp up to ~10× zoom on a 2× display.
const RASTER_SIZE = 1024;

const cache = new Map<SpeciesType, HTMLImageElement>();

function loadOne(species: SpeciesType): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(RASTER_SIZE, RASTER_SIZE);
    img.onload = () => { cache.set(species, img); resolve(img); };
    img.onerror = () => reject(new Error(`Failed to load sprite: ${SPRITE_URLS[species]}`));
    img.src = SPRITE_URLS[species];
  });
}

export async function loadAllSprites(): Promise<void> {
  const species = Object.keys(SPRITE_URLS) as SpeciesType[];
  await Promise.all(species.map(loadOne));
}

export function getSprite(species: SpeciesType): HTMLImageElement | null {
  return cache.get(species) ?? null;
}
