import type { Metadata } from 'next';
import { CtaBand, ServicesSection, WhyChooseUsSection } from '@/components/marketing/sections';
import { Section, SectionHeading } from '@/components/ui/section';
import { Alert } from '@/components/ui/feedback';

export const metadata: Metadata = {
  title: 'Services',
  description:
    'Fault finding, installations and repairs, maintenance services, residential and small business electrical work.',
};

const DETAILS = [
  {
    title: 'Fault finding',
    items: [
      'Breakers that trip repeatedly',
      'Dead plugs, lights or circuits',
      'Burning smells, hot plugs, discoloured sockets',
      'Earth leakage tripping and nuisance faults',
      'Fault location before any replacement work',
    ],
  },
  {
    title: 'Installations & repairs',
    items: [
      'Plug points, light fittings and switches',
      'Distribution board repairs and upgrades',
      'Geyser, stove and oven connections',
      'Inverter, UPS and generator changeover connections',
      'Repairs after storm, water or rodent damage',
    ],
  },
  {
    title: 'Maintenance services',
    items: [
      'Scheduled inspections for homes and small businesses',
      'Preventative maintenance and load checks',
      'Compliance and safety checks',
      'Standby and security system maintenance',
      'Handover documentation after the visit',
    ],
  },
] as const;

export default function ServicesPage() {
  return (
    <>
      <Section tone="darker">
        <SectionHeading
          eyebrow="What we do"
          title="Electrical work, done properly"
          description="Residential and small business electrical work, from a single fault to a full installation."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {DETAILS.map((group) => (
            <article key={group.title} className="cg-card p-5">
              <h3 className="cg-display text-xl text-paper">{group.title}</h3>
              <div className="cg-divider my-4" />
              <ul className="space-y-2.5 text-sm text-steel-300">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ember-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <ServicesSection />
      <WhyChooseUsSection />

      <Section tone="panel">
        <Alert tone="ember" title="Emergency and after-hours work">
          <p>
            Faults get worse when they are left. Send a WhatsApp message with a photo of the
            affected board or fitting and we will tell you what to switch off while you wait.
          </p>
        </Alert>
      </Section>

      <CtaBand />
    </>
  );
}
