import type { PoolClient } from 'pg';

export const JOB_STATUSES = [
  'LEAD',
  'QUOTED',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_FLOW: JobStatus[] = [
  'LEAD',
  'QUOTED',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
];

const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  LEAD: ['QUOTED', 'APPROVED', 'CANCELLED'],
  QUOTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['LEAD'],
};

export function isJobStatus(value: unknown): value is JobStatus {
  return (
    typeof value === 'string' &&
    (JOB_STATUSES as readonly string[]).includes(value)
  );
}

export function nextJobStatuses(status: JobStatus): JobStatus[] {
  return [...JOB_TRANSITIONS[status]];
}

export function canTransitionJob(
  currentStatus: JobStatus,
  nextStatus: JobStatus,
): boolean {
  if (currentStatus === nextStatus) {
    return false;
  }

  return JOB_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function jobStatusActionLabel(status: JobStatus): string {
  switch (status) {
    case 'LEAD':
      return 'Return to lead';
    case 'QUOTED':
      return 'Mark as quoted';
    case 'APPROVED':
      return 'Approve job';
    case 'SCHEDULED':
      return 'Schedule job';
    case 'IN_PROGRESS':
      return 'Start job';
    case 'COMPLETED':
      return 'Mark as complete';
    case 'CANCELLED':
      return 'Cancel job';
  }
}

/**
 * Move a job to a new status inside the caller's transaction.
 *
 * The row is locked first (`for update`), so two devices cannot both apply the
 * same transition at once. The move is guarded by `canTransitionJob`, the one
 * transition table the whole app uses, so a crafted form cannot jump the
 * pipeline or write a terminal state twice. `completed_date` is stamped on the
 * day the job reaches COMPLETED and cleared on every other move, so a reopened
 * job carries no completion date (see DATABASE.md).
 *
 * Returns the previous status when the move happened, and null when the job
 * does not exist in this business (the `business_id` predicate also scopes the
 * row lock to the caller's tenant).
 */
export async function applyJobStatus(
  client: PoolClient,
  businessId: string,
  jobId: string,
  nextStatus: JobStatus
): Promise<{ updated: boolean; from: JobStatus | null }> {
  const { rows } = await client.query<{ status: JobStatus }>(
    `select status from jobs where id = $1 and business_id = $2 for update`,
    [jobId, businessId]
  );

  const current = rows[0];
  if (!current) return { updated: false, from: null };
  if (!canTransitionJob(current.status, nextStatus)) {
    return { updated: false, from: current.status };
  }

  await client.query(
    `update jobs
        set status = $3::public.job_status,
            completed_date = case when $4::text = 'COMPLETED' then current_date else null end
      where id = $1 and business_id = $2`,
    [jobId, businessId, nextStatus, nextStatus]
  );

  return { updated: true, from: current.status };
}