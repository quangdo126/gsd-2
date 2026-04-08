import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

type WritableLike = Pick<typeof process.stderr, 'write'>

const TOKEN_EXPIRY = '24h'
const JWT_SECRET_BYTES = 32

export interface TunnelInfo {
  tunnelUrl: string
  authenticatedUrl: string
  process: ChildProcess
}

export interface TunnelServiceDeps {
  stderr?: WritableLike
}

let jwtSecretKey: Uint8Array | null = null

/** Get or create the JWT signing key for this server session. */
function getJwtSecret(): Uint8Array {
  if (!jwtSecretKey) {
    jwtSecretKey = randomBytes(JWT_SECRET_BYTES)
  }
  return jwtSecretKey
}

/** Reset JWT secret (for testing). */
export function resetJwtSecret(): void {
  jwtSecretKey = null
}

export interface TunnelJwtResult {
  token: string
  /** Hex-encoded secret for sharing with the Next.js host process. */
  secretHex: string
}

/** Generate a JWT token with 24h expiry for tunnel mode. Returns both token and secret. */
export async function generateTunnelJwt(): Promise<TunnelJwtResult> {
  const secret = getJwtSecret()
  const token = await new SignJWT({ purpose: 'gsd-web-tunnel' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(secret)
  return { token, secretHex: Buffer.from(secret).toString('hex') }
}

/** Verify a JWT token. Returns the payload if valid, null if expired or invalid. */
export async function verifyTunnelJwt(token: string): Promise<JWTPayload | null> {
  try {
    const secret = getJwtSecret()
    const { payload } = await jwtVerify(token, secret)
    return payload
  } catch {
    return null
  }
}

/** Check if a token looks like a JWT (three base64url segments). */
export function isJwtToken(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
}

/** Detect if `cloudflared` is available on PATH. */
export async function detectCloudflared(): Promise<string | null> {
  const command = process.platform === 'win32' ? 'where' : 'which'
  return await new Promise((resolve) => {
    execFile(command, ['cloudflared'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const path = stdout.trim().split('\n')[0]?.trim()
      resolve(path || null)
    })
  })
}

/**
 * Parse the tunnel URL from cloudflared stderr output.
 * cloudflared prints a line like:
 *   INF +---------------------------------------------------+
 *   INF |  https://some-random-words.trycloudflare.com       |
 *   INF +---------------------------------------------------+
 * or:
 *   INF | https://some-random-words.trycloudflare.com  |
 */
function parseTunnelUrl(data: string): string | null {
  const match = data.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  return match ? match[0] : null
}

/** Generate and print a QR code in the terminal. */
async function printQrCode(url: string, stderr: WritableLike): Promise<void> {
  try {
    // qrcode-terminal is CJS; use createRequire for reliable interop
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const qrcode = require('qrcode-terminal') as { generate: (text: string, opts: { small: boolean }, cb: (qr: string) => void) => void }
    qrcode.generate(url, { small: true }, (qr: string) => {
      stderr.write('\n')
      stderr.write(qr)
      stderr.write('\n')
    })
  } catch {
    stderr.write('[gsd] Could not generate QR code (qrcode-terminal not available)\n')
  }
}

/**
 * Start a Cloudflare quick tunnel pointing at the local web server.
 * Returns the tunnel URL and the child process handle for cleanup.
 */
export async function startTunnel(
  localUrl: string,
  authToken: string,
  deps: TunnelServiceDeps = {},
): Promise<TunnelInfo> {
  const stderr = deps.stderr ?? process.stderr

  const cloudflaredPath = await detectCloudflared()
  if (!cloudflaredPath) {
    throw new Error(
      'cloudflared is not installed.\n' +
      'Install it from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n' +
      '  - Windows:  winget install cloudflare.cloudflared\n' +
      '  - macOS:    brew install cloudflared\n' +
      '  - Linux:    See https://pkg.cloudflare.com/',
    )
  }

  stderr.write('[gsd] Starting Cloudflare Tunnel…\n')

  const child = spawn(cloudflaredPath, ['tunnel', '--url', localUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const tunnelUrl = await new Promise<string>((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for cloudflared tunnel URL (30s)'))
    }, 30_000)

    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      const url = parseTunnelUrl(output)
      if (url) {
        clearTimeout(timeout)
        child.stderr?.removeListener('data', onData)
        child.stdout?.removeListener('data', onData)
        resolve(url)
      }
    }

    child.stderr?.on('data', onData)
    child.stdout?.on('data', onData)

    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(new Error(`cloudflared failed to start: ${error.message}`))
    })

    child.once('close', (code) => {
      clearTimeout(timeout)
      if (code !== null && code !== 0) {
        reject(new Error(`cloudflared exited with code ${code}`))
      }
    })
  })

  const authenticatedUrl = `${tunnelUrl}/#token=${authToken}`

  stderr.write(`[gsd] Tunnel ready → ${tunnelUrl}\n`)
  stderr.write(`[gsd] Authenticated URL → ${authenticatedUrl}\n`)
  stderr.write('\n[gsd] Scan QR code to access from any device:\n')
  await printQrCode(authenticatedUrl, stderr)
  stderr.write(`[gsd] Token expires in 24 hours. Restart to get a new token.\n`)

  return {
    tunnelUrl,
    authenticatedUrl,
    process: child as ChildProcess,
  }
}

/** Stop the tunnel process gracefully. */
export function stopTunnel(tunnelProcess: ChildProcess): void {
  if (tunnelProcess.killed) return
  try {
    tunnelProcess.kill('SIGTERM')
  } catch {
    // Process may already be dead
  }
}
