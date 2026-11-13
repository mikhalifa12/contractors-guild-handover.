import type { Metadata } from 'next';
import {
  ContactSection,
  CtaBand,
  Hero,
  ServicesSection,
  WhyChooseUsSection,
} from '@/components/marketing/sections';
import { Section, SectionHeading } from '@/components/ui/section';

export const metadata: Metadata = {
  title: 'Electrical fault finding, installations and repairs',
  description:
    'Contractors Guild does electrical fault finding, installations, repairs and maintenance for homes and small businesses. Itemised quotes, qualified work, on time every time.',
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <ServicesSection />
      <WhyChooseUsSection />

      <Section tone="panel">
        <SectionHeading
          eyebrow="How we work"
          title="Quote first. Work second. Invoice only once you are happy."
          description="Every job follows the same order so there are no surprises on the invoice."
        />
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: '01',
              title: 'Tell us the problem',
              body: 'Send a message, a photo or a description of the fault. We ask what we need to know.',
            },
            {
              step: '02',
              title: 'Get an itemised quote',
              body: 'Parts, labour and totals on one page, with a validity date and payment terms.',
            },
            {
              step: '03',
              title: 'Accept and schedule',
              body: 'Nothing starts until you accept the quote. Then we book the work in.',
            },
            {
              step: '04',
              title: 'Invoice and receipt',
              body: 'Work is invoiced, payments are recorded, and you get a receipt for every payment.',
            },
          ].map((item) => (
            <li key={item.step} className="cg-card p-5">
              <span className="cg-display text-3xl text-ember-500">{item.step}</span>
              <h3 className="mt-3 text-sm font-bold uppercase tracking-wide text-paper">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-steel-400">{item.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <ContactSection />
      <CtaBand />
    </>
  );
}
