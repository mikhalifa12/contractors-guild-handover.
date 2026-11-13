import '@/tests/helpers/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    cookies: async () => mocks.cookieStore,
    headers: async () => mocks.headersList,
  };
});

vi.mock('next/navigation', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    redirect: (url: string): never => {
      throw new mocks.RedirectSignal(url);
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { withContext } from '@/lib/db';
import { allocateDocumentNumber } from '@/lib/numbering';
import { clearRateLimits } from '@/lib/security/rate-limit';
import { cookieStore } from '@/tests/helpers/next-mocks';
import { countRows, resetDatabase, withAdminClient } from '@/tests/helpers/env';
import { createCustomer, registerOwner, type RegisteredOwner } from '@/tests/helpers/owners';

async function insertCustomer(owner: RegisteredOwner, name: string): Promise<void> {
  await createCustomer(owner, name);
}

describe('tenant isolation (row level security)', () => {
  let businessA: RegisteredOwner;
  let businessB: RegisteredOwner;

  beforeEach(async () => {
    await resetDatabase();
    cookieStore.clear();
    clearRateLimits();
    businessA = await registerOwner({ businessName: 'Alpha Electrical' });
    businessB = await registerOwner({ businessName: 'Bravo Electrical' });
  });

  it('gives every business its own document sequence', async () => {
    const [aFirst, aSecond, bFirst] = await Promise.all([
      withContext({ userId: businessA.userId, businessId: businessA.businessId }, (client) =>
        allocateDocumentNumber(client, businessA.businessId, 'QUOTE', 'QUOTE-')
      ),
      withContext({ userId: businessA.userId, businessId: businessA.businessId }, (client) =>
        allocateDocumentNumber(client, businessA.businessId, 'QUOTE', 'QUOTE-')
      ),
      withContext({ userId: businessB.userId, businessId: businessB.businessId }, (client) =>
        allocateDocumentNumber(client, businessB.businessId, 'QUOTE', 'QUOTE-')
      ),
    ]);

    expect([aFirst, aSecond].sort()).toEqual(['QUOTE-0001', 'QUOTE-0002']);
    expect(bFirst).toBe('QUOTE-0001');
  });

  it('keeps customer records invisible across businesses', async () => {
    await insertCustomer(businessA, 'Alpha Client (Pty) Ltd');

    const visibleToA = await withContext(
      { userId: businessA.userId, businessId: businessA.businessId },
      async (client) => (await client.query(`select id from customers`)).rowCount
    );
    const visibleToB = await withContext(
      { userId: businessB.userId, businessId: businessB.businessId },
      async (client) => (await client.query(`select id from customers`)).rowCount
    );

    expect(visibleToA).toBe(1);
    expect(visibleToB).toBe(0);
  });

  it('requires an active membership, not just a business id', async () => {
    await insertCustomer(businessA, 'Alpha Client (Pty) Ltd');

    // Business A's user with business B's id in the context: membership check fails.
    const rows = await withContext(
      { userId: businessA.userId, businessId: businessB.businessId },
      async (client) => (await client.query(`select id from customers`)).rowCount
    );
    expect(rows).toBe(0);

    // Business B's user pointed at business A's data: also nothing.
    const crossRows = await withContext(
      { userId: businessB.userId, businessId: businessA.businessId },
      async (client) => (await client.query(`select id from customers`)).rowCount
    );
    expect(crossRows).toBe(0);
  });

  it('returns nothing at all when no tenant context is set', async () => {
    await insertCustomer(businessA, 'Alpha Client (Pty) Ltd');

    const rows = await withContext({}, async (client) => {
      const customers = await client.query(`select id from customers`);
      const businesses = await client.query(`select id from businesses`);
      const invoices = await client.query(`select id from invoices`);
      return { customers: customers.rowCount, businesses: businesses.rowCount, invoices: invoices.rowCount };
    });

    expect(rows).toEqual({ customers: 0, businesses: 0, invoices: 0 });
  });

  it('refuses to write a row that belongs to another business', async () => {
    await expect(
      withContext({ userId: businessB.userId, businessId: businessB.businessId }, async (client) => {
        await client.query(
          `insert into customers (business_id, customer_type, business_name)
           values ($1, 'BUSINESS', 'Smuggled customer')`,
          [businessA.businessId]
        );
      })
    ).rejects.toThrow(/row-level security/i);

    expect(await countRows('customers')).toBe(0);
  });

  it('hides one business user from another', async () => {
    const usersVisible = await withContext(
      { userId: businessA.userId, businessId: businessA.businessId },
      async (client) => (await client.query(`select id from users`)).rowCount
    );
    expect(usersVisible).toBe(1);

    const otherUser = await withContext(
      { userId: businessA.userId, businessId: businessA.businessId },
      async (client) =>
        (await client.query(`select id from users where id = $1`, [businessB.userId])).rowCount
    );
    expect(otherUser).toBe(0);
  });

  it('never lets an application session read or update a foreign profile', async () => {
    const result = await withContext(
      { userId: businessA.userId, businessId: businessA.businessId },
      async (client) => {
        const read = await client.query(`select id from users where id = $1`, [businessB.userId]);
        const write = await client.query(`update users set full_name = 'Hacked' where id = $1`, [
          businessB.userId,
        ]);
        return { read: read.rowCount, write: write.rowCount };
      }
    );

    expect(result).toEqual({ read: 0, write: 0 });
    expect(await countRows('users', `full_name = 'Hacked'`)).toBe(0);
  });

  it('denies hard deletes of business records', async () => {
    await insertCustomer(businessA, 'Alpha Client (Pty) Ltd');

    const deleted = await withContext(
      { userId: businessA.userId, businessId: businessA.businessId },
      async (client) => (await client.query(`delete from customers`)).rowCount
    );

    expect(deleted).toBe(0);
    expect(await countRows('customers')).toBe(1);
  });

  it('runs the application role without superuser or bypassrls privileges', async () => {
    const role = await withContext({}, async (client) => {
      const { rows } = await client.query<{
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `select current_user, r.rolsuper, r.rolbypassrls
           from pg_roles r where r.rolname = current_user`
      );
      return rows[0];
    });

    expect(role?.rolsuper).toBe(false);
    expect(role?.rolbypassrls).toBe(false);
    expect(role?.current_user).not.toBe('cg_admin');
  });

  it('keeps the audit trail append-only for the application role', async () => {
    await withContext({ userId: businessA.userId, businessId: businessA.businessId }, async (client) => {
      await client.query(
        `insert into audit_events (business_id, user_id, event_type) values ($1, $2, 'test.event')`,
        [businessA.businessId, businessA.userId]
      );
    });

    const tampered = await withContext(
      { userId: businessA.userId, businessId: businessA.businessId },
      async (client) => {
        const updated = await client.query(`update audit_events set event_type = 'changed'`);
        const removed = await client.query(`delete from audit_events`);
        return { updated: updated.rowCount, removed: removed.rowCount };
      }
    );

    expect(tampered).toEqual({ updated: 0, removed: 0 });
    expect(await countRows('audit_events', `event_type = 'test.event'`)).toBe(1);
  });

  it('does not leak tenants through the admin connection (migration role only)', async () => {
    // Sanity check that the isolation above comes from the app role: the
    // migration role bypasses RLS by design (and is never used by the app).
    const adminSees = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ current_user: string; can_bypass: boolean }>(
        `select current_user, (rolsuper or rolbypassrls) as can_bypass
           from pg_roles where rolname = current_user`
      );
      return rows[0];
    });

    expect(adminSees?.can_bypass).toBe(true);
  });
});
