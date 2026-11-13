import { SubmitButton } from '@/components/ui/feedback';
import { setJobStatusAction } from '@/lib/actions/jobs';
import { jobStatusActionLabel, nextJobStatuses, type JobStatus } from '@/lib/jobs';

/**
 * Pipeline controls for one job.
 *
 * Only the transitions allowed by `lib/jobs.ts` are rendered, and the action
 * validates them again before writing — so a crafted request cannot skip states
 * (for example LEAD straight to COMPLETED) and the audit trail always shows the
 * real path through the pipeline.
 */
export function JobStatusActions({
  jobId,
  status,
  returnTo,
}: {
  jobId: string;
  status: JobStatus;
  returnTo?: string;
}) {
  const next = nextJobStatuses(status);

  if (next.length === 0) {
    return (
      <p className="text-sm text-steel-500">
        This job is {status === 'CANCELLED' ? 'cancelled' : 'complete'} and has no next step.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {next.map((target) => (
        <form key={target} action={setJobStatusAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="status" value={target} />
          {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
          <SubmitButton
            variant={target === 'CANCELLED' ? 'secondary' : 'primary'}
            size="md"
            pendingLabel="Updating…"
          >
            {jobStatusActionLabel(target)}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}
