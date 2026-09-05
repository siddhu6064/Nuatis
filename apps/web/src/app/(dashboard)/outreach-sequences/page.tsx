import OutreachSequencesClient from './OutreachSequencesClient'

export default function OutreachSequencesPage() {
  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Outreach Sequences</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Multi-step nurture you define — enroll any contact and they'll get each step
          automatically, spaced by however many days you set.
        </p>
      </div>

      <OutreachSequencesClient />
    </div>
  )
}
