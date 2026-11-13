import { registerAction } from '@/lib/actions/auth';
import { withContext } from '@/lib/db';
import { expectRedirect, formData, runAction } from '@/tests/helpers/actions';
import { withAdminClient } from '@/tests/helpers/env';

export type RegisteredOwner = {
  email: string;
  password: string;
  userId: string;
  businessId: string;
};

export const TEST_PASSWORD = 'guild-strong-password';

/** Register a business owner through the real Server Action. */
export async function registerOwner(
  overrides: { email?: string; businessName?: string; password?: string } = {}
): Promise<RegisteredOwner> {
  const email = (overrides.email ?? `owner-${crypto.randomUUID()}@example.com`).toLowerCase();
  const password = overrides.password ?? TEST_PASSWORD;

  const outcome = await runAction(
    registerAction,
    formData({
      fullName: 'Test Contractor',
      email,
      password,
      confirmPassword: password,
      businessName: overrides.businessName ?? `Test Electrical ${crypto.randomUUID().slice(0, 6)}`,
      tradingName: '',
      phone: '+27 82 000 0000',
    })
  );
  expectRedirect(outcome, '/app/onboarding');

  const ids = await withAdminClient(async (client) => {
    const { rows } = await client.query<{ user_id: string; business_id: string }>(
      `select bu.user_id, bu.business_id
         from public.business_users bu
         join public.users u on u.id = bu.user_id
        where u.email = $1`,
      [email]
    );
    return rows[0];
  });

  if (!ids) throw new Error(`Registration did not create a membership for ${email}`);

  return { email, password, userId: ids.user_id, businessId: ids.business_id };
}

/** Insert a customer inside a tenant context (stands in for Phase 2 UI). */
export async function createCustomer(
  owner: RegisteredOwner,
  name: string
): Promise<string> {
  return withContext(
    { userId: owner.userId, businessId: owner.businessId },
    async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into customers (business_id, customer_type, business_name, created_by)
         values ($1, 'BUSINESS', $2, $3)
         returning id`,
        [owner.businessId, name, owner.userId]
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('Customer insert returned no id');
      return id;
    }
  );
}
