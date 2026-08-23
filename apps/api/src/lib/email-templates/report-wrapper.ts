// ── Scheduled report email wrapper ────────────────────────────────────────────
// Generic HTML skeleton shared by all scheduled report types (velocity,
// appointments, lead source, pipeline funnel). Each report builds its own
// `body` HTML fragment from tenant data and passes it in here — that
// per-report data-shaping logic stays in scheduled-report-worker.ts since it's
// tightly coupled to each report's query results, not reusable copy.

export function buildReportEmailWrapper(title: string, businessName: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;background:#f5f5f5}
  .outer{max-width:600px;margin:0 auto;padding:24px 16px}
  .header{background:#0d9488;padding:20px 24px;border-radius:10px 10px 0 0}
  .header h1{color:#fff;margin:0;font-size:18px;font-weight:700}
  .header p{color:#ccfbf1;margin:4px 0 0;font-size:13px}
  .body{background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}
  th{text-align:left;padding:8px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
  td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#334155}
  tr:last-child td{border-bottom:none}
  .stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
  .stat{background:#f8fafc;border-radius:8px;padding:14px 16px;border:1px solid #e2e8f0}
  .stat .val{font-size:22px;font-weight:700;color:#0f172a}
  .stat .lbl{font-size:11px;color:#94a3b8;margin-top:2px}
  .footer{text-align:center;padding:16px;font-size:11px;color:#94a3b8}
</style>
</head>
<body>
<div class="outer">
  <div class="header">
    <h1>${title}</h1>
    <p>${businessName} · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
  </div>
  <div class="body">${body}</div>
  <div class="footer">Sent by Nuatis · <a href="https://nuatis.com" style="color:#0d9488">nuatis.com</a></div>
</div>
</body></html>`
}
