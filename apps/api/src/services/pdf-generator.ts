import PDFDocument from 'pdfkit'

interface LineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
  package_id?: string | null
}

interface QuotePdfData {
  quoteNumber: string
  title: string
  createdAt: string
  validUntil: string | null
  contactName: string
  contactEmail: string | null
  contactPhone: string | null
  businessName: string
  businessPhone: string | null
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  depositPct?: number | null
  depositAmount?: number | null
  remainingBalance?: number | null
  notes: string | null
  lineItems: LineItem[]
}

const TEAL = '#0d9488'
const DARK = '#111827'
const GRAY = '#6b7280'
const LIGHT_GRAY = '#f3f4f6'

function fmt(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export async function generateQuotePdf(data: QuotePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageWidth = doc.page.width - 100 // margins

    // ── Header bar ────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(TEAL)
    doc.fontSize(22).fillColor('#ffffff').text(data.businessName, 50, 28, { width: pageWidth })
    doc
      .fontSize(10)
      .fillColor('rgba(255,255,255,0.7)')
      .text('QUOTE', doc.page.width - 150, 30, { width: 100, align: 'right' })

    // ── Quote info ────────────────────────────────────────────────────────
    let y = 100
    doc.fontSize(10).fillColor(GRAY)

    doc.text('Quote Number', 50, y)
    doc.fillColor(DARK).text(data.quoteNumber, 160, y)

    y += 18
    doc.fillColor(GRAY).text('Date', 50, y)
    doc.fillColor(DARK).text(
      new Date(data.createdAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      160,
      y
    )

    if (data.validUntil) {
      y += 18
      doc.fillColor(GRAY).text('Valid Until', 50, y)
      doc.fillColor(DARK).text(
        new Date(data.validUntil).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }),
        160,
        y
      )
    }

    y += 18
    doc.fillColor(GRAY).text('Title', 50, y)
    doc.fillColor(DARK).text(data.title, 160, y)

    // ── Prepared for ──────────────────────────────────────────────────────
    y += 36
    doc.fontSize(11).fillColor(TEAL).text('Prepared For', 50, y)
    y += 18
    doc.fontSize(10).fillColor(DARK).text(data.contactName, 50, y)
    if (data.contactEmail) {
      y += 15
      doc.fillColor(GRAY).text(data.contactEmail, 50, y)
    }
    if (data.contactPhone) {
      y += 15
      doc.fillColor(GRAY).text(data.contactPhone, 50, y)
    }

    // ── Line items table ──────────────────────────────────────────────────
    y += 36
    const colX = { num: 50, desc: 75, qty: 340, price: 400, total: 475 }

    // Header row
    doc.rect(50, y, pageWidth, 22).fill(LIGHT_GRAY)
    doc.fontSize(8).fillColor(GRAY)
    doc.text('#', colX.num + 4, y + 6)
    doc.text('Description', colX.desc, y + 6)
    doc.text('Qty', colX.qty, y + 6, { width: 50, align: 'right' })
    doc.text('Price', colX.price, y + 6, { width: 65, align: 'right' })
    doc.text('Total', colX.total, y + 6, { width: 75, align: 'right' })
    y += 22

    // Rows — group by package_id
    doc.fontSize(9).fillColor(DARK)
    const renderedPkgIds = new Set<string>()
    let rowNum = 0

    for (let idx = 0; idx < data.lineItems.length; idx++) {
      const item = data.lineItems[idx]!
      if (item.package_id && !renderedPkgIds.has(item.package_id)) {
        renderedPkgIds.add(item.package_id)
        const group = data.lineItems.filter((li) => li.package_id === item.package_id)
        const pkgName =
          group.find((li) => li.unit_price < 0)?.description?.replace(' — Bundle Savings', '') ??
          'Package'

        // Package header row
        doc.rect(50, y, pageWidth, 20).fill('#eef2ff')
        doc.fontSize(8).fillColor('#4338ca')
        doc.font('Helvetica-Bold').text(`Package: ${pkgName}`, colX.desc, y + 5, { width: 400 })
        doc.font('Helvetica')
        y += 20

        for (const gi of group) {
          rowNum++
          const isDiscount = gi.unit_price < 0
          if (rowNum % 2 === 0) doc.rect(50, y, pageWidth, 20).fill('#fafafa')

          doc
            .fontSize(8)
            .fillColor(GRAY)
            .text('', colX.num + 4, y + 5)
          if (isDiscount) {
            doc
              .fontSize(8)
              .fillColor('#059669')
              .text(gi.description, colX.desc + 10, y + 5, { width: 250 })
            doc.text(fmt(gi.total), colX.total, y + 5, { width: 75, align: 'right' })
          } else {
            doc
              .fontSize(8)
              .fillColor(GRAY)
              .text(gi.description, colX.desc + 10, y + 5, { width: 250 })
            doc.fillColor(DARK)
            doc.text(String(gi.quantity), colX.qty, y + 5, { width: 50, align: 'right' })
            doc.text(fmt(gi.unit_price), colX.price, y + 5, { width: 65, align: 'right' })
            doc.text(fmt(gi.total), colX.total, y + 5, { width: 75, align: 'right' })
          }
          y += 20
        }
      } else if (item.package_id) {
        // Already rendered
      } else {
        rowNum++
        if (rowNum % 2 === 0) doc.rect(50, y, pageWidth, 20).fill('#fafafa')
        doc
          .fontSize(9)
          .fillColor(GRAY)
          .text(String(rowNum), colX.num + 4, y + 5)
        doc.fillColor(DARK).text(item.description, colX.desc, y + 5, { width: 260 })
        doc.text(String(item.quantity), colX.qty, y + 5, { width: 50, align: 'right' })
        doc.text(fmt(item.unit_price), colX.price, y + 5, { width: 65, align: 'right' })
        doc.text(fmt(item.total), colX.total, y + 5, { width: 75, align: 'right' })
        y += 20
      }
    }

    // ── Totals ────────────────────────────────────────────────────────────
    y += 10
    doc.moveTo(380, y).lineTo(550, y).strokeColor(LIGHT_GRAY).stroke()
    y += 8

    doc.fontSize(9).fillColor(GRAY).text('Subtotal', 380, y)
    doc.fillColor(DARK).text(fmt(data.subtotal), 475, y, { width: 75, align: 'right' })

    if (data.taxRate > 0) {
      y += 18
      doc.fillColor(GRAY).text(`Tax (${data.taxRate}%)`, 380, y)
      doc.fillColor(DARK).text(fmt(data.taxAmount), 475, y, { width: 75, align: 'right' })
    }

    y += 24
    doc.moveTo(380, y).lineTo(550, y).strokeColor(TEAL).lineWidth(1.5).stroke()
    y += 8
    doc.fontSize(14).fillColor(TEAL).text('Total', 380, y)
    doc.text(fmt(data.total), 475, y, { width: 75, align: 'right' })

    // ── Deposit ──────────────────────────────────────────────────────────
    if (data.depositAmount != null && data.depositAmount > 0) {
      y += 28
      doc.moveTo(380, y).lineTo(550, y).strokeColor(LIGHT_GRAY).lineWidth(0.5).stroke()
      y += 10

      doc
        .fontSize(9)
        .fillColor(DARK)
        .font('Helvetica-Bold')
        .text(`Deposit Required (${data.depositPct ?? 0}%)`, 380, y)
      doc.text(fmt(data.depositAmount), 475, y, { width: 75, align: 'right' })
      doc.font('Helvetica')

      y += 18
      doc.fillColor(GRAY).text('Remaining Balance', 380, y)
      doc
        .fillColor(DARK)
        .text(fmt(data.remainingBalance ?? 0), 475, y, { width: 75, align: 'right' })

      y += 16
      doc
        .fontSize(7)
        .fillColor(GRAY)
        .font('Helvetica-Oblique')
        .text('A deposit is required to confirm your booking.', 380, y, { width: 170 })
      doc.font('Helvetica')
    }

    // ── Notes ─────────────────────────────────────────────────────────────
    if (data.notes) {
      y += 40
      doc.fontSize(10).fillColor(TEAL).text('Notes', 50, y)
      y += 16
      doc.fontSize(9).fillColor(GRAY).text(data.notes, 50, y, { width: pageWidth })
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60
    doc.fontSize(8).fillColor(GRAY)
    doc.text(
      data.businessName + (data.businessPhone ? ` · ${data.businessPhone}` : ''),
      50,
      footerY,
      { width: pageWidth, align: 'center' }
    )
    doc.text('Generated by Nuatis CRM', 50, footerY + 12, { width: pageWidth, align: 'center' })

    doc.end()
  })
}
