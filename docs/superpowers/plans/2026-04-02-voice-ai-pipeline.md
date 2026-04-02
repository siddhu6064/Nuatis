# Voice AI WebSocket Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real-time Voice AI WebSocket pipeline connecting inbound Telnyx phone calls to Gemini Live sessions with bidirectional PCMU ↔ PCM16 audio transcoding.

**Architecture:** The existing `app.listen()` in `index.ts` is replaced with `http.createServer(app)` so the same port (3001) handles both HTTP and WebSocket upgrades. A `ws.Server` at `/voice/stream` receives Telnyx call audio, transcodes PCMU 8 kHz → PCM 16 kHz, streams to a Gemini Live session, and pipes audio responses back to Telnyx after downsampling. Three focused modules keep concerns separated: `gemini-live.ts` (Gemini session), `telnyx-handler.ts` (WebSocket + transcoding), `call-logger.ts` (structured logging).

**Tech Stack:** `@google/genai` (Gemini Live), `ws` (WebSocket server), `alawmulaw` (pure-JS µ-law codec), Node.js `http.createServer`, TypeScript ESM with NodeNext resolution

---

## File Map

| Action | Path                                   | Responsibility                                   |
| ------ | -------------------------------------- | ------------------------------------------------ |
| Create | `apps/api/src/voice/call-logger.ts`    | Structured call logging; DB stub                 |
| Create | `apps/api/src/voice/gemini-live.ts`    | Gemini Live session wrapper                      |
| Create | `apps/api/src/voice/telnyx-handler.ts` | WebSocket server + audio bridge + transcoding    |
| Create | `apps/api/src/voice/test-gemini.ts`    | Dev smoke-test script                            |
| Create | `apps/api/src/voice/alawmulaw.d.ts`    | TypeScript type declaration for alawmulaw        |
| Modify | `apps/api/src/index.ts`                | Switch to http.createServer, register WS handler |
| Modify | `apps/api/package.json`                | Add runtime deps + @types/ws devDep              |

---

## Task 1: Install packages

**Files:**

- Modify: `apps/api/package.json`

- [ ] **Step 1: Install runtime dependencies**

```bash
npm install @google/genai ws alawmulaw --workspace=apps/api
```

Expected: packages added to `apps/api/node_modules` and listed in `apps/api/package.json` dependencies.

- [ ] **Step 2: Install type declarations**

```bash
npm install -D @types/ws --workspace=apps/api
```

Expected: `@types/ws` appears in `apps/api/package.json` devDependencies.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json package-lock.json
git commit -m "chore: add voice AI packages (@google/genai, ws, alawmulaw)"
```

---

## Task 2: Type declaration for alawmulaw

`alawmulaw` ships without TypeScript definitions. Create a local declaration so TypeScript is happy.

**Files:**

- Create: `apps/api/src/voice/alawmulaw.d.ts`

- [ ] **Step 1: Create the declaration file**

Create `apps/api/src/voice/alawmulaw.d.ts`:

```typescript
declare module 'alawmulaw' {
  export const mulaw: {
    /** Decode µ-law encoded bytes to 16-bit linear PCM samples */
    decode(samples: Uint8Array | Buffer): Int16Array
    /** Encode 16-bit linear PCM samples to µ-law bytes */
    encode(samples: Int16Array): Uint8Array
  }
  export const alaw: {
    decode(samples: Uint8Array | Buffer): Int16Array
    encode(samples: Int16Array): Uint8Array
  }
}
```

- [ ] **Step 2: Verify TypeScript accepts it**

```bash
npx tsc --noEmit --project apps/api/tsconfig.json
```

Expected: no errors about `alawmulaw`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/voice/alawmulaw.d.ts
git commit -m "chore: add TypeScript declaration for alawmulaw"
```

---

## Task 3: call-logger.ts

**Files:**

- Create: `apps/api/src/voice/call-logger.ts`
- Test: `apps/api/src/voice/call-logger.test.ts` (but this project uses jest in `src/` — place alongside the file)

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/voice/call-logger.test.ts`:

```typescript
import { logCall } from './call-logger.js'

