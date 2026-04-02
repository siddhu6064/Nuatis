declare module 'alawmulaw' {
  export const mulaw: {
    /** Decode µ-law encoded bytes to 16-bit linear PCM samples */
    decode(samples: Uint8Array | Buffer): Int16Array
    /** Encode 16-bit linear PCM samples to µ-law bytes */
    encode(samples: Int16Array): Uint8Array
  }
  export const alaw: {
    decode(samples: Uint8Array | Buffer): Int16Array
    encode(samples: Int16Array): Uint8Array
  }
}
