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

import { createCustomerAction } from '@/lib/actions/customers';
import { createJobAction, setJobStatusAction, updateJobAction } from '@/lib/actions/jobs';
import {
  countJobs,
  getJob,
  getJobStatusCounts,
  listJobs,
} from '@/lib/repositories/jobs';
import { clearRateLimits } from '@/lib/security/rate-limit';
import { expectRedirect, formData, runAction, runFormAction } from '@/tests/helpers/actions';
import { registerOwner, type RegisteredOwner } from '@/tests/helpers/owners';
import { countRows, resetDatabase, withAdminClient } from '@/tests/helpers/env';

function customerForm(overrides: Record<string, string> = {}) {
  return formData({
    customerType: 'BUSINESS',
    businessName: 'Table Bay Coffee Roasters',
    contactPerson: 'Sam Petersen',
    phone: '021 555 0188',
    email: 'sam@example.co.za',
    siteAddressLine1: 'Unit 7, Roastery Park',
    siteCity: 'Paarden Eiland',
    siteProvince: 'Western Cape',
    sitePostalCode: '7405',
    ...overrides,
  });
}

function jobForm(customerId: string, overrides: Record<string, string> = {}) {
  return formData({
    customerId,
    title: 'Kitchen plugs tripping the earth leakage',
    description: 'Trips when the kettle and microwave run together.',
    jobType: 'Fault finding',
    status: 'LEAD',
    scheduledDate: '',
    jobAddressLine1: '',
    jobAddressLine2: '',
    jobCity: '',
    jobProvince: '',
    jobPostalCode: '',
    notes: 'Gate code 4417',
    ...overrides,
  });
}

async function createCustomer(overrides: Record<string, string> = {}): Promise<string> {
  const outcome = await runAction(createCustomerAction, customerForm(overrides));
  expectRedirect(outcome, '/app/customers/');
  if (outcome.kind !== 'redirect') throw new Error('unreachable');
  return outcome.url.replace('/app/customers/', '').split('?')[0]!;
}

async function createJob(
  owner: RegisteredOwner,
  customerId: string,
  overrides: Record<string, string> = {}
): Promise<{ id: string; jobNumber: string }> {
  const outcome = await runAction(createJobAction, jobForm(customerId, overrides));
  expectRedirect(outcome, '/app/jobs/');
  if (outcome.kind !== 'redirect') throw new Error('unreachable');
  const id = outcome.url.replace('/app/jobs/', '').split('?')[0]!;

  const row = await withAdminClient(async (client) => {
    const { rows } = await client.query<{ job_number: string }>(
      'select job_number from public.jobs where id = $1',
      [id]
    );
    return rows[0];
  });

  return { id, jobNumber: row?.job_number ?? '' };
}

