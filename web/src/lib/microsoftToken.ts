import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL
    ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type MicrosoftTokenRow = {
  id: string
  firm_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  connected_email: string
  onedrive_folder_id: string | null
}

export async function getValidToken(
  firmId: string
): Promise<string | null> {

  const { data: tokenRow, error } = await supabase
    .from('microsoft_tokens')
    .select('*')
    .eq('firm_id', firmId)
    .single()

  if (error || !tokenRow) {
    console.error('No token found for firm:', firmId)
    return null
  }

  // Check if token expires in next 5 minutes
  const expiresAt = new Date(tokenRow.expires_at)
  const fiveMinutesFromNow = new Date(
    Date.now() + 5 * 60 * 1000
  )

  if (expiresAt > fiveMinutesFromNow) {
    // Token still valid
    return tokenRow.access_token
  }

  // Token expired — refresh it
  console.log('Refreshing Microsoft token for firm:', firmId)

  try {
    const res = await fetch(
      'https://login.microsoftonline.com/common' +
      '/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id:
            process.env.MICROSOFT_CLIENT_ID!,
          client_secret:
            process.env.MICROSOFT_CLIENT_SECRET!,
          refresh_token: tokenRow.refresh_token,
          grant_type:    'refresh_token',
          scope: [
            'offline_access',
            'User.Read',
            'Files.ReadWrite.All',
            'Sites.ReadWrite.All',
          ].join(' '),
        }),
      }
    )

    if (!res.ok) {
      console.error('Token refresh failed:',
        await res.text())
      return null
    }

    const newTokens = await res.json()
    const newExpiresAt = new Date(
      Date.now() + (newTokens.expires_in * 1000)
    ).toISOString()

    // Save refreshed token
    await supabase
      .from('microsoft_tokens')
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token
          ?? tokenRow.refresh_token,
        expires_at:   newExpiresAt,
        updated_at:   new Date().toISOString(),
      })
      .eq('firm_id', firmId)

    return newTokens.access_token

  } catch (err) {
    console.error('Token refresh error:', err)
    return null
  }
}

export async function revokeToken(
  firmId: string
): Promise<void> {
  await supabase
    .from('microsoft_tokens')
    .delete()
    .eq('firm_id', firmId)
}

export async function getTokenInfo(
  firmId: string
): Promise<MicrosoftTokenRow | null> {
  const { data, error } = await supabase
    .from('microsoft_tokens')
    .select('*')
    .eq('firm_id', firmId)
    .single()

  if (error || !data) return null
  return data as MicrosoftTokenRow
}
