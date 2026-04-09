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
  it('converts 24kHz PCM16 to 8kHz PCMU at 3:1 downsample', () => {
    // 60 bytes = 30 samples at 24kHz → 10 PCMU bytes at 8kHz
    const pcm24 = Buffer.alloc(60, 0)
    const pcmu = linear16ToPcmu(pcm24)
    expect(pcmu.byteLength).toBe(10)
  })

  it('returns a Buffer', () => {
    const pcmu = linear16ToPcmu(Buffer.alloc(18, 0))
    expect(Buffer.isBuffer(pcmu)).toBe(true)
  })

  it('produces correct output length for various inputs', () => {
    // 6 bytes per output sample: stride 6 (3 int16 samples × 2 bytes)
    expect(linear16ToPcmu(Buffer.alloc(6, 0)).byteLength).toBe(1)
    expect(linear16ToPcmu(Buffer.alloc(12, 0)).byteLength).toBe(2)
    expect(linear16ToPcmu(Buffer.alloc(30, 0)).byteLength).toBe(5)
  })
})
