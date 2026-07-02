import { NextRequest, NextResponse } from 'next/server'
import { getValidToken } from '@/lib/microsoftToken'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL
    ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  (process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? '').replace(/^﻿/, '').trim()
)

type UploadResult = {
  fileId: string
  webUrl: string
  editUrl: string
}

// Encode each path segment individually so slashes stay as separators
function encodePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/')
}

async function getEditLink(
  accessToken: string,
  itemEndpoint: string, // e.g. /sites/{id}/drive/items/{fileId}
  webUrl: string,
): Promise<string> {
  const linkRes = await fetch(
    `https://graph.microsoft.com/v1.0${itemEndpoint}/createLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'edit', scope: 'organization' }),
    }
  )
  if (!linkRes.ok) return webUrl
  const linkData = await linkRes.json()
  return linkData.link?.webUrl ?? webUrl
}

async function uploadToSharePoint(
  accessToken: string,
  filePath: string,
  fileBuffer: ArrayBuffer,
): Promise<UploadResult | null> {
  // Step 1: Get root SharePoint site
  const siteRes = await fetch(
    'https://graph.microsoft.com/v1.0/sites/root',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!siteRes.ok) {
    console.error('SharePoint site fetch failed:',
      siteRes.status, await siteRes.text())
    return null
  }

  const siteData = await siteRes.json()
  const siteId   = siteData.id
  console.log('[upload] Using SharePoint site:', siteId)

  // Step 2: Upload to SharePoint drive
  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}` +
    `/drive/root:/${encodePath(filePath)}:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type':
          'application/vnd.openxmlformats-' +
          'officedocument.wordprocessingml.document',
      },
      body: fileBuffer,
    }
  )

  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    console.error('SharePoint upload failed:', uploadRes.status, errText)
    return null
  }

  const uploaded = await uploadRes.json()
  const fileId   = uploaded.id
  const webUrl   = uploaded.webUrl

  const editUrl = await getEditLink(
    accessToken,
    `/sites/${siteId}/drive/items/${fileId}`,
    webUrl,
  )

  console.log('[upload] SharePoint succeeded, editUrl:', editUrl)
  return { fileId, webUrl, editUrl }
}

async function uploadToPersonalDrive(
  accessToken: string,
  filePath: string,
  fileBuffer: ArrayBuffer,
): Promise<UploadResult | null> {
  console.log('[upload] Trying me/drive fallback...')

  const uploadRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:` +
    `/${encodePath(filePath)}:/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type':
          'application/vnd.openxmlformats-' +
          'officedocument.wordprocessingml.document',
      },
      body: fileBuffer,
    }
  )

  if (!uploadRes.ok) {
    const errText = await uploadRes.text()
    console.error('Personal drive upload also failed:',
      uploadRes.status, errText)
    return null
  }

  const uploaded = await uploadRes.json()
  const fileId   = uploaded.id
  const webUrl   = uploaded.webUrl

  const editUrl = await getEditLink(
    accessToken,
    `/me/drive/items/${fileId}`,
    webUrl,
  )

  console.log('[upload] me/drive succeeded, editUrl:', editUrl)
  return { fileId, webUrl, editUrl }
}

export async function POST(request: NextRequest) {
  try {
    const formData     = await request.formData()
    const file         = formData.get('file') as Blob
    const firmId       = formData.get('firmId') as string
    const fileName     = formData.get('fileName') as string
    const inspectionId = formData.get('inspectionId') as string
    const projectName  = formData.get('projectName') as string

    if (!file || !firmId || !fileName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const accessToken = await getValidToken(firmId)
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Microsoft 365 not connected' },
        { status: 401 }
      )
    }

    const safeProjName = (projectName ?? 'General')
      .replace(/[^a-zA-Z0-9 \-_]/g, '')
      .trim()
    const filePath  = `SiteIQ Reports/${safeProjName}/${fileName}`
    const fileBuffer = await file.arrayBuffer()

    // Try SharePoint first, fall back to personal drive
    let result = await uploadToSharePoint(accessToken, filePath, fileBuffer)
    if (!result) {
      result = await uploadToPersonalDrive(accessToken, filePath, fileBuffer)
    }

    if (!result) {
      return NextResponse.json(
        { error: 'Upload failed on both SharePoint and personal drive' },
        { status: 500 }
      )
    }

    const { fileId, webUrl, editUrl } = result

    // Save to inspection record
    if (inspectionId) {
      await supabase
        .from('inspections')
        .update({
          onedrive_url:     editUrl,
          onedrive_file_id: fileId,
        })
        .eq('id', inspectionId)
    }

    return NextResponse.json({
      success: true,
      fileId,
      webUrl,
      editUrl,
      fileName,
    })

  } catch (err) {
    console.error('OneDrive upload route error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
