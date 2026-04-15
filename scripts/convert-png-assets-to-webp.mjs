/**
 * Convert all PNG files under public/ (recursive) to WebP and remove the PNGs.
 *
 * Run: npm run assets:webp-sprites
 *
 * Env: WEBP_QUALITY (default 88), WEBP_ALPHA_QUALITY (default 100)
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicRoot = join(__dirname, '..', 'public')

const quality = Number(process.env.WEBP_QUALITY ?? 88)
const alphaQuality = Number(process.env.WEBP_ALPHA_QUALITY ?? 100)

/** Recursively collect `.png` under `public/` (excludes symlinks to odd paths). */
function walkPng(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name)
    if (name.isDirectory()) walkPng(full, acc)
    else if (name.isFile() && name.name.toLowerCase().endsWith('.png')) acc.push(full)
  }
  return acc
}

const inputs = walkPng(publicRoot)

if (inputs.length === 0) {
  console.log('No PNG files found under public/. Nothing to do.')
  process.exit(0)
}

for (const input of inputs) {
  const base = input.slice(0, -extname(input).length)
  const output = `${base}.webp`
  await sharp(input)
    .webp({ quality, effort: 6, alphaQuality })
    .toFile(output)
  console.log('Wrote', output, `(quality ${quality}, from ${input})`)
  unlinkSync(input)
  console.log('Removed', input)
}

console.log('Done.')
