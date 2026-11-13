import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { humaniseEnum } from '@/lib/format';

type Tone = 'default' | 'ember' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  default: 'cg-badge',
  ember: 'cg-badge cg-badge-ember',
  success: 'cg-badge cg-badge-success',
  warning: 'cg-badge cg-badge-warning',
  danger: 'cg-badge cg-badge-danger',
  info: 'cg-badge cg-badge-info',
};

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return <span className={cn(TONE_CLASSES[tone], className)}>{children}</span>;
}

/** Maps document and job statuses to a colour and a readable label. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge>Unknown</Badge>;

  const tone: Tone = (() => {
    switch (status) {
      case 'PAID':
      case 'ACCEPTED':
      case 'COMPLETED':
      case 'APPROVED':
        return 'success';
      case 'PARTIALLY_PAID':
      case 'VIEWED':
      case 'SENT':
      case 'SCHEDULED':
      case 'IN_PROGRESS':
      case 'QUOTED':
        return 'info';
      case 'OVERDUE':
      case 'DECLINED':
      case 'CANCELLED':
      case 'EXPIRED':
        return 'danger';
      case 'DRAFT':
        return 'warning';
      case 'CONVERTED':
        return 'ember';
      default:
        return 'default';
    }
  })();

  return <Badge tone={tone}>{humaniseEnum(status)}</Badge>;
}
