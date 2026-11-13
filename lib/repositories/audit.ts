import type { PoolClient } from 'pg';
import { withContext } from '@/lib/db';

/**
 * Audit trail writes and reads.
 *
 * The table is append-only for the application role (no update or delete
 * policy), which is why the write helper takes a client: it always runs inside
 * the same transaction as the change it describes, so an audit row can never
 * exist without its change, or the other way round.
 */
export type AuditEventInput = {
  businessId: string;
  userId: string;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
};

export async function recordAuditEvent(
  client: PoolClient,
  event: AuditEventInput
): Promise<void> {
  await client.query(
    `insert into audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata, ip_address)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      event.businessId,
      event.userId,
      event.eventType,
      event.entityType ?? null,
      event.entityId ?? null,
      JSON.stringify(event.metadata ?? {}),
      event.ipAddress ?? null,
    ]
  );
}

export type ActivityRow = {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  actor_name: string | null;
};

/** Timeline for one record (customer, job, quote, invoice). */
export async function listEntityActivity(
  businessId: string,
  userId: string,
  entityType: string,
  entityId: string,
  limit = 20
): Promise<ActivityRow[]> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<ActivityRow>(
      `select e.id, e.event_type, e.entity_type, e.entity_id, e.metadata, e.created_at,
              u.full_name as actor_name
         from audit_events e
         left join users u on u.id = e.user_id
        where e.entity_type = $1 and e.entity_id = $2
        order by e.created_at desc
        limit $3`,
      [entityType, entityId, limit]
    );
    return rows;
  });
}
