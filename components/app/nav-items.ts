import {
  CashIcon,
  ChartIcon,
  ClipboardIcon,
  CogIcon,
  DashboardIcon,
  DocumentIcon,
  UsersIcon,
} from '@/components/icons';

/**
 * Single source of truth for app navigation, shared by the desktop sidebar,
 * the mobile drawer and the mobile bottom bar.
 *
 * `phase` marks screens that are scheduled but not built yet, so the UI can be
 * honest about it instead of rendering a dead end.
 */
export type NavItem = {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  phase: number | null;
  primaryMobile?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/app', label: 'Dashboard', Icon: DashboardIcon, phase: null, primaryMobile: true },
  { href: '/app/customers', label: 'Customers', Icon: UsersIcon, phase: null, primaryMobile: true },
  { href: '/app/jobs', label: 'Jobs', Icon: ClipboardIcon, phase: null },
  { href: '/app/quotes', label: 'Quotes', Icon: DocumentIcon, phase: null, primaryMobile: true },
  { href: '/app/invoices', label: 'Invoices', Icon: DocumentIcon, phase: null, primaryMobile: true },
  { href: '/app/payments', label: 'Payments', Icon: CashIcon, phase: null },
  { href: '/app/reports', label: 'Reports', Icon: ChartIcon, phase: 6 },
  { href: '/app/settings', label: 'Settings', Icon: CogIcon, phase: null },
];

/**
 * The persistent + Create menu. `phase` is null for screens that are live;
 * entries that are still scheduled show their phase instead of pretending to
 * work.
 */
export const CREATE_ACTIONS: Array<{ href: string; label: string; phase: number | null }> = [
  { href: '/app/customers/new', label: 'New customer', phase: null },
  { href: '/app/jobs/new', label: 'New job', phase: null },
  { href: '/app/catalogue/new', label: 'New catalogue item', phase: null },
  { href: '/app/quotes/new', label: 'New quote', phase: null },
  { href: '/app/invoices/new', label: 'New invoice', phase: null },
  { href: '/app/payments/new', label: 'Record payment', phase: null },
];

export const SETTINGS_LINKS = [
  { href: '/app/settings', label: 'Business profile' },
  { href: '/app/catalogue', label: 'Products & services' },
  { href: '/app/settings/documents', label: 'Documents & numbering' },
  { href: '/app/settings/banking', label: 'Banking details' },
  { href: '/app/settings/profile', label: 'Your account' },
] as const;
