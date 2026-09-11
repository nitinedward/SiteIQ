/* Throwaway check for src/lib/attachmentSections.ts against a real report.
 * Run: npx tsx scripts/attachment-sections.check.ts <inspectionId>  */
import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import {
  SECTION_DEFS, LEGACY_SECTION,
  extractSections, graftSections, removeSections, placeSection, wrapSection, hasLegacySection,
} from '../src/lib/attachmentSections'

const id = process.argv[2] ?? '254dc301-51c4-44f4-be3c-ef1a56ba5674'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').replace(/^﻿/, '').trim()
)

/** Cheap well-formedness check: every tag opened is closed, in order. */
function xmlIsBalanced(xml: string): { ok: boolean; detail: string } {
  const stack: string[] = []
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, attrs, selfClose] = m
    if (attrs.startsWith('?') || name.startsWith('!')) continue
    if (selfClose === '/') continue
    if (closing === '/') {
      if (stack.pop() !== name) return { ok: false, detail: `unbalanced at </${name}>` }
    } else {
      stack.push(name)
    }
  }
  return stack.length === 0
    ? { ok: true, detail: 'balanced' }
    : { ok: false, detail: `unclosed: ${stack.slice(-3).join(', ')}` }
}

function report(zip: AdmZip, label: string) {
  const docXml  = zip.getEntry('word/document.xml')!.getData().toString('utf-8')
  const relsXml = zip.getEntry('word/_rels/document.xml.rels')!.getData().toString('utf-8')
  const embeds  = [...new Set([...docXml.matchAll(/r:embed="(rId\d+)"/g)].map(m => m[1]))]

  const dangling = embeds.filter(rId => !new RegExp(`Id="${rId}"`).test(relsXml))
  const missingMedia = embeds.flatMap(rId => {
    const target = relsXml.match(new RegExp(`<Relationship Id="${rId}"[^>]*Target="([^"]+)"`))?.[1]
    return target && !zip.getEntry(`word/${target}`) ? [`${rId} -> ${target}`] : []
  })

  const balanced = xmlIsBalanced(docXml)
  console.log(`\n── ${label}`)
  console.log('   drawings section:', docXml.includes(SECTION_DEFS.drawings.bookmark))
  console.log('   photos section:  ', docXml.includes(SECTION_DEFS.photos.bookmark))
  console.log('   legacy section:  ', hasLegacySection(docXml))
  console.log('   image refs:', embeds.length, '| dangling rels:', dangling.length, '| missing media:', missingMedia.length)
  console.log('   document.xml:', balanced.detail, '| size:', docXml.length)
  if (dangling.length || missingMedia.length || !balanced.ok) {
    console.log('   ✗ PROBLEM', { dangling, missingMedia })
    process.exitCode = 1
  } else {
    console.log('   ✓ intact')
  }
}

async function main() {
  const { data } = await sb.storage.from('reports').createSignedUrl(`${id}.docx`, 60)
  if (!data?.signedUrl) throw new Error('no stored document for ' + id)
  const original = Buffer.from(await (await fetch(data.signedUrl)).arrayBuffer())
  console.log('Loaded', id, '—', original.length, 'bytes')

  report(new AdmZip(original), 'original document')

  // 1. Extract what SiteIQ manages.
  const sections = extractSections(original)
  console.log('\nextractSections ->', sections.map(s => `${s.bookmark} (${s.media.length} images, ${s.inner.length} chars)`).join(' | ') || 'none')

  // 2. Simulate a regeneration: strip the managed sections (that's roughly
  //    what a freshly-filled template is), then graft them back.
  const stripZip = new AdmZip(original)
  let docXml  = stripZip.getEntry('word/document.xml')!.getData().toString('utf-8')
  let relsXml = stripZip.getEntry('word/_rels/document.xml.rels')!.getData().toString('utf-8')
  ;({ docXml, relsXml } = removeSections(docXml, relsXml, stripZip, [
    SECTION_DEFS.drawings.bookmark, SECTION_DEFS.photos.bookmark, LEGACY_SECTION.bookmark,
  ]))
  stripZip.updateFile('word/document.xml', Buffer.from(docXml, 'utf-8'))
  stripZip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml, 'utf-8'))
  const stripped = stripZip.toBuffer()
  report(new AdmZip(stripped), 'after removeSections (simulated regenerated text)')

  const regrafted = graftSections(stripped, sections)
  report(new AdmZip(regrafted), 'after graftSections (attachments carried forward)')

  // 3. Per-section independence: rebuild only the photos section and check
  //    the drawings section is untouched.
  const perSection = new AdmZip(regrafted)
  let d2 = perSection.getEntry('word/document.xml')!.getData().toString('utf-8')
  let r2 = perSection.getEntry('word/_rels/document.xml.rels')!.getData().toString('utf-8')
  const drawingsBefore = d2.includes(SECTION_DEFS.drawings.bookmark)
  ;({ docXml: d2, relsXml: r2 } = removeSections(d2, r2, perSection, [SECTION_DEFS.photos.bookmark]))
  d2 = placeSection(d2, 'photos', wrapSection('photos', '<w:p><w:r><w:t>rebuilt photos</w:t></w:r></w:p>'))
  perSection.updateFile('word/document.xml', Buffer.from(d2, 'utf-8'))
  perSection.updateFile('word/_rels/document.xml.rels', Buffer.from(r2, 'utf-8'))
  report(new AdmZip(perSection.toBuffer()), 'after rebuilding ONLY the photos section')
  console.log('   drawings section survived the photo-only rebuild:',
    drawingsBefore === d2.includes(SECTION_DEFS.drawings.bookmark))

  // 4. Ordering: a drawings section added afterwards must land before photos.
  const ordered = placeSection(d2, 'drawings', wrapSection('drawings', '<w:p><w:r><w:t>late markups</w:t></w:r></w:p>'))
  const di = ordered.indexOf(SECTION_DEFS.drawings.bookmark)
  const pi = ordered.indexOf(SECTION_DEFS.photos.bookmark)
  console.log('   markups inserted after photos still sit before them:', di >= 0 && pi >= 0 && di < pi)

  fs.writeFileSync(path.join(process.cwd(), 'scripts', '.check-output.docx'), regrafted)
  console.log('\nWrote scripts/.check-output.docx for manual opening if wanted.')
}

main().catch(err => { console.error(err); process.exit(1) })