describe('jobs', () => {
  beforeEach(async () => {
    clearRateLimits();
    await resetDatabase();
  });

  it('creates a job with the next sequential job number', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomer();

    const first = await createJob(owner, customerId);
    const second = await createJob(owner, customerId, { title: 'Garage DB board replacement' });

    expect(first.jobNumber).toBe('JOB-0001');
    expect(second.jobNumber).toBe('JOB-0002');

    const job = await getJob(owner.businessId, owner.userId, first.id);
    expect(job?.status).toBe('LEAD');
    expect(job?.customer_name).toBe('Table Bay Coffee Roasters');
    expect(job?.job_type).toBe('Fault finding');

    // The sequence is stored, so a restart cannot reissue a number.
    const sequence = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ next_number: number }>(
        `select next_number from public.document_sequences
          where business_id = $1 and doc_type = 'JOB'`,
        [owner.businessId]
      );
      return rows[0]?.next_number;
    });
    expect(sequence).toBe(3);

    expect(
      await countRows('audit_events', `event_type = 'job.created' and entity_id = $1`, [first.id])
    ).toBe(1);
  });

  it('copies the customer site address when the job form leaves it blank', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomer();

    const { id } = await createJob(owner, customerId);
    const job = await getJob(owner.businessId, owner.userId, id);

    expect(job?.job_address_line1).toBe('Unit 7, Roastery Park');
    expect(job?.job_city).toBe('Paarden Eiland');
    expect(job?.job_postal_code).toBe('7405');

    // …but an explicit site address wins.
    const explicit = await createJob(owner, customerId, {
      title: 'Second site',
      jobAddressLine1: '12 Industrial Road',
      jobCity: 'Cape Town',
    });
    const second = await getJob(owner.businessId, owner.userId, explicit.id);
    expect(second?.job_address_line1).toBe('12 Industrial Road');
    expect(second?.job_city).toBe('Cape Town');
  });

  it('rejects a job for a customer that does not exist and for a missing title', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomer();

    const noTitle = await runAction(createJobAction, jobForm(customerId, { title: '  ' }));
    if (noTitle.kind !== 'state' || noTitle.state.status !== 'error') {
      throw new Error('Expected a validation error');
    }
    expect(noTitle.state.fieldErrors.title?.length).toBeGreaterThan(0);

    const foreignCustomer = await runAction(
      createJobAction,
      jobForm(crypto.randomUUID(), { title: 'Job for a stranger' })
    );
    if (foreignCustomer.kind !== 'state' || foreignCustomer.state.status !== 'error') {
      throw new Error('Expected the foreign customer to be refused');
    }
    expect(await countRows('jobs')).toBe(0);
    expect(owner.businessId).toBeTruthy();
  });

  it('moves a job through the pipeline and refuses to skip steps', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomer();
    const { id } = await createJob(owner, customerId);

    // LEAD → COMPLETED is not a valid move.
    const illegal = await runFormAction(
      setJobStatusAction,
      formData({ jobId: id, status: 'COMPLETED' })
    );
    expectRedirect(illegal, `/app/jobs/${id}?statusError=not_allowed`);
    expect((await getJob(owner.businessId, owner.userId, id))?.status).toBe('LEAD');

    // LEAD → QUOTED → APPROVED → SCHEDULED → IN_PROGRESS → COMPLETED
    for (const status of ['QUOTED', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED']) {
      const outcome = await runFormAction(setJobStatusAction, formData({ jobId: id, status }));
      expectRedirect(outcome, `/app/jobs/${id}?statusUpdated=${status.toLowerCase()}`);
      expect((await getJob(owner.businessId, owner.userId, id))?.status).toBe(status);
    }

    const completed = await getJob(owner.businessId, owner.userId, id);
    expect(completed?.completed_date).toBeTruthy();

    // Five status changes and one rejection are all recorded.
    expect(
      await countRows('audit_events', `event_type = 'job.status_changed' and entity_id = $1`, [id])
    ).toBe(5);

    // Reopening clears the completion date again.
    await runFormAction(setJobStatusAction, formData({ jobId: id, status: 'IN_PROGRESS' }));
    expect((await getJob(owner.businessId, owner.userId, id))?.completed_date).toBeNull();
  });

  it('cancels and reopens a job', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomer();
    const { id } = await createJob(owner, customerId);

    await runFormAction(setJobStatusAction, formData({ jobId: id, status: 'CANCELLED' }));
    expect((await getJob(owner.businessId, owner.userId, id))?.status).toBe('CANCELLED');

    const straightToComplete = await runFormAction(
      setJobStatusAction,
      formData({ jobId: id, status: 'COMPLETED' })
    );
    expectRedirect(straightToComplete, `/app/jobs/${id}?statusError=not_allowed`);

    await runFormAction(setJobStatusAction, formData({ jobId: id, status: 'LEAD' }));
    expect((await getJob(owner.businessId, owner.userId, id))?.status).toBe('LEAD');
  });

  it('updates job details without touching the pipeline status', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomer();
    const { id } = await createJob(owner, customerId);

    await runFormAction(setJobStatusAction, formData({ jobId: id, status: 'QUOTED' }));

    const outcome = await runAction(
      updateJobAction,
      jobForm(customerId, {
        jobId: id,
        title: 'Kitchen and scullery plugs tripping',
        status: 'LEAD', // ignored on update
        scheduledDate: '2026-10-14',
      })
    );
    expectRedirect(outcome, `/app/jobs/${id}?saved=1`);

    const job = await getJob(owner.businessId, owner.userId, id);
    expect(job?.title).toBe('Kitchen and scullery plugs tripping');
    expect(job?.scheduled_date).toBe('2026-10-14');
    expect(job?.status).toBe('QUOTED');
  });

  it('filters and counts jobs for the list screen', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomer();
    const first = await createJob(owner, customerId);
    const second = await createJob(owner, customerId, { title: 'Garage DB board replacement' });
    await createJob(owner, customerId, { title: 'Annual COC inspection' });

    await runFormAction(setJobStatusAction, formData({ jobId: second.id, status: 'CANCELLED' }));

    const all = await listJobs(owner.businessId, owner.userId, {});
    expect(all.total).toBe(3);

    const open = await listJobs(owner.businessId, owner.userId, { status: 'OPEN' });
    // Newest first is the default order for the job board.
    expect(open.rows.map((row) => row.job_number)).toEqual(['JOB-0003', 'JOB-0001']);

    const cancelled = await listJobs(owner.businessId, owner.userId, { status: 'CANCELLED' });
    expect(cancelled.total).toBe(1);

    const byNumber = await listJobs(owner.businessId, owner.userId, { search: 'JOB-0002' });
    expect(byNumber.total).toBe(1);

    const byCustomerName = await listJobs(owner.businessId, owner.userId, { search: 'roasters' });
    expect(byCustomerName.total).toBe(3);

    const byTitle = await listJobs(owner.businessId, owner.userId, { search: 'COC' });
    expect(byTitle.total).toBe(1);

    const counts = await getJobStatusCounts(owner.businessId, owner.userId);
    expect(counts.ALL).toBe(3);
    expect(counts.OPEN).toBe(2);
    expect(counts.CANCELLED).toBe(1);

    const summary = await countJobs(owner.businessId, owner.userId);
    expect(summary).toEqual({ total: 3, open: 2, completed: 0 });
    expect(first.jobNumber).toBe('JOB-0001');
  });

  it('gives each business its own job numbers and its own jobs', async () => {
    const first = await registerOwner();
    const firstCustomer = await createCustomer();
    const firstJob = await createJob(first, firstCustomer);

    const second = await registerOwner();
    const secondCustomer = await createCustomer({ businessName: 'Second owner customer' });
    const secondJob = await createJob(second, secondCustomer);

    // Numbering restarts per business: both are JOB-0001.
    expect(firstJob.jobNumber).toBe('JOB-0001');
    expect(secondJob.jobNumber).toBe('JOB-0001');

    // Reads and writes are tenant-scoped.
    expect(await getJob(second.businessId, second.userId, firstJob.id)).toBeNull();
    const list = await listJobs(second.businessId, second.userId, {});
    expect(list.total).toBe(1);

    const foreignUpdate = await runAction(
      updateJobAction,
      jobForm(secondCustomer, { jobId: firstJob.id, title: 'Hijacked job' })
    );
    if (foreignUpdate.kind !== 'state' || foreignUpdate.state.status !== 'error') {
      throw new Error('Expected the foreign update to be refused');
    }

    const foreignStatus = await runFormAction(
      setJobStatusAction,
      formData({ jobId: firstJob.id, status: 'QUOTED' })
    );
    expectRedirect(foreignStatus, '/app/jobs?missing=1');

    const untouched = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ title: string; status: string }>(
        'select title, status from public.jobs where id = $1',
        [firstJob.id]
      );
      return rows[0];
    });
    expect(untouched?.title).toBe('Kitchen plugs tripping the earth leakage');
    expect(untouched?.status).toBe('LEAD');
  });
});
