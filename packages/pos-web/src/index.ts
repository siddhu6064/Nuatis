// Extensionless specifiers and consumed as source via transpilePackages.
// Only Next imports this package, so Turbopack's resolution is the only one
// that matters — unlike pos-core, which apps/api's tsc typechecks under
// NodeNext and therefore has to ship built output.
export {
  POS_COOKIE,
  readPosSession,
  serializePosSession,
  isExpired,
  type PosSession,
} from './session'
export { createPosProxy, type PosProxyOptions } from './proxy'
export { createSessionRoute, type SessionRoute, type SessionRouteOptions } from './session-route'
export { createSocketTicketRoute, type SocketTicketRoute } from './socket-ticket-route'
