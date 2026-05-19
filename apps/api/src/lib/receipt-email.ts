import { sendEmail } from './email-client.js'

export interface ReceiptLineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

export interface ReceiptQuote {
  quote_number: string
  receipt_number: string
  title: string
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  line_items: ReceiptLineItem[]
}

export interface ReceiptContact {
  full_name: string
  email: string
}

function buildHtml(quote: ReceiptQuote, contact: ReceiptContact, tenantName: string): string {
  const today = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const lineRows = quote.line_items
    .map(
      (item) =>
        `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333">${item.description}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:center">${item.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right">$${Number(item.unit_price).toFixed(2)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right">$${Number(item.total).toFixed(2)}</td>
        </tr>`
    )
    .join('')

  const taxRow =
    Number(quote.tax_rate) > 0
      ? `<tr>
          <td colspan="3" style="padding:8px 12px;font-size:13px;color:#666;text-align:right">Tax (${quote.tax_rate}%)</td>
          <td style="padding:8px 12px;font-size:13px;color:#666;text-align:right">$${Number(quote.tax_amount).toFixed(2)}</td>
        </tr>`
      : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="background:#007A6E;border-radius:12px 12px 0 0;padding:28px 32px">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="vertical-align:top">
            <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">Nuatis</div>
            <div style="font-size:11px;font-weight:600;color:#a7f3d0;letter-spacing:2px;margin-top:4px">RECEIPT</div>
          </td>
          <td style="vertical-align:top;text-align:right">
            <div style="font-size:24px;font-weight:800;color:#fff">${quote.receipt_number}</div>
            <div style="font-size:12px;color:#a7f3d0;margin-top:4px">${today}</div>
          </td>
        </tr>
      </table>
    </div>

    <div style="background:#fff;padding:28px 32px;border:1px solid #e5e5e5;border-top:none">
      <p style="margin:0 0 6px;font-size:15px;color:#333">Hi <strong>${contact.full_name}</strong>,</p>
      <p style="margin:0 0 24px;font-size:15px;color:#555">Thank you for your business with <strong>${tenantName}</strong>.</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead>
          <tr style="background:#f8f8f8">
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#666;text-align:left;border-bottom:2px solid #e5e5e5">Description</th>
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#666;text-align:center;border-bottom:2px solid #e5e5e5">Qty</th>
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#666;text-align:right;border-bottom:2px solid #e5e5e5">Unit Price</th>
            <th style="padding:10px 12px;font-size:12px;font-weight:600;color:#666;text-align:right;border-bottom:2px solid #e5e5e5">Total</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>

      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td colspan="3" style="padding:8px 12px;font-size:13px;color:#666;text-align:right">Subtotal</td>
          <td style="padding:8px 12px;font-size:13px;color:#666;text-align:right">$${Number(quote.subtotal).toFixed(2)}</td>
        </tr>
        ${taxRow}
        <tr style="border-top:2px solid #e5e5e5">
          <td colspan="3" style="padding:12px;font-size:16px;font-weight:700;color:#111;text-align:right">Total</td>
          <td style="padding:12px;font-size:16px;font-weight:700;color:#007A6E;text-align:right">$${Number(quote.total).toFixed(2)}</td>
        </tr>
      </table>
    </div>

    <div style="background:#fafafa;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px;padding:16px 32px;text-align:center">
      <p style="margin:0;font-size:11px;color:#999">Powered by Nuatis</p>
    </div>
  </div>
</body>
</html>`
}

export async function sendReceiptEmail(
  quote: ReceiptQuote,
  contact: ReceiptContact,
  tenantName: string
): Promise<boolean> {
  return sendEmail({
    to: contact.email,
    from: 'receipts@nuatis.com',
    subject: `Receipt ${quote.receipt_number} — ${tenantName}`,
    html: buildHtml(quote, contact, tenantName),
  })
}
