import Link from 'next/link';
import {
  BoltIcon,
  ClockIcon,
  HomeIcon,
  MailIcon,
  PhoneIcon,
  PinIcon,
  ShieldIcon,
  WhatsAppIcon,
  WrenchIcon,
} from '@/components/icons';
import { ButtonLink } from '@/components/ui/button';
import { Section, SectionHeading } from '@/components/ui/section';
import { getServerConfig } from '@/lib/config';
import { buildQuoteRequestMessage, buildWhatsAppLink } from '@/lib/whatsapp';

/** Service list as published on the Contractors Guild brand sheet. */
export const SERVICES = [
  {
    title: 'Fault Finding',
    description:
      'Tripping breakers, dead circuits, burning smells — we trace the fault and explain exactly what failed before anything is replaced.',
    Icon: BoltIcon,
  },
  {
    title: 'Installations & Repairs',
    description:
      'Plugs, lights, geyser feeds, distribution boards, generator and inverter connections, plus repairs done to standard the first time.',
    Icon: WrenchIcon,
  },
  {
    title: 'Maintenance Services',
    description:
      'Scheduled inspections and preventative maintenance that keep a home or small business compliant, safe and running.',
    Icon: ClockIcon,
  },
  {
    title: 'Residential & Small Business',
    description:
      'From a single plug point to a full shop fit-out — residential homes, offices, workshops and retail spaces.',
    Icon: HomeIcon,
  },
  {
    title: 'Certified & Reliable',
    description:
      'Work carried out by qualified electricians, with clear quotes, test results and documentation you can hand to an insurer.',
    Icon: ShieldIcon,
  },
] as const;

export const REASONS = [
  {
    title: 'Safety First',
    description:
      'Every job is tested and left safe. No shortcuts, no live wires, no guesswork.',
    Icon: ShieldIcon,
  },
  {
    title: 'On Time Every Time',
    description:
      'We arrive when we say we will, and you get told immediately if anything changes.',
    Icon: ClockIcon,
  },
  {
    title: 'Built On Trust',
    description:
      'Fixed, itemised quotes approved before work starts. No surprise line items.',
    Icon: BoltIcon,
  },
  {
    title: 'Local. Reliable. Professional.',
    description:
      'A local team that answers the phone, follows up, and stands behind its workmanship.',
    Icon: PinIcon,
  },
] as const;

