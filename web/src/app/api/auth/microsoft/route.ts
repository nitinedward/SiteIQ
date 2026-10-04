import { NextRequest, NextResponse } from 'next/server'
import { requireFirmAccess } from '@/lib/apiAuth'
import { signOAuthState } from '@/lib/oauthState'

/**
 * Starts linking a firm's Microsoft 365 account: returns the Microsoft
 * sign-in address for the Settings page to go to.
 *
 * Only an admin of the firm gets one, and its `state` is signed (see
 * lib/oauthState), so the callback can't be talked into linking an account
 * to a firm the person doesn't run. It used to be a GET taking the firm id
 * as `state`, which anyone could forge.
 */
export async function POST(request: NextRequest) {
  const { firmId } = await request.json().catch(() => ({}))
  const access = await requireFirmAccess(request, firmId, { admin: true })
  if (!access.ok) return access.response

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
    state:         signOAuthState(firmId, access.caller.userId),
    prompt:        'select_account',
  })

  return NextResponse.json({
    url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + params.toString(),
  })
}
