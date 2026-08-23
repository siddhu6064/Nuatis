// ── Invoice email ──────────────────────────────────────────────────────────────

export interface InvoiceEmailParams {
  contactName: string
  businessName: string
  invoiceNumber: string
  invoiceTotal: string
  invoiceUrl: string
  dueDate: string
}

export function buildInvoiceEmailHtml(vars: InvoiceEmailParams): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5}
.c{max-width:560px;margin:0 auto;padding:32px 24px}.card{background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e5e5}
h1{font-size:20px;color:#111;margin:0 0 16px}p{font-size:15px;color:#444;line-height:1.6;margin:0 0 12px}
.total{font-size:28px;font-weight:700;color:#0d9488;margin:16px 0}
.btn{display:inline-block;padding:14px 28px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}
.footer{text-align:center;padding:16px;font-size:12px;color:#999}</style>
</head><body><div class="c"><div class="card">
<h1>Invoice ${vars.invoiceNumber}</h1>
<p>Hi ${vars.contactName},</p>
<p>You have received an invoice from <strong>${vars.businessName}</strong>.</p>
<div class="total">${vars.invoiceTotal}</div>
${vars.dueDate ? `<p style="font-size:13px;color:#999">Due by ${vars.dueDate}</p>` : ''}
<p style="margin-top:24px"><a class="btn" href="${vars.invoiceUrl}">View Invoice</a></p>
</div><div class="footer">${vars.businessName}</div></div></body></html>`
}
