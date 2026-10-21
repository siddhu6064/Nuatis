// Ticket model and socket client: pure TypeScript, zero dependencies.
//
// Kept OFF the package root on purpose. The root pulls in `next/server` and
// `jose` for the proxy and the route factories, and a register component that
// only wants the `Ticket` type should not drag a JWT library into its bundle —
// or into a CommonJS Jest run, which cannot parse jose's ESM at all.
export {
  PosSocket,
  backoffMs,
  parseEvent,
  isAuthenticatedFrame,
  SOCKET_EVENT_TYPES,
  type PosSocketEvent,
  type PosSocketOptions,
  type SocketEventType,
  type SocketLike,
  type SocketStatus,
  type SocketTicket,
} from './pos-socket'
export {
  ageTone,
  elapsedLabel,
  sortTickets,
  applyEvent,
  stationsOf,
  filterByStation,
  type AgeTone,
  type Ticket,
  type TicketItem,
} from './ticket-board'
