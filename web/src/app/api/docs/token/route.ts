import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()

    const secret = process.env.ONLYOFFICE_JWT_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'JWT secret not configured' }, { status: 500 })
    }

    const token = jwt.sign(payload, secret, { expiresIn: '1d' })

    return NextResponse.json({ token })
  } catch (err) {
    console.error('[docs/token] error:', err)
    return NextResponse.json({ error: 'Token generation failed' }, { status: 500 })
  }
}