describe('logCall', () => {
  it('logs call details to console', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {})

    logCall({
      tenant_id: 'tenant-abc',
      duration_seconds: 42,
      language: 'en',
      timestamp: new Date('2026-04-02T10:00:00Z'),
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const logged = spy.mock.calls[0]?.[0] as string
    expect(logged).toContain('tenant-abc')
    expect(logged).toContain('42')
    expect(logged).toContain('en')

    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test --workspace=apps/api -- --testPathPattern=call-logger
```

Expected: FAIL — `Cannot find module './call-logger.js'`

- [ ] **Step 3: Implement call-logger.ts**

Create `apps/api/src/voice/call-logger.ts`:

```typescript
export interface CallLogEntry {
  tenant_id: string
  duration_seconds: number
  language: string
  timestamp: Date
}

export function logCall(entry: CallLogEntry): void {
  console.info(
    JSON.stringify({
      event: 'call_ended',
      tenant_id: entry.tenant_id,
      duration_seconds: entry.duration_seconds,
      language: entry.language,
      timestamp: entry.timestamp.toISOString(),
    })
  )
  // TODO: write to calls table (next task)
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test --workspace=apps/api -- --testPathPattern=call-logger
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/voice/call-logger.ts apps/api/src/voice/call-logger.test.ts
git commit -m "feat: add call-logger with console logging and DB stub"
```

---

## Task 4: Audio transcoding utilities

These are pure functions exported from `telnyx-handler.ts`. Test them independently before wiring up the WebSocket.

**Files:**

- Create: `apps/api/src/voice/telnyx-handler.ts` (transcoding exports only for now)
- Test: `apps/api/src/voice/telnyx-handler.test.ts`

- [ ] **Step 1: Write failing tests for transcoding**

Create `apps/api/src/voice/telnyx-handler.test.ts`:

```typescript
import { pcmuToLinear16, linear16ToPcmu } from './telnyx-handler.js'

describe('pcmuToLinear16', () => {
  it('converts a PCMU buffer to a PCM16 buffer at double the sample count', () => {
    // 10-byte PCMU input → 20 PCM samples → 40 bytes of PCM16
    const pcmu = Buffer.alloc(10, 0xff) // 0xff = µ-law silence
    const pcm16 = pcmuToLinear16(pcmu)
    expect(pcm16.byteLength).toBe(40)
  })

  it('returns a Buffer', () => {
    const pcm16 = pcmuToLinear16(Buffer.alloc(8, 0xff))
    expect(Buffer.isBuffer(pcm16)).toBe(true)
  })
})

describe('linear16ToPcmu', () => {
  it('converts a PCM16 buffer to a PCMU buffer at half the sample count', () => {
    // 40 bytes (20 samples) of PCM16 → 10 PCMU bytes
    const pcm16 = Buffer.alloc(40, 0)
    const pcmu = linear16ToPcmu(pcm16)
    expect(pcmu.byteLength).toBe(10)
  })

  it('returns a Buffer', () => {
    const pcmu = linear16ToPcmu(Buffer.alloc(16, 0))
    expect(Buffer.isBuffer(pcmu)).toBe(true)
  })

  it('round-trips silence without error', () => {
    const originalPcmu = Buffer.alloc(10, 0xff)
    const pcm16 = pcmuToLinear16(originalPcmu)
    const roundTripped = linear16ToPcmu(pcm16)
    expect(roundTripped.byteLength).toBe(originalPcmu.byteLength)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test --workspace=apps/api -- --testPathPattern=telnyx-handler
```

Expected: FAIL — `Cannot find module './telnyx-handler.js'`

- [ ] **Step 3: Create telnyx-handler.ts with transcoding exports only**

Create `apps/api/src/voice/telnyx-handler.ts`:

```typescript
import { mulaw } from 'alawmulaw'
import type { WebSocketServer } from 'ws'

// ── Audio transcoding ─────────────────────────────────────────────────────────

/**
 * Telnyx → Gemini
 * Decodes µ-law PCMU (8 kHz) to linear PCM 16-bit (16 kHz) by decoding
 * then duplicating each sample to upsample from 8 kHz to 16 kHz.
 */
export function pcmuToLinear16(pcmuBuffer: Buffer): Buffer {
  const samples8k = mulaw.decode(pcmuBuffer) // Int16Array at 8 kHz
  const samples16k = new Int16Array(samples8k.length * 2)
  for (let i = 0; i < samples8k.length; i++) {
    samples16k[i * 2] = samples8k[i]!
    samples16k[i * 2 + 1] = samples8k[i]!
  }
  return Buffer.from(samples16k.buffer)
}

/**
 * Gemini → Telnyx
 * Converts linear PCM 16-bit (16 kHz) to µ-law PCMU (8 kHz) by
 * taking every other sample (naive downsample) then µ-law encoding.
 */
export function linear16ToPcmu(pcm16Buffer: Buffer): Buffer {
  const samples16k = new Int16Array(
    pcm16Buffer.buffer,
    pcm16Buffer.byteOffset,
    Math.floor(pcm16Buffer.byteLength / 2)
  )
  const samples8k = new Int16Array(Math.floor(samples16k.length / 2))
  for (let i = 0; i < samples8k.length; i++) {
    samples8k[i] = samples16k[i * 2]!
  }
  return Buffer.from(mulaw.encode(samples8k))
}

// ── Tenant lookup ─────────────────────────────────────────────────────────────

/**
 * Parse TELNYX_TENANT_MAP env var.
 * Format: "+15127376388:tenant-uuid,+18005551234:other-uuid"
 */
export function parseTenantMap(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of raw.split(',')) {
    const [phone, tenantId] = entry.trim().split(':')
    if (phone && tenantId) map.set(phone.trim(), tenantId.trim())
  }
  return map
}

export function lookupTenant(toNumber: string, tenantMap: Map<string, string>): string | undefined {
  return tenantMap.get(toNumber)
}

// ── WebSocket handler (registered in index.ts) ────────────────────────────────

export function registerVoiceWebSocket(_wss: WebSocketServer): void {
  // Implemented in Task 6
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test --workspace=apps/api -- --testPathPattern=telnyx-handler
```

Expected: PASS (transcoding + round-trip tests pass)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/voice/telnyx-handler.ts apps/api/src/voice/telnyx-handler.test.ts
git commit -m "feat: add audio transcoding utilities (PCMU 8kHz ↔ PCM16 16kHz)"
```

---

## Task 5: gemini-live.ts

**Files:**

- Create: `apps/api/src/voice/gemini-live.ts`

No unit test here — the external Gemini API makes reliable mocking fragile and the smoke test in Task 7 serves as integration validation. Implement and rely on `test-gemini.ts` for verification.

- [ ] **Step 1: Create gemini-live.ts**

Create `apps/api/src/voice/gemini-live.ts`:

```typescript
import { GoogleGenAI } from '@google/genai'
import { VERTICALS } from '@nuatis/shared'

const DEFAULT_SYSTEM_PROMPT =
  'You are Maya, a friendly bilingual AI receptionist. You speak English and Spanish fluently. ' +
  'Always respond in the same language the caller uses. You help callers book appointments, ' +
  'answer questions about the business, and transfer to a human when needed. ' +
  'Be warm, professional, and concise.'

const MODEL = 'gemini-3.1-flash-live-preview'

export interface GeminiLiveSession {
  send(audioChunk: Buffer): void
  onAudio(cb: (chunk: Buffer) => void): void
  sendText(text: string): void
  close(): void
}

function getSystemPrompt(vertical: string): string {
  const config = VERTICALS[vertical]
  return config?.system_prompt_template ?? DEFAULT_SYSTEM_PROMPT
}

export async function createGeminiLiveSession(
  _tenantId: string,
  vertical: string
): Promise<GeminiLiveSession> {
  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const client = new GoogleGenAI({ apiKey })
  const systemPrompt = getSystemPrompt(vertical)

  let audioCallback: ((chunk: Buffer) => void) | null = null

  const session = await client.live.connect({
    model: MODEL,
    config: {
      responseModalities: ['AUDIO'],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    },
    callbacks: {
      onopen: () => {
        console.info('[gemini-live] session opened')
      },
      onmessage: (message: Record<string, unknown>) => {
        // Extract audio from serverContent.modelTurn.parts[].inlineData.data
        const parts = (
          (message['serverContent'] as Record<string, unknown> | undefined)?.['modelTurn'] as
            | Record<string, unknown>
            | undefined
        )?.['parts'] as Array<Record<string, unknown>> | undefined

        if (!parts) return

        for (const part of parts) {
          const inlineData = part['inlineData'] as { data: string; mimeType: string } | undefined
          if (inlineData?.data && audioCallback) {
            audioCallback(Buffer.from(inlineData.data, 'base64'))
          }
        }
      },
      onerror: (e: unknown) => {
        console.error('[gemini-live] error', e)
      },
      onclose: () => {
        console.info('[gemini-live] session closed')
      },
    },
  })

  return {
    send(audioChunk: Buffer): void {
      session.sendRealtimeInput({
        audio: {
          data: audioChunk.toString('base64'),
          mimeType: 'audio/pcm;rate=16000',
        },
      } as Parameters<typeof session.sendRealtimeInput>[0])
    },

    onAudio(cb: (chunk: Buffer) => void): void {
      audioCallback = cb
    },

    sendText(text: string): void {
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
      } as Parameters<typeof session.sendClientContent>[0])
    },

    close(): void {
      session.close()
    },
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit --project apps/api/tsconfig.json
```

Expected: no errors. If the `@google/genai` SDK types differ from what's written (method names or parameter shapes), adjust accordingly — the smoke test in Task 7 will surface runtime issues.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/voice/gemini-live.ts
git commit -m "feat: add Gemini Live session wrapper (gemini-live.ts)"
```

---

## Task 6: Complete telnyx-handler.ts WebSocket logic

Fill in `registerVoiceWebSocket` with the full Telnyx ↔ Gemini bridge.

**Files:**

- Modify: `apps/api/src/voice/telnyx-handler.ts`

- [ ] **Step 1: Replace the stub with full implementation**

Replace the entire contents of `apps/api/src/voice/telnyx-handler.ts` with:

```typescript
import { mulaw } from 'alawmulaw'
import type { WebSocketServer, WebSocket } from 'ws'
import { createGeminiLiveSession } from './gemini-live.js'
import { logCall } from './call-logger.js'

// ── Audio transcoding ─────────────────────────────────────────────────────────

export function pcmuToLinear16(pcmuBuffer: Buffer): Buffer {
  const samples8k = mulaw.decode(pcmuBuffer)
  const samples16k = new Int16Array(samples8k.length * 2)
  for (let i = 0; i < samples8k.length; i++) {
    samples16k[i * 2] = samples8k[i]!
    samples16k[i * 2 + 1] = samples8k[i]!
  }
  return Buffer.from(samples16k.buffer)
}

export function linear16ToPcmu(pcm16Buffer: Buffer): Buffer {
  const samples16k = new Int16Array(
    pcm16Buffer.buffer,
    pcm16Buffer.byteOffset,
    Math.floor(pcm16Buffer.byteLength / 2)
  )
  const samples8k = new Int16Array(Math.floor(samples16k.length / 2))
  for (let i = 0; i < samples8k.length; i++) {
    samples8k[i] = samples16k[i * 2]!
  }
  return Buffer.from(mulaw.encode(samples8k))
}

// ── Tenant lookup ─────────────────────────────────────────────────────────────

export function parseTenantMap(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of raw.split(',')) {
    const [phone, tenantId] = entry.trim().split(':')
    if (phone && tenantId) map.set(phone.trim(), tenantId.trim())
  }
  return map
}

export function lookupTenant(toNumber: string, tenantMap: Map<string, string>): string | undefined {
  return tenantMap.get(toNumber)
}

// ── Telnyx message types ──────────────────────────────────────────────────────

interface TelnyxStartEvent {
  event: 'start'
  start: { call_sid: string; from: string; to: string }
}

interface TelnyxMediaEvent {
  event: 'media'
  media: { track: string; payload: string }
}

interface TelnyxStopEvent {
  event: 'stop'
  stop: { call_sid: string }
}

type TelnyxEvent = TelnyxStartEvent | TelnyxMediaEvent | TelnyxStopEvent

// ── WebSocket handler ─────────────────────────────────────────────────────────

export function registerVoiceWebSocket(wss: WebSocketServer): void {
  const tenantMapRaw = process.env['TELNYX_TENANT_MAP'] ?? ''
  const tenantMap = parseTenantMap(tenantMapRaw)

  wss.on('connection', (ws: WebSocket) => {
    console.info('[telnyx-handler] WebSocket connection opened')

    let geminiSession: Awaited<ReturnType<typeof createGeminiLiveSession>> | null = null
    let tenantId: string | null = null
    let callStartTime: number | null = null

    ws.on('message', (data: Buffer) => {
      let event: TelnyxEvent
      try {
        event = JSON.parse(data.toString()) as TelnyxEvent
      } catch {
        return
      }

      if (event.event === 'start') {
        const toNumber = event.start.to
        tenantId = lookupTenant(toNumber, tenantMap) ?? null

        if (!tenantId) {
          console.warn(
            `[telnyx-handler] No tenant found for number ${toNumber} — using dev fallback`
          )
          tenantId = process.env['VOICE_DEV_TENANT_ID'] ?? 'unknown'
        }

        callStartTime = Date.now()
        console.info(`[telnyx-handler] Call started — tenant: ${tenantId}, to: ${toNumber}`)

        createGeminiLiveSession(tenantId, 'sales_crm')
          .then((session) => {
            geminiSession = session
            session.onAudio((audioChunk: Buffer) => {
              if (ws.readyState !== ws.OPEN) return
              // Gemini → Telnyx: PCM16 16kHz → PCMU 8kHz → base64
              const pcmu = linear16ToPcmu(audioChunk)
              ws.send(
                JSON.stringify({
                  event: 'media',
                  media: { payload: pcmu.toString('base64') },
                })
              )
            })
          })
          .catch((err: unknown) => {
            console.error('[telnyx-handler] Failed to open Gemini session', err)
          })
      } else if (event.event === 'media') {
        if (!geminiSession) return
        if (event.media.track !== 'inbound') return
        // Telnyx → Gemini: base64 PCMU 8kHz → PCM16 16kHz
        const pcmuBuffer = Buffer.from(event.media.payload, 'base64')
        const pcm16 = pcmuToLinear16(pcmuBuffer)
        geminiSession.send(pcm16)
      } else if (event.event === 'stop') {
        handleCallEnd()
      }
    })

    ws.on('close', () => {
      handleCallEnd()
    })

    ws.on('error', (err: Error) => {
      console.error('[telnyx-handler] WebSocket error', err)
      handleCallEnd()
    })

    function handleCallEnd(): void {
      if (!geminiSession) return
      geminiSession.close()
      geminiSession = null

      const duration = callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0
      logCall({
        tenant_id: tenantId ?? 'unknown',
        duration_seconds: duration,
        language: 'unknown', // language detection added in future task
        timestamp: new Date(),
      })
      console.info(`[telnyx-handler] Call ended — duration: ${duration}s`)
    }
  })

  console.info('[telnyx-handler] WebSocket server registered at /voice/stream')
}
```

- [ ] **Step 2: Run existing telnyx-handler tests — expect still PASS**

```bash
npm test --workspace=apps/api -- --testPathPattern=telnyx-handler
```

Expected: PASS (transcoding and tenant lookup tests are unchanged)

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit --project apps/api/tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/voice/telnyx-handler.ts
git commit -m "feat: implement Telnyx WebSocket handler with Gemini audio bridge"
```

---

## Task 7: Register WebSocket server in index.ts

**Files:**

- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Replace app.listen() with http.createServer()**

Replace the entire contents of `apps/api/src/index.ts` with:

```typescript
import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'
import { WebSocketServer } from 'ws'
import tenantsRouter from './routes/tenants.js'
import googleAuthRouter from './routes/google-auth.js'
import appointmentsRouter from './routes/appointments.js'
import { registerVoiceWebSocket } from './voice/telnyx-handler.js'

const app = express()
const PORT = process.env['PORT'] ?? 3001

app.use(helmet())
app.use(
  cors({
    origin:
      process.env['NODE_ENV'] === 'production' ? 'https://nuatis.com' : 'http://localhost:3000',
  })
)
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nuatis-api', timestamp: new Date().toISOString() })
})

app.use('/api/tenants', tenantsRouter)
app.use('/api/auth/google', googleAuthRouter)
app.use('/api/appointments', appointmentsRouter)

app.get('/', (_req, res) => {
  res.json({ message: 'Nuatis API — Phase 1 build in progress' })
})

const server = createServer(app)

const wss = new WebSocketServer({ server, path: '/voice/stream' })
registerVoiceWebSocket(wss)

server.listen(PORT, () => {
  console.info(`Nuatis API running on http://localhost:${PORT}`)
  console.info(`Voice WebSocket listening at ws://localhost:${PORT}/voice/stream`)
})

export default app
```

- [ ] **Step 2: Run full test suite**

```bash
npm test --workspace=apps/api
```

Expected: all existing tests pass. The `index.test.ts` test hits the Express app via supertest (not the WS server), so it should be unaffected.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit --project apps/api/tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Start the dev server and confirm no startup errors**

```bash
npm run dev --workspace=apps/api
```

Expected output (within a few seconds):

```
Nuatis API running on http://localhost:3001
Voice WebSocket listening at ws://localhost:3001/voice/stream
[telnyx-handler] WebSocket server registered at /voice/stream
```

Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat: register Voice WebSocket server at /voice/stream"
```

---

## Task 8: test-gemini.ts smoke test

**Files:**

- Create: `apps/api/src/voice/test-gemini.ts`

This script is not run by Jest — it's a manual integration smoke test.

- [ ] **Step 1: Create test-gemini.ts**

Create `apps/api/src/voice/test-gemini.ts`:

```typescript
import 'dotenv/config'
import { createGeminiLiveSession } from './gemini-live.js'

console.info('=== Gemini Live smoke test ===')
console.info('Connecting to Gemini Live...')

const session = await createGeminiLiveSession('test-tenant', 'dental')

let receivedBytes = 0

session.onAudio((chunk) => {
  receivedBytes += chunk.byteLength
  console.info(
    `Audio chunk received: ${chunk.byteLength} bytes (total so far: ${receivedBytes} bytes)`
  )
})

console.info('Sending text turn: "Hello, I\'d like to book an appointment"')
session.sendText("Hello, I'd like to book an appointment")

// Wait up to 10 seconds for audio response
await new Promise<void>((resolve) => {
  const timeout = setTimeout(() => {
    console.warn('Timeout: no audio received within 10 seconds')
    resolve()
  }, 10_000)

  session.onAudio((_chunk) => {
    // First audio chunk received — wait a little more for the full response
    clearTimeout(timeout)
    setTimeout(resolve, 3_000)
  })
})

session.close()
console.info(`=== Done. Total audio received: ${receivedBytes} bytes ===`)
process.exit(0)
```

- [ ] **Step 2: Run the smoke test**

Ensure `apps/api/.env` has `GEMINI_API_KEY` set, then:

```bash
npx tsx apps/api/src/voice/test-gemini.ts
```

Expected output:

```
=== Gemini Live smoke test ===
Connecting to Gemini Live...
[gemini-live] session opened
Sending text turn: "Hello, I'd like to book an appointment"
Audio chunk received: <N> bytes (total so far: <N> bytes)
[gemini-live] session closed
=== Done. Total audio received: <N> bytes ===
```

`<N>` should be > 0. If `GEMINI_API_KEY` is missing or invalid, you will see an error from the SDK — fix the env var and retry.

**If the SDK method names differ** (e.g., `sendRealtimeInput` is not available on the session object), check the installed SDK:

```bash
node -e "const g = require('@google/genai'); const s = g.GoogleGenAI; console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(new s({apiKey:'x'}).live)))"
```

This lists available methods on `client.live` so you can find the correct method name.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/voice/test-gemini.ts
git commit -m "feat: add Gemini Live smoke test script"
```

---

## Self-Review Checklist

**Spec coverage:**

- [x] Install packages (@google/genai, ws, alawmulaw) → Task 1
- [x] alawmulaw type declaration → Task 2
- [x] gemini-live.ts with createGeminiLiveSession → Task 5
- [x] System prompt from vertical_config + default Maya prompt → Task 5
- [x] telnyx-handler.ts at /voice/stream → Tasks 4 + 6
- [x] Tenant lookup via TELNYX_TENANT_MAP env var → Tasks 4 + 6
- [x] PCMU ↔ PCM16 transcoding → Tasks 4 + 6
- [x] call-logger.ts with DB stub → Task 3
- [x] Register WebSocket in index.ts without breaking Express → Task 7
- [x] test-gemini.ts smoke test → Task 8

**Type consistency:**

- `GeminiLiveSession.send(audioChunk: Buffer)` defined in Task 5, used in Task 6 ✓
- `GeminiLiveSession.onAudio(cb)` defined in Task 5, used in Tasks 6 + 8 ✓
- `GeminiLiveSession.sendText(text)` defined in Task 5, used in Task 8 ✓
- `logCall(CallLogEntry)` defined in Task 3, used in Task 6 ✓
- `pcmuToLinear16` / `linear16ToPcmu` defined in Task 4, carried forward unchanged in Task 6 ✓
- `parseTenantMap` / `lookupTenant` defined in Task 4, carried forward unchanged in Task 6 ✓
- `registerVoiceWebSocket(wss)` defined in Task 4 (stub), implemented in Task 6, imported in Task 7 ✓
