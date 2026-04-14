import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Nuatis — AI-Powered Tools for Small Businesses',
  description: 'Voice AI receptionist, CRM, automation, and more. Built for SMBs by Nuatis LLC.',
}

const PRODUCTS = [
  {
    name: 'Maya AI',
    tagline: 'AI-powered virtual receptionist',
    features: ['24/7 call answering', 'Google Calendar booking', 'Multilingual', '7 industries'],
    status: 'Live',
    statusColor: 'bg-green-50 text-green-700',
    icon: '📞',
    cta: 'Try Maya',
    href: '/maya',
  },
  {
    name: 'Nuatis Suite',
    tagline: 'Complete front-office CRM',
    features: [
      'Maya AI included',
      'Contact & pipeline CRM',
      'Automation & follow-ups',
      'Quotes & analytics',
    ],
    status: 'Live',
    statusColor: 'bg-green-50 text-green-700',
    icon: '🏢',
    cta: 'Get Started',
    href: '/sign-up?product=suite',
  },
  {
    name: 'SAVIQ',
    tagline: 'AI expense tracker',
    features: ['Receipt scanning', 'Spending insights', 'Budget management'],
    status: 'Coming Soon',
    statusColor: 'bg-amber-50 text-amber-700',
    icon: '💰',
    cta: 'Learn More',
    href: 'https://github.com/siddhu6064/SAVIQ',
    external: true,
  },
  {
    name: 'Reel Routes',
    tagline: 'Travel planning reimagined',
    features: ['Trip planning', 'Route optimization', 'Social sharing'],
    status: 'Coming Soon',
    statusColor: 'bg-amber-50 text-amber-700',
    icon: '🗺️',
    cta: 'Coming Soon',
    href: '#',
    disabled: true,
  },
]

export default function ProductsPage() {
  return (
    <>
      {/* Hero */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-teal-600 flex items-center justify-center">
              <span className="text-white text-lg font-bold">N</span>
            </div>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            AI-powered tools for small businesses
          </h1>
          <p className="text-lg text-gray-500 max-w-xl mx-auto">
            From voice AI to expense tracking &mdash; tools that work while you sleep.
          </p>
        </div>
      </section>

      {/* Products */}
      <section className="pb-20 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {PRODUCTS.map((p) => (
            <div
              key={p.name}
              className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col hover:border-teal-200 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">{p.icon}</span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${p.statusColor}`}
                >
                  {p.status}
                </span>
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">{p.name}</h2>
              <p className="text-sm text-gray-500 mb-4">{p.tagline}</p>
              <ul className="text-sm text-gray-600 space-y-1.5 mb-6 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="text-teal-500 text-xs">&#10003;</span> {f}
                  </li>
                ))}
              </ul>
              {p.disabled ? (
                <span className="block text-center py-2.5 text-sm text-gray-300 bg-gray-50 rounded-lg cursor-not-allowed">
                  {p.cta}
                </span>
              ) : p.external ? (
                <a
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center py-2.5 text-sm font-medium text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 transition-colors"
                >
                  {p.cta} &rarr;
                </a>
              ) : (
                <Link
                  href={p.href}
                  className="block text-center py-2.5 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
                >
                  {p.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-3">About Nuatis LLC</h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            Solo-founded and Texas-based, Nuatis builds AI tools that make enterprise-grade
            technology accessible to every small business. Our mission: let business owners focus on
            what they do best while AI handles the rest.
          </p>
          <p className="text-xs text-gray-400 mt-4">
            Built by{' '}
            <a
              href="https://github.com/siddhu6064"
              className="text-teal-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sid Yennamaneni
            </a>
          </p>
        </div>
      </section>
    </>
  )
}
