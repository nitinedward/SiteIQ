import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const state = searchParams.get('state') ?? ''

  const clientId = process.env.MICROSOFT_CLIENT_ID!
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI
    ?? 'http://localhost:3000/api/auth/callback'

  const scopes = [
    'offline_access',
    'User.Read',
    'Files.ReadWrite.All',
    'Sites.ReadWrite.All',
  ].join(' ')

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    response_mode: 'query',
    scope:         scopes,
    state:         state,
    prompt:        'select_account',
  })

  const authUrl =
    'https://login.microsoftonline.com/common' +
    '/oauth2/v2.0/authorize?' +
    params.toString()

  return NextResponse.redirect(authUrl)
}
