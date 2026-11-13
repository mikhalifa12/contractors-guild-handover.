import type { Metadata } from 'next';
import { ContactSection, CtaBand } from '@/components/marketing/sections';
import { Section, SectionHeading } from '@/components/ui/section';
import { Alert } from '@/components/ui/feedback';
import { getServerConfig } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Phone, WhatsApp and email contact details for Contractors Guild electrical services.',
};

export default function ContactPage() {
  const config = getServerConfig();

  return (
    <>
      <Section tone="darker">
        <SectionHeading
          eyebrow="Get in touch"
          title="Tell us what needs fixing"
          description="The fastest route is WhatsApp — send a photo of the fault, the board or the room and we can usually tell you what to expect before we arrive."
        />

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Phone', value: config.PUBLIC_CONTACT_PHONE, href: `tel:${config.PUBLIC_CONTACT_PHONE.replace(/\s/g, '')}` },
            { label: 'Email', value: config.PUBLIC_CONTACT_EMAIL, href: `mailto:${config.PUBLIC_CONTACT_EMAIL}` },
            { label: 'Working hours', value: config.PUBLIC_CONTACT_HOURS },
          ].map((item) => (
            <div key={item.label} className="cg-card p-5">
              <p className="cg-eyebrow">{item.label}</p>
              {item.href ? (
                <a href={item.href} className="mt-2 block text-sm font-semibold text-paper hover:text-ember-400">
                  {item.value}
                </a>
              ) : (
                <p className="mt-2 text-sm font-semibold text-paper">{item.value}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Alert tone="info" title="What to send us">
            <ul className="space-y-1.5">
              <li>• A photo of the fault, board or fitting if you can.</li>
              <li>• The address or area where the work is needed.</li>
              <li>• Whether it is urgent (no power, burning smell, water near wiring).</li>
              <li>• Anything already tried or replaced.</li>
            </ul>
          </Alert>
        </div>
      </Section>

      <ContactSection withHeading={false} />
      <CtaBand />
    </>
  );
}
