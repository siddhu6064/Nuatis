import type { WeeklyDigestData } from '@nuatis/shared'

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:3000'
const API_BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3001'

// ── HTML escape helper ────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtDollars(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `$${Number.isInteger(v) ? v : v.toFixed(1)}m`
  }
  if (n >= 1_000) {
    const v = n / 1_000
    return `$${Number.isInteger(v) ? v : v.toFixed(1)}k`
  }
  return `$${n}`
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

// ── Section header ────────────────────────────────────────────────────────────

function sectionHeader(title: string): string {
  return `
    <tr>
      <td colspan="2" style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;padding-top:24px;padding-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
        ${title}
      </td>
    </tr>`
}

// ── Stat cell (used inside 2×2 grids) ────────────────────────────────────────

function statCell(value: string, label: string): string {
  return `<td style="padding:4px">
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px">
          <div style="font-size:22px;font-weight:700;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${value}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${label}</div>
        </td>
      </tr>
    </table>
  </td>`
}

// ── Main render function ──────────────────────────────────────────────────────

export function renderWeeklyDigest(
  data: WeeklyDigestData,
  unsubToken: string
): { subject: string; html: string } {
  const subject = `Your week at ${data.business_name} — ${data.period.to}`

  // Change pct badge
  let changeBadge = ''
  if (data.contacts.change_pct !== null) {
    const pct = data.contacts.change_pct
    if (pct >= 0) {
      changeBadge = `<span style="color:#16a34a;font-size:13px;margin-left:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">&#x2191; ${pct}%</span>`
    } else {
      changeBadge = `<span style="color:#dc2626;font-size:13px;margin-left:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">&#x2193; ${Math.abs(pct)}%</span>`
    }
  }

  // Top insight block
  const topInsightBlock =
    data.top_insight !== null
      ? `<tr>
          <td colspan="2" style="padding-bottom:16px">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="background:#ccfbf1;border-left:4px solid #0d9488;padding:12px 16px;font-style:italic;font-size:14px;color:#134e4a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
                  ${esc(data.top_insight)}
                </td>
              </tr>
            </table>
          </td>
        </tr>`
      : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Weekly Digest</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5">
    <tr><td align="center" style="padding:24px 16px">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- Header -->
        <tr>
          <td style="background:#0d9488;padding:24px 28px;border-radius:10px 10px 0 0">
            <div style="color:#ccfbf1;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Nuatis</div>
            <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${esc(data.business_name)} Weekly Digest</div>
            <div style="color:#ccfbf1;font-size:13px;margin-top:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${esc(data.period.from)} &#x2013; ${esc(data.period.to)}</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:24px 28px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px">
            <table cellpadding="0" cellspacing="0" width="100%">

              <!-- Top insight -->
              ${topInsightBlock}

              <!-- Section: Contacts -->
              ${sectionHeader('Contacts')}
              <tr>
                <td colspan="2" style="padding-bottom:8px">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px">
                        <table cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td>
                              <span style="font-size:28px;font-weight:700;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">${data.contacts.new_this_week}</span>
                              <span style="font-size:13px;color:#64748b;margin-left:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">New This Week</span>
                              ${changeBadge}
                            </td>
                          </tr>
                          <tr>
                            <td style="font-size:12px;color:#94a3b8;padding-top:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
                              ${data.contacts.total} total contacts
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Section: Appointments -->
              ${sectionHeader('Appointments')}
              <tr>
                <td colspan="2" style="padding-bottom:8px">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      ${statCell(String(data.appointments.booked_this_week), 'Booked')}
                      ${statCell(String(data.appointments.showed), 'Showed')}
                    </tr>
                    <tr>
                      ${statCell(String(data.appointments.no_show), 'No-Show')}
                      ${statCell(String(data.appointments.upcoming_7d), 'Upcoming (next 7d)')}
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Section: Pipeline -->
              ${sectionHeader('Pipeline')}
              <tr>
                <td colspan="2" style="padding-bottom:8px">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      ${statCell(String(data.pipeline.new_deals), 'New Deals')}
                      ${statCell(String(data.pipeline.deals_won), 'Won')}
                    </tr>
                    <tr>
                      ${statCell(fmtDollars(data.pipeline.revenue_won), 'Revenue Won')}
                      ${statCell(fmtDollars(data.pipeline.open_pipeline_value), 'Open Pipeline')}
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Section: Maya -->
              ${sectionHeader('Maya')}
              <tr>
                <td colspan="2" style="padding-bottom:8px">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      ${statCell(String(data.maya_calls.total_this_week), 'Calls Handled')}
                      ${statCell(String(data.maya_calls.bookings_from_calls), 'Bookings from Calls')}
                    </tr>
                    <tr>
                      ${statCell(fmtDuration(data.maya_calls.avg_duration_seconds), 'Avg Call Duration')}
                      <td style="padding:4px"></td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- SMS Health -->
              <tr>
                <td colspan="2" style="padding-top:16px;padding-bottom:8px">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="background:#f8fafc;padding:12px 16px;font-size:12px;color:#64748b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
                        SMS (7 days): ${data.sms_health.sent_this_week} sent &middot; ${data.sms_health.delivery_rate !== null ? data.sms_health.delivery_rate + '%' : 'N/A'} delivered
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td colspan="2" style="padding-top:24px;text-align:center;border-top:1px solid #f1f5f9">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td align="center" style="padding-top:16px">
                        <a href="${WEB_URL}/settings/notifications" style="color:#0d9488;font-size:12px;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Manage digest preferences &#x2192;</a>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="padding-top:8px;padding-bottom:8px">
                        <a href="${API_BASE_URL}/api/digest/unsubscribe?token=${unsubToken}" style="color:#94a3b8;font-size:11px;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">Unsubscribe from weekly digest</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html }
}
