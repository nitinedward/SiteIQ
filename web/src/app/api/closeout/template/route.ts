import { NextRequest, NextResponse } from 'next/server'
import { requireCaller } from '@/lib/apiAuth'
import { admin, BUCKET, download, ownsPath } from '@/lib/closeoutServer'
import { checkCloseoutTemplate, starterTemplate } from '@/lib/closeoutTemplates'
import { CLOSEOUT_PLACEHOLDERS, CLOSEOUT_TEMPLATE_KINDS, type CloseoutTemplateKind, type FirmPs4Settings } from '@/lib/closeout'

export const dynamic = 'force-dynamic'

/**
 * A firm's Word layouts for close-out pages (lib/closeoutTemplates).
 *
 *  GET ?kind=…            the starter template, laid out like SiteIQ's own
 *                         page with every placeholder in place
 *  POST { kind, path }    records a newly uploaded template, once it's been
 *                         checked; replaces the one before
 *  DELETE { kind }        back to SiteIQ's own page
 *
 * Admins only.
 */

const isKind = (k: unknown): k is CloseoutTemplateKind => (CLOSEOUT_TEMPLATE_KINDS as readonly unknown[]).includes(k)

async function adminCaller(request: NextRequest) {
  const access = await requireCaller(request)
  if (!access.ok) return access
  if (access.caller.role !== 'admin') return { ok: false as const, response: NextResponse.json({ error: 'Only a firm admin can do this' }, { status: 403 }) }
  return access
}

async function readSettings(firmId: string): Promise<FirmPs4Settings> {
  const { data, error } = await admin().from('firms').select('ps4_settings').eq('id', firmId).single()
  if (error) throw new Error(/ps4_settings/.test(error.message) ? 'Run web/sql/closeout.sql in Supabase first.' : error.message)
  return (data?.ps4_settings ?? {}) as FirmPs4Settings
}

export async function GET(request: NextRequest) {
  const access = await adminCaller(request)
  if (!access.ok) return access.response
  const kind = request.nextUrl.searchParams.get('kind')
  if (!isKind(kind)) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
  const bytes = await starterTemplate(kind)
  const name = `SiteIQ starter - ${CLOSEOUT_PLACEHOLDERS[kind].title}.docx`
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const access = await adminCaller(request)
    if (!access.ok) return access.response
    const firmId = access.caller.firmId
    const { kind, path, fileName } = await request.json()
    if (!isKind(kind)) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
    if (!ownsPath(firmId, path) || !path.startsWith(`closeout/${firmId}/templates/${kind}-`)) {
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })
    }

    const supabase = admin()
    const check = checkCloseoutTemplate(await download(path).catch(() => Buffer.alloc(0)), kind)
    if (!check.ok) {
      await supabase.storage.from(BUCKET).remove([path])
      return NextResponse.json({ error: check.error }, { status: 422 })
    }
    const loop = CLOSEOUT_PLACEHOLDERS[kind].loop
    if (!check.usedLoop) {
      await supabase.storage.from(BUCKET).remove([path])
      return NextResponse.json({ error: `The template has no {{#${loop}}} … {{/${loop}}} row, so it would list no ${loop}. Start from the starter template.` }, { status: 422 })
    }

    const previous = await readSettings(firmId)
    const old = previous.templates?.[kind]
    const settings: FirmPs4Settings = {
      ...previous,
      templates: {
        ...previous.templates,
        [kind]: { path, name: String(fileName ?? `${kind}.docx`).slice(0, 200), uploadedAt: new Date().toISOString(), unknown: check.unknown },
      },
    }
    const { error } = await supabase.from('firms').update({ ps4_settings: settings }).eq('id', firmId)
    if (error) throw new Error(error.message)
    if (old?.path && old.path !== path && ownsPath(firmId, old.path)) await supabase.storage.from(BUCKET).remove([old.path])
    return NextResponse.json({ settings })
  } catch (err: any) {
    console.error('[closeout/template] failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not save the template' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await adminCaller(request)
    if (!access.ok) return access.response
    const firmId = access.caller.firmId
    const { kind } = await request.json()
    if (!isKind(kind)) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
    const previous = await readSettings(firmId)
    const old = previous.templates?.[kind]
    const templates = { ...previous.templates }
    delete templates[kind]
    const settings: FirmPs4Settings = { ...previous, templates }
    const { error } = await admin().from('firms').update({ ps4_settings: settings }).eq('id', firmId)
    if (error) throw new Error(error.message)
    if (old?.path && ownsPath(firmId, old.path)) await admin().storage.from(BUCKET).remove([old.path])
    return NextResponse.json({ settings })
  } catch (err: any) {
    console.error('[closeout/template] remove failed:', err)
    return NextResponse.json({ error: err?.message ?? 'Could not remove the template' }, { status: 500 })
  }
}
