// Incident reporting, shared by the register and the kitchen display.
//
// Kept OFF the package root on purpose: the root imports next/server and jose,
// which a CommonJS Jest run in either app cannot parse. This entry is pure
// TypeScript with no dependencies.
export {
  needsManagerPin,
  toIncidentPayload,
  reportIncident,
  ReportIncidentError,
  type IncidentInput,
  type ReportedIncident,
} from './report-incident'
