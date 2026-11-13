import Link from 'next/link';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

/**
 * Placeholder for screens that are planned but not built yet.
 *
 * It is deliberately explicit about what exists and what does not, rather than
 * showing fake data or a disabled interface that pretends to work.
 */
export function PhaseNotice({
  phase,
  title,
  description,
  planned,
  relatedSettings,
}: {
  phase: number;
  title: string;
  description: string;
  planned: string[];
  relatedSettings?: Array<{ href: string; label: string }>;
}) {
  return (
    <Card>
      <CardHeader title={title} description={`Planned for Phase ${phase} of the build`} />
      <CardBody className="space-y-4">
        <Alert tone="warning" title={`Not built yet`}>
          <p>{description}</p>
        </Alert>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-steel-500">
            What Phase {phase} will add
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm text-steel-300">
            {planned.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ember-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {relatedSettings?.length ? (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-steel-500">
              Available now
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {relatedSettings.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex rounded-md border border-ink-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-steel-300 hover:border-ember-500 hover:text-paper"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
