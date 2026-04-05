// TODO (Phase 2 — Lead Pipeline): Wire publishActivityEvent for lead.stalled events here.
//
// When a BullMQ job runs and detects a lead has been in the same pipeline stage for ≥3 days,
// call publishActivityEvent with:
//
//   void publishActivityEvent({
//     tenant_id: job.data.tenant_id,
//     event_id: job.data.lead_id,
//     event_type: 'lead.stalled',
//     payload_json: {
//       severity: 'high',
//       days_stalled: job.data.days_stalled,
//       lead_id: job.data.lead_id,
//       stage: job.data.stage,
//     },
//   })
//
// Import: import { publishActivityEvent } from '../lib/ops-copilot-client.js'
