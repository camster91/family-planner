// Recompose the approved assets; do not redraw, recolor or replace the identity.
// Run: node scripts/generate-social-preview.mjs (uses existing Sharp dependency).
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = 'public/brand/woven-grove/herewoven-social.png'
const sources = [
  'public/brand/woven-grove/logos/herewoven-horizontal.png',
  'public/brand/woven-grove/graphics/herewoven-woven-graphic.svg',
]
const adoption = JSON.parse(await fs.readFile(path.join(root, 'public/brand/woven-grove/adoption-manifest.json'), 'utf8'))
const buffers = await Promise.all(sources.map((file) => fs.readFile(path.join(root, file))))
const hashes = Object.fromEntries(sources.map((file, i) => [file, createHash('sha256').update(buffers[i]).digest('hex')]))
for (const file of sources) {
  if (hashes[file] !== adoption.files[file]) throw new Error(`Approved source hash mismatch: ${file}`)
}
const layers = [
  { source: sources[0], width: 820, left: 190, top: 0 },
  { source: sources[1], width: 600, left: 300, top: 220 },
]
const overlays = await Promise.all(layers.map(async (layer, i) => ({
  input: await sharp(buffers[i]).resize({ width: layer.width }).png().toBuffer(),
  left: layer.left,
  top: layer.top,
})))
const image = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#F7F4EC' } })
  .composite(overlays).png({ compressionLevel: 9 }).toBuffer()
await fs.writeFile(path.join(root, output), image)
const manifest = {
  command: 'node scripts/generate-social-preview.mjs',
  composition: 'Whole approved horizontal logo and whole woven graphic, proportionally resized, on Chalk. No text rendering, cropping, recoloring or source changes.',
  sharp: sharp.versions,
  background: '#F7F4EC',
  sources: hashes,
  layers,
  output: { file: output, width: 1200, height: 630, sha256: createHash('sha256').update(image).digest('hex') },
}
await fs.writeFile(path.join(root, 'public/brand/woven-grove/social-preview-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`${output}: ${manifest.output.sha256}`)
