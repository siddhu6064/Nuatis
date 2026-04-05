// TODO (Phase 2 — Follow-up Engine): Wire publishActivityEvent for follow_up.missed events here.
//
// When a BullMQ job runs for a scheduled follow-up and detects the follow-up was never executed,
// call publishActivityEvent with:
//
//   void publishActivityEvent({
//     tenant_id: job.data.tenant_id,
//     event_id: job.data.follow_up_id,
//     event_type: 'follow_up.missed',
//     payload_json: {
//       severity: 'high',
//       follow_up_id: job.data.follow_up_id,
//       contact_id: job.data.contact_id,
//     },
//   })
//
// Import: import { publishActivityEvent } from '../lib/ops-copilot-client.js'
