// ── Quote emails ───────────────────────────────────────────────────────────────

export interface QuoteEmailParams {
  contactName: string
  businessName: string
  quoteNumber: string
  quoteTotal: string
  quoteUrl: string
  validUntil: string
}

export function buildQuoteEmailHtml(vars: QuoteEmailParams): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5}
.c{max-width:560px;margin:0 auto;padding:32px 24px}.card{background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5}
h1{font-size:20px;color:#111;margin:0 0 16px}p{font-size:15px;color:#444;line-height:1.6;margin:0 0 12px}
.total{font-size:28px;font-weight:700;color:#0d9488;margin:16px 0}
.btn{display:inline-block;padding:14px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}
.footer{text-align:center;padding:16px;font-size:12px;color:#999}</style>
</head><body><div class="c"><div class="card">
<h1>Quote ${vars.quoteNumber}</h1>
<p>Hi ${vars.contactName},</p>
<p>You've received a quote from <strong>${vars.businessName}</strong>.</p>
<div class="total">${vars.quoteTotal}</div>
${vars.validUntil ? `<p style="font-size:13px;color:#999">Valid until ${vars.validUntil}</p>` : ''}
<p style="margin-top:24px"><a class="btn" href="${vars.quoteUrl}">View Quote</a></p>
</div><div class="footer">${vars.businessName}</div></div></body></html>`
}

export interface QuoteApprovalEmailParams {
  quoteNumber: string
  title: string
  contactName: string
  subtotal: string
  discountPct: string
  discountAmount: string
  total: string
  quoteUrl: string
  businessName: string
}

export function buildQuoteApprovalEmailHtml(vars: QuoteApprovalEmailParams): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5}
.c{max-width:560px;margin:0 auto;padding:32px 24px}.card{background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5}
h1{font-size:20px;color:#111;margin:0 0 16px}p{font-size:15px;color:#444;line-height:1.6;margin:0 0 12px}
.discount{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin:16px 0}
.discount strong{color:#d97706}
.total{font-size:24px;font-weight:700;color:#0d9488;margin:12px 0}
.btn{display:inline-block;padding:14px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}
.footer{text-align:center;padding:16px;font-size:12px;color:#999}
table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:6px 0;font-size:14px;color:#444}
td:last-child{text-align:right}</style>
</head><body><div class="c"><div class="card">
<h1>Quote Approval Required</h1>
<p>A quote needs your approval before it can be sent.</p>
<table>
<tr><td style="color:#999">Quote</td><td><strong>${vars.quoteNumber}</strong></td></tr>
<tr><td style="color:#999">Title</td><td>${vars.title}</td></tr>
${vars.contactName ? `<tr><td style="color:#999">Contact</td><td>${vars.contactName}</td></tr>` : ''}
<tr><td style="color:#999">Subtotal</td><td>${vars.subtotal}</td></tr>
</table>
<div class="discount">
<strong>${vars.discountPct}% discount applied</strong> &mdash; ${vars.discountAmount} off
</div>
<div class="total">${vars.total}</div>
<p style="margin-top:24px"><a class="btn" href="${vars.quoteUrl}">Review This Quote</a></p>
</div><div class="footer">${vars.businessName}</div></div></body></html>`
}
