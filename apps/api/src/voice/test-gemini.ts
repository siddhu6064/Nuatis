import 'dotenv/config'
import { createGeminiLiveSession } from './gemini-live.js'

console.info('=== Gemini Live smoke test ===')
console.info('Connecting to Gemini Live...')

const session = await createGeminiLiveSession('test-tenant', 'dental')

let receivedBytes = 0

await new Promise<void>((resolve) => {
  const timeout = setTimeout(() => {
    console.warn('Timeout: no audio received within 10 seconds')
    resolve()
  }, 10_000)

  let resolveTimer: ReturnType<typeof setTimeout> | null = null

  session.onAudio((chunk) => {
    receivedBytes += chunk.byteLength
    console.info(
      `Audio chunk received: ${chunk.byteLength} bytes (total so far: ${receivedBytes} bytes)`
    )

    // After first chunk arrives, give 3 more seconds for remaining chunks then resolve
    if (!resolveTimer) {
      clearTimeout(timeout)
      resolveTimer = setTimeout(resolve, 3_000)
    }
  })

  console.info('Sending text turn: "Hello, I\'d like to book an appointment"')
  session.sendText("Hello, I'd like to book an appointment")
})

session.close()
console.info(`=== Done. Total audio received: ${receivedBytes} bytes ===`)
process.exit(0)
