import { types } from 'pg';

/**
 * Keep values in the exact shape the UI and the PDF renderer expect:
 *  - DATE stays a plain 'YYYY-MM-DD' string (never a timezone-shifted Date)
 *  - NUMERIC stays a decimal string so money never passes through a float
 *  - TIMESTAMPTZ becomes a JS Date in UTC
 */
let configured = false;

export function configurePgTypeParsers(): void {
  if (configured) return;
  configured = true;

  const DATE_OID = 1082;
  const NUMERIC_OID = 1700;
  const INT8_OID = 20;

  types.setTypeParser(DATE_OID, (value: string) => value);
  types.setTypeParser(NUMERIC_OID, (value: string) => value);
  types.setTypeParser(INT8_OID, (value: string) => value);
}