export function Hero() {
  const config = getServerConfig();
  const whatsappLink = buildWhatsAppLink(
    config.PUBLIC_CONTACT_WHATSAPP,
    buildQuoteRequestMessage()
  );

  return (
    <div className="relative overflow-hidden border-b border-ink-700 bg-ink-950">
      {/* Orange glow band: the poster's energy, expressed as gradient light
          rather than as a background image. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] h-[26rem] w-[26rem] rounded-full bg-ember-600/18 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-12rem] left-[-6rem] h-[22rem] w-[22rem] rounded-full bg-ember-500/10 blur-3xl"
      />

      <div className="cg-texture relative mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-3xl">
          <p className="cg-eyebrow">Powered by contractors. Built on trust.</p>
          <h1 className="cg-display mt-3 text-4xl text-paper sm:text-6xl lg:text-7xl">
            Electrical
            <span className="block text-ember-500">Problems?</span>
            We&apos;ve got the power
            <span className="block">to fix it.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-steel-300 sm:text-lg">
            Contractors Guild handles fault finding, installations, repairs and maintenance for
            homes and small businesses. Clear quotes, qualified work, and a team that turns up
            when it says it will.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <ButtonLink href="/request-quote" size="lg" className="w-full sm:w-auto">
              Request a quote
            </ButtonLink>
            <ButtonLink href="/contact" variant="secondary" size="lg" className="w-full sm:w-auto">
              Contact us
            </ButtonLink>
            <a
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border border-signal-success/40 bg-signal-success/10 px-6 text-sm font-semibold uppercase tracking-[0.06em] text-signal-success transition-colors hover:bg-signal-success/20 sm:w-auto"
            >
              <WhatsAppIcon className="h-5 w-5" />
              WhatsApp us
            </a>
          </div>

          <dl className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Fault finding', value: '24/7 response' },
              { label: 'Quotes', value: 'Itemised' },
              { label: 'Workmanship', value: 'Guaranteed' },
              { label: 'Coverage', value: 'Local & surrounds' },
            ].map((item) => (
              <div key={item.label} className="border-l-2 border-ember-600 pl-3">
                <dt className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-steel-500">
                  {item.label}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-paper">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

export function ServicesSection() {
  return (
    <Section id="services" tone="darker">
      <SectionHeading
        eyebrow="What we do"
        title="Straight-up electrical work"
        description="Whatever is tripping, sparking, dead or overdue for a check — we diagnose it, quote it, and fix it properly."
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((service) => (
          <article key={service.title} className="cg-card cg-card-raised p-5">
            <service.Icon className="h-8 w-8 text-ember-500" />
            <h3 className="mt-4 text-base font-bold uppercase tracking-wide text-paper">
              {service.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-steel-400">{service.description}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

export function WhyChooseUsSection() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Why choose Contractors Guild?"
        title="Built on trust, not on luck"
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {REASONS.map((reason) => (
          <article
            key={reason.title}
            className="cg-card cg-texture flex gap-4 p-5 transition-colors hover:border-ember-500/50"
          >
            <reason.Icon className="h-8 w-8 shrink-0 text-ember-500" />
            <div>
              <h3 className="text-base font-bold uppercase tracking-wide text-paper">
                {reason.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-steel-400">{reason.description}</p>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}

export function ContactSection({ withHeading = true }: { withHeading?: boolean }) {
  const config = getServerConfig();

  const items = [
    {
      label: 'Phone',
      value: config.PUBLIC_CONTACT_PHONE,
      href: `tel:${config.PUBLIC_CONTACT_PHONE.replace(/\s/g, '')}`,
      Icon: PhoneIcon,
    },
    {
      label: 'WhatsApp',
      value: 'Chat and book a slot',
      href: buildWhatsAppLink(config.PUBLIC_CONTACT_WHATSAPP, buildQuoteRequestMessage()),
      Icon: WhatsAppIcon,
    },
    {
      label: 'Email',
      value: config.PUBLIC_CONTACT_EMAIL,
      href: `mailto:${config.PUBLIC_CONTACT_EMAIL}`,
      Icon: MailIcon,
    },
  ] as const;

  return (
    <Section id="contact" tone="darker">
      {withHeading ? (
        <SectionHeading
          eyebrow="Get in touch"
          title="Let's get the power back on"
          description="Send us the problem, a photo or a description of the job. We respond with next steps and a quote."
        />
      ) : null}

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {items.map((item) => (
          <a
            key={item.label}
            href={item.href}
            target={item.label === 'WhatsApp' ? '_blank' : undefined}
            rel={item.label === 'WhatsApp' ? 'noopener noreferrer' : undefined}
            className="cg-card flex items-start gap-4 p-5 transition-colors hover:border-ember-500/60"
          >
            <item.Icon className="h-7 w-7 shrink-0 text-ember-500" />
            <span>
              <span className="cg-eyebrow">{item.label}</span>
              <span className="mt-1.5 block text-sm font-semibold text-paper">{item.value}</span>
            </span>
          </a>
        ))}
      </div>

      <div className="cg-card mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <PinIcon className="h-7 w-7 shrink-0 text-ember-500" />
          <div>
            <p className="cg-eyebrow">Workshop & base</p>
            <p className="mt-1.5 text-sm font-semibold text-paper">
              {config.PUBLIC_CONTACT_ADDRESS}
            </p>
            <p className="mt-1 text-xs text-steel-500">{config.PUBLIC_CONTACT_HOURS}</p>
          </div>
        </div>
        <ButtonLink href="/request-quote" className="w-full sm:w-auto">
          Request a quote
        </ButtonLink>
      </div>
    </Section>
  );
}

export function CtaBand() {
  return (
    <Section tone="panel" className="py-12">
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <p className="cg-eyebrow">Ready when you are</p>
          <h2 className="cg-display mt-2 text-2xl text-paper sm:text-3xl">
            Get an itemised quote today
          </h2>
          <p className="mt-2 text-sm text-steel-400">
            Approved work only — nothing starts until you accept the quote.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <ButtonLink href="/request-quote" size="lg" className="w-full sm:w-auto">
            Request a quote
          </ButtonLink>
          <Link
            href="/login"
            className="inline-flex min-h-14 w-full items-center justify-center rounded-lg border border-ink-600 px-6 text-sm font-semibold uppercase tracking-wide text-steel-300 transition-colors hover:border-ember-500 hover:text-paper sm:w-auto"
          >
            Contractor login
          </Link>
        </div>
      </div>
    </Section>
  );
}
