'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requestMetadata, requireSession } from '@/lib/auth/current-user';
import { withContext } from '@/lib/db';
import { applyJobStatus, isJobStatus, nextJobStatuses } from '@/lib/jobs';
import { recordAuditEvent } from '@/lib/repositories/audit';
import { createJob, getJob, updateJob, type JobInput } from '@/lib/repositories/jobs';
import { jobSchema, nullish } from '@/lib/validation/schemas';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * Job Server Actions.
 *
 * Job numbers are allocated in the repository inside the same transaction as
 * the insert. Status changes go through the pure transition rules in
 * `lib/jobs.ts`, so an impossible pipeline state cannot be written even if a
 * form is tampered with.
 */
function parseJob(formData: FormData) {
  return jobSchema.safeParse({
    customerId: readString(formData, 'customerId'),
    title: readString(formData, 'title'),
    description: readString(formData, 'description'),
    jobType: readString(formData, 'jobType'),
    status: readString(formData, 'status') || 'LEAD',
    scheduledDate: readString(formData, 'scheduledDate'),
    jobAddressLine1: readString(formData, 'jobAddressLine1'),
    jobAddressLine2: readString(formData, 'jobAddressLine2'),
    jobCity: readString(formData, 'jobCity'),
    jobProvince: readString(formData, 'jobProvince'),
    jobPostalCode: readString(formData, 'jobPostalCode'),
    notes: readString(formData, 'notes'),
  });
}

function toRepositoryInput(data: NonNullable<ReturnType<typeof parseJob>['data']>): JobInput {
  return {
    customerId: data.customerId,
    title: data.title,
    description: nullish(data.description),
    jobType: nullish(data.jobType),
    status: data.status,
    scheduledDate: nullish(data.scheduledDate),
    jobAddressLine1: nullish(data.jobAddressLine1),
    jobAddressLine2: nullish(data.jobAddressLine2),
    jobCity: nullish(data.jobCity),
    jobProvince: nullish(data.jobProvince),
    jobPostalCode: nullish(data.jobPostalCode),
    notes: nullish(data.notes),
  };
}

export async function createJobAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const parsed = parseJob(formData);

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  let jobId: string;
  try {
    const metadata = await requestMetadata();
    const created = await createJob(
      session.businessId,
      session.userId,
      toRepositoryInput(parsed.data),
      { ipAddress: metadata.ipAddress }
    );
    jobId = created.id;
  } catch (error) {
    return unexpectedError('job.create', error);
  }

  revalidatePath('/app/jobs');
  revalidatePath('/app');
  redirect(`/app/jobs/${jobId}`);
}

export async function updateJobAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const jobId = readString(formData, 'jobId');
  const parsed = parseJob(formData);

  if (!jobId) return errorState('Missing job reference. Reload the page and try again.');
  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    const metadata = await requestMetadata();
    const result = await updateJob(session.businessId, session.userId, jobId, toRepositoryInput(parsed.data), {
      ipAddress: metadata.ipAddress,
    });

    if (!result.updated) {
      return errorState('That job no longer exists in your business.');
    }
  } catch (error) {
    return unexpectedError('job.update', error);
  }

  revalidatePath('/app/jobs');
  revalidatePath(`/app/jobs/${jobId}`);
  redirect(`/app/jobs/${jobId}?saved=1`);
}

/**
 * Move a job through the pipeline.
 *
 * The transition is validated against `nextJobStatuses()` before the write, so
 * a crafted form cannot jump a job from `LEAD` straight to `COMPLETED` without
 * the intermediate states existing in the audit trail.
 */
export async function setJobStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const jobId = readString(formData, 'jobId');
  const requested = readString(formData, 'status');
  const returnTo = readString(formData, 'returnTo') || `/app/jobs/${jobId}`;

  if (!jobId || !isJobStatus(requested)) {
    redirect(returnTo);
  }

  const job = await getJob(session.businessId, session.userId, jobId);
  if (!job) {
    redirect('/app/jobs?missing=1');
  }

  if (!nextJobStatuses(job.status).includes(requested)) {
    redirect(`${returnTo}?statusError=not_allowed`);
  }

  // Database work is wrapped so that only application errors are converted into
  // a redirect; Next.js redirects are thrown after the work is done.
  let failure: 'not_allowed' | 'failed' | null = null;

  try {
    const metadata = await requestMetadata();

    const result = await withContext(
      { userId: session.userId, businessId: session.businessId },
      async (client) => {
        const transition = await applyJobStatus(client, session.businessId, jobId, requested);
        if (transition.updated) {
          await recordAuditEvent(client, {
            businessId: session.businessId,
            userId: session.userId,
            eventType: 'job.status_changed',
            entityType: 'job',
            entityId: jobId,
            metadata: { from: transition.from, to: requested },
            ipAddress: metadata.ipAddress,
          });
        }
        return transition.updated;
      }
    );

    if (!result) failure = 'not_allowed';
  } catch (error) {
    unexpectedError('job.status', error);
    failure = 'failed';
  }

  if (failure) {
    redirect(`${returnTo}?statusError=${failure}`);
  }

  revalidatePath('/app/jobs');
  revalidatePath(`/app/jobs/${jobId}`);
  revalidatePath('/app');
  redirect(`${returnTo}?statusUpdated=${requested.toLowerCase()}`);
}
