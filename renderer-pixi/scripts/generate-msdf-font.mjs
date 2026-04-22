#!/usr/bin/env node
/**
 * Generates the MSDF font atlas for BitmapText labels.
 * Output: public/fonts/plant-label.fnt + public/fonts/plant-label.png
 *
 * Run: npm run fonts
 *
 * Already run — re-run only if you change the font or charset.
 */
import { execSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
const OUT = resolve(__dir, '../public/fonts/plant-label')

execSync(
  `./node_modules/.bin/msdf-bmfont -o "${OUT}" -s 48 -t msdf -m 512,512 -r 4 -f xml "${FONT}"`,
  { cwd: resolve(__dir, '..'), stdio: 'inherit' }
)
// msdf-bmfont names the .fnt after the font face (Arial.fnt) — copy to plant-label.fnt
import { copyFileSync } from 'fs'
copyFileSync(resolve(__dir, '../public/fonts/Arial.fnt'), resolve(__dir, '../public/fonts/plant-label.fnt'))
console.log('Font atlas ready: public/fonts/plant-label.fnt + plant-label.png')
