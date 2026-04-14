export async function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_name: eventName, properties }),
    })
  } catch {
    // silent fail — never block user actions
  }
}
