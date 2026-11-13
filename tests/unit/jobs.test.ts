import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  JOB_STATUSES,
  JOB_STATUS_FLOW,
  applyJobStatus,
  canTransitionJob,
  isJobStatus,
  jobStatusActionLabel,
  nextJobStatuses,
  type JobStatus,
} from '@/lib/jobs';

/** Minimal stand-in for the transaction client handed to applyJobStatus. */
function fakeClient(rows: Array<{ status: JobStatus }>): {
  client: PoolClient;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/^\s*select/i.test(sql)) {
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

describe('job pipeline rules', () => {
  it('offers the happy path in order', () => {
    expect(JOB_STATUS_FLOW).toEqual([
      'LEAD',
      'QUOTED',
      'APPROVED',
      'SCHEDULED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
  });

  it('moves a lead forward but never straight to completed', () => {
    expect(nextJobStatuses('LEAD')).toEqual(['QUOTED', 'APPROVED', 'CANCELLED']);
    expect(canTransitionJob('LEAD', 'APPROVED')).toBe(true);
    expect(canTransitionJob('LEAD', 'COMPLETED')).toBe(false);
    expect(canTransitionJob('LEAD', 'IN_PROGRESS')).toBe(false);
  });

  it('requires approval and scheduling before work starts', () => {
    expect(canTransitionJob('QUOTED', 'APPROVED')).toBe(true);
    expect(canTransitionJob('QUOTED', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionJob('APPROVED', 'SCHEDULED')).toBe(true);
    expect(canTransitionJob('APPROVED', 'IN_PROGRESS')).toBe(true); // urgent jobs skip scheduling
    expect(canTransitionJob('SCHEDULED', 'IN_PROGRESS')).toBe(true);
  });

  it('allows completion, reopening and cancellation', () => {
    expect(canTransitionJob('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransitionJob('COMPLETED', 'IN_PROGRESS')).toBe(true); // rework happens
    expect(canTransitionJob('IN_PROGRESS', 'CANCELLED')).toBe(true);
    expect(canTransitionJob('CANCELLED', 'LEAD')).toBe(true); // a cancelled enquiry can return
    expect(canTransitionJob('CANCELLED', 'COMPLETED')).toBe(false);
  });

  it('never allows a status to stay unchanged, or an unknown status', () => {
    for (const status of JOB_STATUSES) {
      expect(canTransitionJob(status, status)).toBe(false);
    }
    expect(isJobStatus('LEAD')).toBe(true);
    expect(isJobStatus('lead')).toBe(false);
    expect(isJobStatus('ARCHIVED')).toBe(false);
  });

  it('labels buttons for the next step, not the current one', () => {
    expect(jobStatusActionLabel('IN_PROGRESS')).toBe('Start job');
    expect(jobStatusActionLabel('COMPLETED')).toBe('Mark as complete');
    expect(jobStatusActionLabel('CANCELLED')).toBe('Cancel job');
  });
});

describe('applyJobStatus', () => {
  it('locks the job row inside the business and applies a legal move', async () => {
    const { client, calls } = fakeClient([{ status: 'IN_PROGRESS' }]);

    const result = await applyJobStatus(client, 'business-1', 'job-1', 'COMPLETED');

    expect(result).toEqual({ updated: true, from: 'IN_PROGRESS' });

    const [select, update] = calls;
    // The read takes a row lock and is scoped to the caller's business.
    expect(select?.sql).toContain('for update');
    expect(select?.sql).toContain('business_id');
    expect(select?.params).toEqual(['job-1', 'business-1']);

    // The write stamps completed_date on completion and clears it otherwise.
    expect(update?.sql).toContain('update jobs');
    expect(update?.sql).toContain('completed_date');
    expect(update?.sql).toContain("'COMPLETED'");
  });

  it('refuses an illegal move without writing anything', async () => {
    const { client, calls } = fakeClient([{ status: 'LEAD' }]);

    const result = await applyJobStatus(client, 'business-1', 'job-1', 'COMPLETED');

    expect(result).toEqual({ updated: false, from: 'LEAD' });
    // Only the locked read ran; the job row was never touched.
    expect(calls.length).toBe(1);
  });

  it('reports a job that does not exist in this business as not found', async () => {
    const { client, calls } = fakeClient([]);

    const result = await applyJobStatus(client, 'business-1', 'job-1', 'QUOTED');

    expect(result).toEqual({ updated: false, from: null });
    expect(calls.length).toBe(1);
  });
});
