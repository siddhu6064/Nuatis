import { pcmuToLinear16, linear16ToPcmu } from './telnyx-handler.js'

describe('pcmuToLinear16', () => {
  it('converts a PCMU buffer to a PCM16 buffer at double the sample count', () => {
    // 10-byte PCMU input → 20 PCM samples → 40 bytes of PCM16
    const pcmu = Buffer.alloc(10, 0xff) // 0xff = µ-law silence
    const pcm16 = pcmuToLinear16(pcmu)
    expect(pcm16.byteLength).toBe(40)
  })

  it('returns a Buffer', () => {
    const pcm16 = pcmuToLinear16(Buffer.alloc(8, 0xff))
    expect(Buffer.isBuffer(pcm16)).toBe(true)
  })
})

describe('linear16ToPcmu', () => {
  it('converts a PCM16 buffer to a PCMU buffer at half the sample count', () => {
    // 40 bytes (20 samples) of PCM16 → 10 PCMU bytes
    const pcm16 = Buffer.alloc(40, 0)
    const pcmu = linear16ToPcmu(pcm16)
    expect(pcmu.byteLength).toBe(10)
  })

  it('returns a Buffer', () => {
    const pcmu = linear16ToPcmu(Buffer.alloc(16, 0))
    expect(Buffer.isBuffer(pcmu)).toBe(true)
  })

  it('round-trips silence without error', () => {
    const originalPcmu = Buffer.alloc(10, 0xff)
    const pcm16 = pcmuToLinear16(originalPcmu)
    const roundTripped = linear16ToPcmu(pcm16)
    expect(roundTripped.byteLength).toBe(originalPcmu.byteLength)
  })
})
