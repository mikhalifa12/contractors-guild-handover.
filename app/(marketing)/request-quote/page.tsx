import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { WhatsAppIcon } from '@/components/icons';
import { Section, SectionHeading } from '@/components/ui/section';
import { getServerConfig } from '@/lib/config';
import { buildQuoteRequestMessage, buildWhatsAppLink } from '@/lib/whatsapp';

export const metadata: Metadata = {
  title: 'Request a quote',
  description:
    'Request an itemised electrical quote from Contractors Guild. No work starts until you accept the quote.',
};

export default function RequestQuotePage() {
  const config = getServerConfig();
  const whatsappLink = buildWhatsAppLink(
    config.PUBLIC_CONTACT_WHATSAPP,
    buildQuoteRequestMessage()
  );

  return (
    <Section tone="darker">
      <SectionHeading
        eyebrow="Request a quote"
        title="Get it in writing before anyone picks up a tool"
        description="Send us the job details and we reply with an itemised quote: parts, labour, tax and the total, plus how long the price holds."
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="cg-card cg-texture p-6">
          <h2 className="cg-display text-xl text-paper">Start on WhatsApp</h2>
          <div className="cg-divider my-4" />
          <p className="text-sm leading-relaxed text-steel-400">
            WhatsApp is the fastest way to reach the team: send the details, attach a photo, and we
            reply with questions or the quote. Prefer to talk? Call the number below during working
            hours.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-lg bg-signal-success px-6 text-sm font-bold uppercase tracking-[0.06em] text-ink-950 transition-opacity hover:opacity-90"
            >
              <WhatsAppIcon className="h-5 w-5" />
              Send job details on WhatsApp
            </a>
            <ButtonLink
              href={`tel:${config.PUBLIC_CONTACT_PHONE.replace(/\s/g, '')}`}
              variant="secondary"
              size="lg"
            >
              Call {config.PUBLIC_CONTACT_PHONE}
            </ButtonLink>
          </div>

          <div className="mt-6">
            <Alert tone="warning" title="Online quote requests">
              <p>
                This page is the public hand-off point: it opens WhatsApp with your details so
                nothing gets lost between a web form and a phone. Capturing web enquiries directly
                into the contractor platform is scheduled for Phase 3 (quote system) — until then
                we do not pretend a form was submitted successfully when nothing was recorded.
              </p>
            </Alert>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="cg-card p-5">
            <h2 className="cg-eyebrow">What happens next</h2>
            <ol className="mt-3 space-y-3 text-sm text-steel-300">
              {[
                'We read the details and may ask one or two questions.',
                'You receive an itemised quote with a validity date.',
                'Accept the quote and we schedule the work.',
                'Work is done, invoiced, and you get a receipt for every payment.',
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ember-500/15 text-xs font-bold text-ember-300">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="cg-card p-5">
            <h2 className="cg-eyebrow">Good to know</h2>
            <ul className="mt-3 space-y-2 text-sm text-steel-400">
              <li>Quotes are itemised — parts and labour listed separately.</li>
              <li>No work starts before you accept the quote.</li>
              <li>Cancellations before the scheduled date are free.</li>
              <li>Certificates and test results are supplied where applicable.</li>
            </ul>
          </div>

          <div className="cg-card p-5">
            <h2 className="cg-eyebrow">Other ways to reach us</h2>
            <p className="mt-3 text-sm text-steel-400">
              Email{' '}
              <a className="text-paper hover:text-ember-400" href={`mailto:${config.PUBLIC_CONTACT_EMAIL}`}>
                {config.PUBLIC_CONTACT_EMAIL}
              </a>
              <br />
              {config.PUBLIC_CONTACT_ADDRESS}
            </p>
          </div>
        </aside>
      </div>
    </Section>
  );
}
