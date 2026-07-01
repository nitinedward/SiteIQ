import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? 'https://vbaewualqaxhbmqgnhdt.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
      ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiYWV3dWFscWF4aGJtcWduaGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzAzNjMsImV4cCI6MjA5MzQ0NjM2M30.8s39SZtGq4r_0NXYhsAU0WdPSGqLfefm2YYK_JXjZbg'
  )
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state') // firm_id
  const error = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? 'http://localhost:3000'
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI
    ?? 'http://localhost:3000/api/auth/callback'

  if (error) {
    console.error('Microsoft OAuth error:', error)
    return NextResponse.redirect(
      `${appUrl}/settings?ms=error&reason=${error}`
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${appUrl}/settings?ms=error&reason=missing_params`
    )
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(
      'https://login.microsoftonline.com/common' +
      '/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id:     process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          code,
          redirect_uri:  redirectUri,
          grant_type:    'authorization_code',
        }),
      }
    )

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('Token exchange failed:', {
        status: tokenRes.status,
        statusText: tokenRes.statusText,
        body: errText,
      })
      // Pass the actual error back in URL for debugging
      const errEncoded = encodeURIComponent(
        errText.slice(0, 200))
      return NextResponse.redirect(
        `${appUrl}/settings?ms=error&reason=token_exchange` +
        `&detail=${errEncoded}`
      )
    }

    const tokens = await tokenRes.json()
    const {
      access_token,
      refresh_token,
      expires_in,
    } = tokens

    // Get Microsoft user profile
    const profileRes = await fetch(
      'https://graph.microsoft.com/v1.0/me',
      {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      }
    )
    const profile = await profileRes.json()
    const connectedEmail = profile.mail
      ?? profile.userPrincipalName
      ?? ''

    // Calculate expiry
    const expiresAt = new Date(
      Date.now() + (expires_in * 1000)
    ).toISOString()

    // Save to microsoft_tokens table
    // state = firm_id passed from settings page
    const { error: dbError } = await getSupabase()
      .from('microsoft_tokens')
      .upsert({
        firm_id:         state,
        access_token,
        refresh_token,
        expires_at:      expiresAt,
        connected_email: connectedEmail,
        updated_at:      new Date().toISOString(),
      }, {
        onConflict: 'firm_id'
      })

    if (dbError) {
      console.error('DB save error:', dbError)
      return NextResponse.redirect(
        `${appUrl}/settings?ms=error&reason=db_save`
      )
    }

    return NextResponse.redirect(
      `${appUrl}/settings?ms=connected`
    )

  } catch (err) {
    console.error('OAuth callback error:', err)
    return NextResponse.redirect(
      `${appUrl}/settings?ms=error&reason=unknown`
    )
  }
}
