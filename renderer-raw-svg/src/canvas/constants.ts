import { LOT_WIDTH_INCHES, LOT_HEIGHT_INCHES } from '@/stores/docStore';

export const PX_PER_INCH = 96;
export const WORLD_W = LOT_WIDTH_INCHES * PX_PER_INCH;  // 120 * 96 = 11520
export const WORLD_H = LOT_HEIGHT_INCHES * PX_PER_INCH; // 180 * 96 = 17280
