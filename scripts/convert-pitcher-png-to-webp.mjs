/**
 * Convert PNG frames in public/assets/pitcher/ to WebP and remove the PNGs.
 *
 * Place: public/assets/pitcher/mariano1.png … mariano5.png
 * Run: npm run assets:webp-pitcher
 *
 * Env: WEBP_QUALITY (default 85), WEBP_ALPHA_QUALITY (default 100)
 */
import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pitcherDir = join(__dirname, '..', 'public', 'assets', 'pitcher')

const quality = Number(process.env.WEBP_QUALITY ?? 85)
const alphaQuality = Number(process.env.WEBP_ALPHA_QUALITY ?? 100)

if (!existsSync(pitcherDir)) {
  console.error('Missing directory:', pitcherDir)
  console.error('Create public/assets/pitcher/ and add mariano1.png … mariano5.png')
  process.exit(1)
}

const pngs = readdirSync(pitcherDir).filter(
  (n) => n.toLowerCase().endsWith('.png')
)

if (pngs.length === 0) {
  console.log('No PNG files in', pitcherDir, '— nothing to do.')
  process.exit(0)
}

for (const name of pngs) {
  const input = join(pitcherDir, name)
  const base = name.slice(0, -extname(name).length)
  const output = join(pitcherDir, `${base}.webp`)
  await sharp(input)
    .webp({ quality, effort: 6, alphaQuality })
    .toFile(output)
  console.log('Wrote', output, `(quality ${quality})`)
  unlinkSync(input)
  console.log('Removed', input)
}

console.log('Done.')
