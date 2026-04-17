/**
 * Legacy: encoded single stadium bg. The game now loads `/assets/bg-sky.webp` +
 * `/assets/bg-field.webp` (2048×1152). Keep this script for one-off encodes if needed.
 *
 * Default input (preferred): public/assets/big-stadium.png
 * Fallback:              public/assets/bg-stadium.png
 *
 * Run: npm run assets:webp-bg
 * Or:  node scripts/encode-bg-stadium-webp.mjs [path/to/source.png]
 *
 * Env: WEBP_QUALITY (default 85)
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const preferred = join(root, 'public/assets/big-stadium.png')
const fallback = join(root, 'public/assets/bg-stadium.png')
const output = join(root, 'public/assets/bg-stadium.webp')

const arg = process.argv[2]
let input
if (arg) {
  input = arg.startsWith('/') ? arg : join(root, arg)
} else if (existsSync(preferred)) {
  input = preferred
} else if (existsSync(fallback)) {
  input = fallback
  console.warn(
    'Note: public/assets/big-stadium.png not found; using bg-stadium.png. Add big-stadium.png to prefer the new art.'
  )
} else {
  console.error(
    'Missing stadium PNG. Place big-stadium.png in public/assets/ (or keep bg-stadium.png).'
  )
  console.error('Expected:', preferred, 'or', fallback)
  process.exit(1)
}

if (!existsSync(input)) {
  console.error('Missing input:', input)
  process.exit(1)
}

const quality = Number(process.env.WEBP_QUALITY ?? 85)
await sharp(input)
  .webp({ quality, effort: 6, alphaQuality: 100 })
  .toFile(output)

console.log('Wrote', output, `(quality ${quality}, from ${input})`)
