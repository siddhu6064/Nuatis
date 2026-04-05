# API

The Nuatis CRM backend — a Node/TypeScript service that handles appointments, voice calls (Gemini Live via Telnyx), lead management, and AI follow-up workers.

## Ops Copilot Integration

The Nuatis Ops Copilot is a Python sidecar service that monitors CRM activity for operational failures and alerts the team in real time. It runs alongside the API and receives structured event payloads via HTTP. When the API detects a failure or a notable state change, it fires a one-way event to the Ops Copilot so that detectors (e.g. `BookingFailureHighSeverityDetector`, `CallFailureHighSeverityDetector`, `AppointmentNoShowDetector`) can raise ops alerts and trigger notifications.

### Client

`src/lib/ops-copilot-client.ts` — fire-and-forget POST to `OPS_COPILOT_URL/activity-events`. Hard 3 s timeout. Never throws — all errors are silently logged so CRM operations are never blocked by a sidecar failure.

### Events currently wired

| Event Type            | Trigger                                         | File                          |
| --------------------- | ----------------------------------------------- | ----------------------------- |
| `booking.failed`      | Supabase INSERT failure on appointment creation | `src/routes/appointments.ts`  |
| `call.failed`         | Gemini Live session creation failure            | `src/voice/telnyx-handler.ts` |
| `appointment.no_show` | PATCH sets `status` to `no_show`                | `src/routes/appointments.ts`  |

### Events stubbed for Phase 2

| Event Type         | File                              |
| ------------------ | --------------------------------- |
| `lead.stalled`     | `src/workers/lead-worker.ts`      |
| `follow_up.missed` | `src/workers/follow-up-worker.ts` |

### Environment variable

| Variable          | Default                 | Description                         |
| ----------------- | ----------------------- | ----------------------------------- |
| `OPS_COPILOT_URL` | `http://localhost:8001` | Base URL of the Ops Copilot sidecar |
