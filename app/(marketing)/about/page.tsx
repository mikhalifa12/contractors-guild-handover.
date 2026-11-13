import type { Metadata } from 'next';
import { CtaBand, WhyChooseUsSection } from '@/components/marketing/sections';
import { Section, SectionHeading } from '@/components/ui/section';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Contractors Guild is a contractor-first electrical business: itemised quotes, qualified work, and a platform built by contractors.',
};

export default function AboutPage() {
  return (
    <>
      <Section tone="darker">
        <SectionHeading
          eyebrow="About us"
          title="Powered by contractors. Built on trust."
          description="Contractors Guild exists because good tradespeople are let down by paperwork — and customers are let down by unclear quotes."
        />

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 text-sm leading-relaxed text-steel-300">
            <p>
              We are a local electrical team working on homes, offices, workshops and small
              retail spaces. Fault finding, installations, repairs and maintenance — the work
              that keeps a building safe and running.
            </p>
            <p>
              Every job starts with an itemised quote: parts, labour, tax and total on one page,
              with a validity date and clear payment terms. Nothing starts until the quote is
              accepted, and the invoice matches the quote that was approved.
            </p>
            <p>
              This platform is part of the same idea. Instead of quotes written on a phone at
              midnight and invoices that never get sent, contractors get proper documents,
              recorded payments and a customer history they can actually trust.
            </p>
          </div>

          <div className="cg-card cg-texture p-6">
            <h3 className="cg-eyebrow">What we stand for</h3>
            <div className="cg-divider my-4" />
            <ul className="space-y-4 text-sm text-steel-300">
              {[
                {
                  title: 'Safety first',
                  body: 'Tested work, correct protection, no shortcuts that put a family at risk.',
                },
                {
                  title: 'On time every time',
                  body: 'If a job moves, you hear it from us first — not from an empty driveway.',
                },
                {
                  title: 'Built on trust',
                  body: 'Fixed quotes approved before work. No surprise line items afterwards.',
                },
                {
                  title: 'Local. Reliable. Professional.',
                  body: 'A local team that answers the phone and stands behind its workmanship.',
                },
              ].map((value) => (
                <li key={value.title} className="border-l-2 border-ember-600 pl-3">
                  <p className="font-semibold text-paper">{value.title}</p>
                  <p className="mt-1 text-steel-400">{value.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <WhyChooseUsSection />
      <CtaBand />
    </>
  );
}
