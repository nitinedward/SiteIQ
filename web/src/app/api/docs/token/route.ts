import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null,
    { status: 200, headers: cors })
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    const secret = process.env.ONLYOFFICE_JWT_SECRET

    if (!secret) {
      console.error('ONLYOFFICE_JWT_SECRET is not set')
      return NextResponse.json(
        { error: 'JWT secret not configured' },
        { status: 500, headers: cors }
      )
    }

    console.log(
      '[token] secret length:', secret.length,
      '| first 4 chars:', secret.substring(0, 4)
    )

    const token = jwt.sign(payload, secret, {
      algorithm: 'HS256',
    })

    console.log('[token] generated, length:', token.length)

    return NextResponse.json(
      { token },
      { headers: cors }
    )

  } catch (err: any) {
    console.error('[token] error:', err.message)
    return NextResponse.json(
      { error: err.message },
      { status: 500, headers: cors }
    )
  }
}
