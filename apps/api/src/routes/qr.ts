import { Router, type Request, type Response } from 'express'
import QRCode from 'qrcode'

const router = Router()

// GET /api/qr?url={encodedUrl}&size={100-400}
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { url, size } = req.query

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url query param required' })
    return
  }

  let decodedUrl: string
  try {
    decodedUrl = decodeURIComponent(url)
  } catch {
    res.status(400).json({ error: 'Invalid url encoding' })
    return
  }

  const sizeNum = Math.min(400, Math.max(100, parseInt(String(size ?? '256'), 10) || 256))

  try {
    const buffer = await QRCode.toBuffer(decodedUrl, {
      type: 'png',
      width: sizeNum,
      margin: 2,
    })
    res.set('Content-Type', 'image/png')
    res.set('Cache-Control', 'public, max-age=3600')
    res.send(buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QR generation failed'
    res.status(500).json({ error: message })
  }
})

export default router
