import { jest, describe, test, expect, beforeEach } from '@jest/globals'

// ── Environment setup ─────────────────────────────────────────────────────────

process.env['GEMINI_API_KEY'] = 'mock-gemini-key'

// ── Fetch mock (intercepts both audio download and Gemini SDK calls) ──────────

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

// ── Dynamic import (after mock setup) ────────────────────────────────────────

const { transcribeRecording } = await import('../services/transcription.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_AUDIO_URL = 'https://mock.storage.com/recording.mp3'

const GEMINI_RESPONSE = {
  candidates: [
    {
      content: {
        parts: [{ text: 'Hello, I need to book an appointment' }],
      },
      finishReason: 'STOP',
    },
  ],
}

function mockAudioDownload() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(100),
  } as unknown as Response)
}

function mockGeminiSuccess() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => GEMINI_RESPONSE,
    text: async () => JSON.stringify(GEMINI_RESPONSE),
  } as unknown as Response)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('transcribeRecording', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  test('uses gemini-2.5-flash as transcription model', async () => {
    mockAudioDownload()
    mockGeminiSuccess()

    await transcribeRecording(MOCK_AUDIO_URL)

    // First call = audio download, second call = Gemini generateContent
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const geminiUrl = String(mockFetch.mock.calls[1]?.[0])
    expect(geminiUrl).toContain('gemini-2.5-flash')
  })

  test('calls v1beta generateContent endpoint not v1', async () => {
    mockAudioDownload()
    mockGeminiSuccess()

    await transcribeRecording(MOCK_AUDIO_URL)

    const geminiUrl = String(mockFetch.mock.calls[1]?.[0])
    expect(geminiUrl).toContain('/v1beta/')
    expect(geminiUrl).not.toMatch(/\/v1\/models\//)
  })

  test('extracts transcript text from Gemini response', async () => {
    mockAudioDownload()
    mockGeminiSuccess()

    const result = await transcribeRecording(MOCK_AUDIO_URL)

    expect(result).toBe('Hello, I need to book an appointment')
    expect(result).not.toBeNull()
    expect(result).not.toBeUndefined()
  })
})
