# Voice AI WebSocket Pipeline — Design Spec

**Date:** 2026-04-02
**Phase:** Phase 2, Weeks 9–10
**Scope:** Backend only — no UI, no DB schema changes, no Telnyx webhook registration

---

## Goal

Build the real-time Voice AI pipeline that connects an inbound Telnyx phone call to a Gemini Live session (STT + LLM + TTS in a single API), bridging audio in both directions. The AI persona is **Maya**, a bilingual EN+ES receptionist. Target first-response latency: under 1.5 s.

---

## Stack

| Concern          | Choice                                                  | Reason                                         |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------- |
| Telephony        | Telnyx WebSocket streaming                              | Already provisioned (+15127376388)             |
| STT + LLM + TTS  | Gemini 3.1 Flash Live (`gemini-3.1-flash-live-preview`) | Single API, bilingual auto-detect, low latency |
| Audio codec      | `alawmulaw` (pure JS)                                   | No native bindings, handles µ-law ↔ PCM        |
| WebSocket server | `ws`                                                    | Lightweight, works with Node `http.Server`     |

---

## New packages (apps/api)

- `@google/genai` — Gemini SDK
- `telnyx` — Telnyx Node SDK (used for type references; WebSocket is raw)
- `ws` — WebSocket server
- `alawmulaw` — Pure-JS µ-law / A-law codec

---

## File layout

```
apps/api/src/voice/
  gemini-live.ts       ← Gemini Live session wrapper
  telnyx-handler.ts    ← WebSocket server + audio bridge
  call-logger.ts       ← Console logger, DB stub
  test-gemini.ts       ← Dev smoke-test (not shipped to prod)
```

---

## index.ts change

`app.listen()` is replaced by `http.createServer(app)` so the same port (3001) serves both HTTP (Express) and WebSocket upgrades. The `ws.Server` is attached to the HTTP server with `path: '/voice/stream'`. All existing Express routes are unaffected.

---

## gemini-live.ts

**Purpose:** Wraps the Gemini Live streaming API into a simple send/receive interface.

**Export:**

```ts
createGeminiLiveSession(tenantId: string, vertical: string): Promise<GeminiLiveSession>

interface GeminiLiveSession {
  send(audioChunk: Buffer): void
  onAudio(cb: (chunk: Buffer) => void): void
  close(): void
}
```

**Behaviour:**

- Model: `gemini-3.1-flash-live-preview`
- `responseModalities: ["AUDIO"]`
- Language: auto-detect (Gemini Live natively supports EN + ES)
- System prompt: look up `VERTICALS[vertical].system_prompt_template`; fall back to the default Maya prompt if the vertical is unknown or has no template
- Default Maya prompt:
  > "You are Maya, a friendly bilingual AI receptionist. You speak English and Spanish fluently. Always respond in the same language the caller uses. You help callers book appointments, answer questions about the business, and transfer to a human when needed. Be warm, professional, and concise."
- The session object emits received audio chunks via the registered `onAudio` callback

---

## telnyx-handler.ts

**Purpose:** WebSocket endpoint that bridges a live Telnyx call to a Gemini Live session, including audio transcoding.

**Endpoint:** `ws://localhost:3001/voice/stream`

**Telnyx event flow:**

1. Connection opens → wait for `start` event containing `To` phone number
2. Look up `tenant_id` via `TELNYX_TENANT_MAP` env var (format: `+15127376388:tenant-uuid`)
3. Open Gemini Live session for that tenant + vertical (vertical stored per-tenant; default to `sales_crm` for now)
4. Stream `media` events bidirectionally until `stop` event or socket close

**Audio transcoding:**

| Direction       | Steps                                                                       |
| --------------- | --------------------------------------------------------------------------- |
| Telnyx → Gemini | base64 decode → µ-law PCMU 8 kHz → linear PCM 16-bit 16 kHz (upsample ×2)   |
| Gemini → Telnyx | linear PCM 16-bit 16 kHz → µ-law PCMU 8 kHz (downsample ×2) → base64 encode |

Codec: `alawmulaw` npm package (pure JS, no native bindings).

**On call end:** close Gemini session, call `logCall()`.

---

## call-logger.ts

**Purpose:** Structured call logging. Console-only for now; stubbed for DB writes.

```ts
logCall(params: {
  tenant_id: string
  duration_seconds: number
  language: string     // 'en' | 'es' | 'unknown'
  timestamp: Date
}): void
```

Logs to `console.info`. Includes a `// TODO: write to calls table (next task)` comment.

---

## test-gemini.ts

**Purpose:** Smoke-test — verifies Gemini Live responds before any Telnyx call is involved.

- Instantiates a `GeminiLiveSession` directly (no WebSocket, no Telnyx)
- Sends a text turn: "Hello, I'd like to book an appointment"
- Waits for first audio chunk
- Logs: `Audio response received: <N> bytes`
- Exits cleanly

Run with: `npx tsx apps/api/src/voice/test-gemini.ts`

---

## Tenant lookup (Phase 2 interim)

Env var format:

```
TELNYX_TENANT_MAP=+15127376388:tenant-uuid-here
```

Supports comma-separated entries for multiple numbers. Real DB lookup (query `tenants` table by `phone_number`) will replace this in a later task.

---

## Acceptance criteria

- `npm run dev --workspace=apps/api` starts with no errors
- `ws://localhost:3001/voice/stream` is reachable
- `npx tsx apps/api/src/voice/test-gemini.ts` connects to Gemini Live and logs audio byte count
- All existing Express routes (`/health`, `/api/tenants`, `/api/appointments`, etc.) still respond correctly

---

## Out of scope for this task

- Calls DB table
- Telnyx webhook registration
- Any UI changes
- apps/web changes
