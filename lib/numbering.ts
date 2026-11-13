import type { PoolClient } from 'pg';

/**
 * Document numbering (QUOTE-0001, INV-0001, REC-0001, JOB-0001).
 *
 * Numbers are allocated inside the caller's transaction with a single
 * `insert ... on conflict do update`, which takes a row lock on
 * (business_id, doc_type). Two contractors quoting at the same moment can
 * never receive the same number, and a rolled-back quote does not burn a
 * number that was already handed to a customer.
 */
export type DocumentType = 'JOB' | 'QUOTE' | 'INVOICE' | 'RECEIPT';

export const DEFAULT_PREFIXES: Record<DocumentType, string> = {
  JOB: 'JOB-',
  QUOTE: 'QUOTE-',
  INVOICE: 'INV-',
  RECEIPT: 'REC-',
};

export const NUMBER_PADDING = 4;

export function formatDocumentNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(NUMBER_PADDING, '0')}`;
}

export async function allocateDocumentNumber(
  client: PoolClient,
  businessId: string,
  docType: DocumentType,
  preferredPrefix?: string
): Promise<string> {
  const prefix = preferredPrefix ?? DEFAULT_PREFIXES[docType];

  const { rows } = await client.query<{ next_number: number; prefix: string }>(
    `insert into document_sequences (business_id, doc_type, prefix, next_number)
     values ($1, $2, $3, 2)
     on conflict (business_id, doc_type) do update
       set next_number = document_sequences.next_number + 1,
           prefix = excluded.prefix,
           updated_at = now()
     returning next_number, prefix`,
    [businessId, docType, prefix]
  );

  const row = rows[0];
  if (!row) {
    throw new Error(`Could not allocate a ${docType} number for business ${businessId}`);
  }

  return formatDocumentNumber(row.prefix, row.next_number - 1);
}

/** Read-only peek used by settings screens and tests. */
export async function peekDocumentSequence(
  client: PoolClient,
  businessId: string,
  docType: DocumentType
): Promise<number> {
  const { rows } = await client.query<{ next_number: number }>(
    `select next_number from document_sequences where business_id = $1 and doc_type = $2`,
    [businessId, docType]
  );
  return rows[0]?.next_number ?? 1;
}
