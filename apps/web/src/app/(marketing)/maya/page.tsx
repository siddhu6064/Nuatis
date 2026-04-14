import type { Metadata } from 'next'
import Link from 'next/link'
import MayaFAQ from './MayaFAQ'

export const metadata: Metadata = {
  title: 'Maya AI — AI Virtual Receptionist for Small Businesses',
  description:
    '24/7 AI phone answering that books appointments on your Google Calendar. Built for dental, salon, contractor, law firm, real estate, and more. From $49/mo.',
  openGraph: {
    title: 'Maya AI — Your 24/7 Virtual Receptionist',
    description:
      'AI-powered phone answering that books appointments, answers questions, and never misses a call.',
    type: 'website',
  },
}

const FEATURES = [
  {
    icon: '📞',
    title: 'Answers Every Call',
    desc: 'Maya picks up instantly, 24/7/365. No voicemail, no missed customers.',
  },
  {
    icon: '📅',
    title: 'Books Appointments',
    desc: 'Checks your Google Calendar in real-time and books directly. Sends SMS confirmation.',
  },
  {
    icon: '🌐',
    title: 'Speaks Their Language',
    desc: 'Automatic language detection. English, Spanish, Hindi, Telugu and more.',
  },
  {
    icon: '🧠',
    title: 'Knows Your Business',
    desc: 'Upload FAQs and Maya answers customer questions accurately.',
  },
  {
    icon: '🔄',
    title: 'Smart Escalation',
    desc: 'Transfers to you when needed. Sends SMS heads-up before connecting.',
  },
  {
    icon: '📊',
    title: 'Call Intelligence',
    desc: 'Full call logs with outcome tracking, tool usage, and quality scores.',
  },
]

const STEPS = [
  {
    num: '1',
    title: 'Sign up & pick your industry',
    desc: 'Choose from 7 verticals. Maya customizes her persona.',
  },
  {
    num: '2',
    title: 'Connect your calendar',
    desc: 'Link Google Calendar. Maya checks availability in real-time.',
  },
  {
    num: '3',
    title: 'Get your phone number',
    desc: 'We provision a local Texas number. Forward your business line or use it directly.',
  },
]

const VERTICALS = [
  { icon: '🦷', name: 'Dental', desc: 'Patient scheduling, insurance questions, emergency triage' },
  { icon: '✂️', name: 'Salon', desc: 'Stylist booking, service inquiries, rescheduling' },
  { icon: '🍽️', name: 'Restaurant', desc: 'Reservations, catering inquiries, hours & menu' },
  { icon: '🔧', name: 'Contractor', desc: 'Estimate scheduling, project inquiries, callbacks' },
  { icon: '⚖️', name: 'Law Firm', desc: 'Consultation booking, intake, conflict checks' },
  {
    icon: '🏠',
    name: 'Real Estate',
    desc: 'Showing scheduling, listing inquiries, buyer qualification',
  },
  { icon: '📊', name: 'Sales', desc: 'Demo booking, product questions, lead capture' },
]

export default function MayaLandingPage() {
  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'Maya AI',
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            offers: { '@type': 'Offer', price: '49', priceCurrency: 'USD' },
          }),
        }}
      />

      {/* Hero */}
      <section className="py-20 md:py-28 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-teal-50 rounded-full text-xs text-teal-700 font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
            Now live &middot; 7 industries supported
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 leading-tight mb-4">
            Maya AI &mdash; Your 24/7
            <br />
            Virtual Receptionist
          </h1>
          <p className="text-lg text-gray-500 mb-8 max-w-xl mx-auto">
            AI-powered phone answering that books appointments, answers questions, and never misses
            a call. Works with your Google Calendar.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/sign-up?product=maya_only"
              className="px-6 py-3 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors"
            >
              Start Free Trial
            </Link>
            <a
              href="#how-it-works"
              className="px-6 py-3 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              See how it works &darr;
            </a>
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="border-y border-gray-100 bg-gray-50 py-6 px-6">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-8 text-center">
          {[
            ['< 1.5s', 'response time'],
            ['$0.008', 'per call'],
            ['7', 'industries'],
            ['4', 'languages'],
          ].map(([value, label]) => (
            <div key={label}>
              <p className="text-lg font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-12">
            Everything a receptionist does. None of the overhead.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="p-6 rounded-xl border border-gray-100 hover:border-teal-100 hover:bg-teal-50/30 transition-colors"
              >
                <span className="text-2xl mb-3 block">{f.icon}</span>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-6 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-12">
            Up and running in 5 minutes
          </h2>
          <div className="space-y-8">
            {STEPS.map((s) => (
              <div key={s.num} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                  {s.num}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">{s.title}</h3>
                  <p className="text-sm text-gray-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Verticals */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-4">
            Built for your industry
          </h2>
          <p className="text-sm text-gray-500 text-center mb-12">
            Maya customizes her tone, knowledge, and booking flow for your business type.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {VERTICALS.map((v) => (
              <div
                key={v.name}
                className="p-4 rounded-xl border border-gray-100 text-center hover:border-teal-200 transition-colors"
              >
                <span className="text-2xl block mb-2">{v.icon}</span>
                <p className="text-sm font-semibold text-gray-900">{v.name}</p>
                <p className="text-xs text-gray-400 mt-1">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6 bg-gray-50">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">Simple pricing</h2>
          <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
            <p className="text-xs text-teal-600 font-semibold uppercase tracking-wide mb-2">
              Maya AI
            </p>
            <div className="flex items-end justify-center gap-1 mb-4">
              <span className="text-4xl font-bold text-gray-900">$49</span>
              <span className="text-sm text-gray-400 mb-1">/mo</span>
            </div>
            <ul className="text-sm text-gray-600 space-y-2 mb-6 text-left">
              {[
                'Unlimited calls',
                'Google Calendar booking',
                'SMS confirmations',
                'Call logs & analytics',
                'Knowledge base (FAQ)',
                'Multilingual (4 languages)',
                '7 industry verticals',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="text-teal-500">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/sign-up?product=maya_only"
              className="block w-full py-3 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-colors"
            >
              Start Free Trial
            </Link>
          </div>
          <div className="mt-6 p-4 bg-white rounded-xl border border-gray-100">
            <p className="text-sm text-gray-600">
              Want full CRM with pipeline, automation, and quotes?
            </p>
            <Link href="/upgrade" className="text-sm text-teal-600 font-medium hover:text-teal-700">
              Compare plans &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-6">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
            Frequently asked questions
          </h2>
          <MayaFAQ />
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-6 bg-teal-600">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Ready to never miss a call again?</h2>
          <p className="text-teal-100 mb-8">
            Join businesses across Texas who trust Maya to handle their calls 24/7.
          </p>
          <Link
            href="/sign-up?product=maya_only"
            className="inline-block px-8 py-3 bg-white text-teal-700 text-sm font-semibold rounded-lg hover:bg-teal-50 transition-colors"
          >
            Start Free Trial
          </Link>
          <p className="text-teal-200 text-xs mt-4">Or call our demo line: +1 (512) 737-6388</p>
        </div>
      </section>
    </>
  )
}
