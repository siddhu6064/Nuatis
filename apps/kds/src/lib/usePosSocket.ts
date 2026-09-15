'use client'

import { useEffect, useRef, useState } from 'react'
import { PosSocket, type PosSocketEvent, type SocketStatus, type SocketTicket } from './pos-socket'

interface UsePosSocketOptions {
  /** The API's WebSocket URL, e.g. ws://localhost:3001/ws/pos. */
  url: string
  onEvent: (event: PosSocketEvent) => void
}

/**
 * Live ticket feed.
 *
 * A thin wrapper: connect, reconnect and cleanup rules all live in PosSocket so
 * they can be tested without a browser. `onEvent` is held in a ref rather than
 * listed as a dependency — the board's handler closes over its ticket state and
 * so changes identity on every event, which as a dependency would tear the
 * socket down and rebuild it each time a ticket arrived.
 */
export function usePosSocket({ url, onEvent }: UsePosSocketOptions): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    const socket = new PosSocket({
      url,
      fetchTicket: async () => {
        const res = await fetch('/api/socket-ticket')
        if (!res.ok) throw new Error(`socket ticket: ${res.status}`)
        return (await res.json()) as SocketTicket
      },
      onEvent: (event) => onEventRef.current(event),
      onStatus: setStatus,
    })
    socket.start()
    return () => socket.close()
  }, [url])

  return status
}
