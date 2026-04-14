// Local copy of follow-up cadence data for web app pages.
// Turbopack (Next.js 16) can't resolve .js extension re-exports in @nuatis/shared's index.ts,
// so we duplicate the cadence config here. Keep in sync with packages/shared/src/verticals/index.ts.

export interface FollowUpStep {
  days_after: number
  channel: 'sms' | 'email'
  subject?: string
  template: string
}

export const FOLLOW_UP_CADENCES: Record<string, FollowUpStep[]> = {
  sales_crm: [
    {
      days_after: 1,
      channel: 'sms',
      template:
        "Hi {name}, thank you for calling {business}! If you'd like to schedule a demo, reply or call us anytime.",
    },
    {
      days_after: 3,
      channel: 'email',
      subject: 'Following up from {business}',
      template:
        "We wanted to follow up on your recent inquiry. We'd love to help you get started with a personalized demo.",
    },
    {
      days_after: 7,
      channel: 'sms',
      template:
        "Hi {name}, just checking in from {business}. We're here when you're ready. Reply STOP to opt out.",
    },
  ],
  dental: [
    {
      days_after: 1,
      channel: 'sms',
      template:
        "Hi {name}, thanks for calling {business}! We'd love to help you schedule a cleaning or checkup. Reply or call anytime.",
    },
    {
      days_after: 3,
      channel: 'email',
      subject: 'Your dental health matters — {business}',
      template:
        "We wanted to follow up on your recent call. Regular checkups are key to great oral health. We'd love to get you on the schedule.",
    },
    {
      days_after: 7,
      channel: 'sms',
      template:
        'Hi {name}, just a friendly reminder from {business} — we have openings this week. Reply STOP to opt out.',
    },
  ],
  salon: [
    {
      days_after: 1,
      channel: 'sms',
      template:
        "Hi {name}, thanks for calling {business}! We'd love to get you booked for your next visit. Reply or call anytime.",
    },
    {
      days_after: 4,
      channel: 'email',
      subject: 'Time for a refresh? — {business}',
      template:
        'We wanted to follow up from your recent inquiry. We have great availability this week and would love to see you.',
    },
    {
      days_after: 7,
      channel: 'sms',
      template:
        'Hi {name}, openings available this week at {business}. Book your spot! Reply STOP to opt out.',
    },
  ],
  restaurant: [
    {
      days_after: 1,
      channel: 'sms',
      template:
        "Hi {name}, thanks for reaching out to {business}! We'd love to host you. Call or reply to make a reservation.",
    },
    {
      days_after: 5,
      channel: 'email',
      subject: 'Join us at {business}',
      template:
        'We wanted to follow up on your recent inquiry. We have great specials this week and would love to welcome you.',
    },
    {
      days_after: 7,
      channel: 'sms',
      template:
        'Hi {name}, hope to see you at {business} soon! Check out our latest menu. Reply STOP to opt out.',
    },
  ],
  contractor: [
    {
      days_after: 1,
      channel: 'sms',
      template:
        "Hi {name}, thanks for calling {business}! If you'd like to discuss your project, reply or call us anytime.",
    },
    {
      days_after: 3,
      channel: 'email',
      subject: 'Your project estimate — {business}',
      template:
        "We wanted to follow up on your recent inquiry. We'd love to schedule a time to come out and provide a free estimate.",
    },
    {
      days_after: 7,
      channel: 'sms',
      template:
        'Hi {name}, just checking in from {business}. Ready to get your project started? Reply STOP to opt out.',
    },
  ],
  law_firm: [
    {
      days_after: 1,
      channel: 'sms',
      template:
        "Hi {name}, thanks for reaching out to {business}. If you'd like to schedule a consultation, reply or call us.",
    },
    {
      days_after: 3,
      channel: 'email',
      subject: 'Your consultation with {business}',
      template:
        'We wanted to follow up on your recent inquiry. We offer free initial consultations and would be happy to discuss your situation.',
    },
    {
      days_after: 7,
      channel: 'sms',
      template:
        "Hi {name}, just following up from {business}. We're here when you're ready to talk. Reply STOP to opt out.",
    },
  ],
  real_estate: [
    {
      days_after: 1,
      channel: 'sms',
      template:
        "Hi {name}, thanks for calling {business}! We'd love to help you find the perfect property. Reply or call anytime.",
    },
    {
      days_after: 3,
      channel: 'email',
      subject: 'New listings for you — {business}',
      template:
        "We wanted to follow up on your recent inquiry. We have some great properties that might interest you. Let us know when you'd like to schedule a viewing.",
    },
    {
      days_after: 7,
      channel: 'sms',
      template:
        'Hi {name}, new listings just dropped at {business}. Ready to schedule a showing? Reply STOP to opt out.',
    },
  ],
}

export const MAX_FOLLOW_UP_STEPS = 3

export const VERTICAL_AVG_APPOINTMENT_VALUE: Record<string, number> = {
  dental: 150,
  salon: 80,
  restaurant: 50,
  contractor: 500,
  law_firm: 300,
  real_estate: 1000,
  sales_crm: 200,
}
