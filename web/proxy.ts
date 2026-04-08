import { createHmac } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Next.js proxy — validates bearer token and origin on all API routes.
 *
 * The GSD_WEB_AUTH_TOKEN env var is set at server launch. Every /api/* request
 * must carry a matching `Authorization: Bearer <token>` header. EventSource
 * (SSE) connections may use the `_token` query parameter instead since the
 * EventSource API cannot set custom headers.
 *
 * In tunnel mode, the token is a JWT with 24h expiry. The middleware verifies
 * the JWT signature and expiration using the shared secret in GSD_WEB_JWT_SECRET.
 * Uses Node.js built-in crypto to avoid adding jose as a web dependency.
 *
 * Additionally, if an `Origin` header is present, it must match the expected
 * localhost origin to prevent cross-site request forgery.
 */

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url")
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64url")
}

/** Check if a token looks like a JWT (three base64url segments). */
function isJwtToken(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
}

/** Verify JWT token signature and expiry using Node.js built-in crypto. */
function verifyJwt(token: string): boolean {
  const secretHex = process.env.GSD_WEB_JWT_SECRET
  if (!secretHex) return false

  try {
    const parts = token.split(".")
    if (parts.length !== 3) return false
    const [headerB64, payloadB64, signatureB64] = parts

    // Verify signature
    const secret = Buffer.from(secretHex, "hex")
    const signInput = `${headerB64}.${payloadB64}`
    const expectedSig = base64urlEncode(
      createHmac("sha256", secret).update(signInput).digest()
    )
    if (expectedSig !== signatureB64) return false

    // Check expiry
    const payload = JSON.parse(base64urlDecode(payloadB64!).toString("utf8"))
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return false
    }

    return true
  } catch {
    return false
  }
}

export function proxy(request: NextRequest): NextResponse | undefined {
  const { pathname } = request.nextUrl

  // Only gate API routes
  if (!pathname.startsWith("/api/")) return NextResponse.next()

  const expectedToken = process.env.GSD_WEB_AUTH_TOKEN
  if (!expectedToken) {
    // If no token was configured (e.g. dev mode without launch harness),
    // allow everything — the server didn't opt into auth.
    return NextResponse.next()
  }

  // ── Origin / CORS check ────────────────────────────────────────────
  const origin = request.headers.get("origin")
  if (origin) {
    const host = process.env.GSD_WEB_HOST || "127.0.0.1"
    const port = process.env.GSD_WEB_PORT || "3000"

    // Default: localhost origin for the launched host:port
    const allowed = new Set([`http://${host}:${port}`])

    // GSD_WEB_ALLOWED_ORIGINS lets users whitelist additional origins for
    // secure tunnel setups (Tailscale Serve, Cloudflare Tunnel, ngrok, etc.)
    const extra = process.env.GSD_WEB_ALLOWED_ORIGINS
    if (extra) {
      for (const entry of extra.split(",")) {
        const trimmed = entry.trim()
        if (trimmed) allowed.add(trimmed)
      }
    }

    if (!allowed.has(origin)) {
      // In tunnel mode, allow any trycloudflare.com origin (the URL is dynamic)
      const isTunnelOrigin = process.env.GSD_WEB_JWT_SECRET && origin.endsWith(".trycloudflare.com")
      if (!isTunnelOrigin) {
        return NextResponse.json(
          { error: "Forbidden: origin mismatch" },
          { status: 403 },
        )
      }
    }
  }

  // ── Bearer token check ─────────────────────────────────────────────
  let token: string | null = null

  // 1. Authorization header (preferred)
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7)
  }

  // 2. Query parameter fallback for EventSource / SSE
  if (!token) {
    token = request.nextUrl.searchParams.get("_token")
  }

  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    )
  }

  // ── JWT verification (tunnel mode) ─────────────────────────────────
  if (isJwtToken(token)) {
    const valid = verifyJwt(token)
    if (!valid) {
      return NextResponse.json(
        { error: "Token expired or invalid" },
        { status: 401 },
      )
    }
    return NextResponse.next()
  }

  // ── Static token comparison (local mode) ───────────────────────────
  if (token !== expectedToken) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: "/api/:path*",
}
