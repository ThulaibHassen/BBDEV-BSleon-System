import { handle, body } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { CFG } from '@/lib/shared/constants';
import { BulkIn, bulk } from '@/server/documents';

/* The list's checkboxes: publish, unpublish, set the batch or delete many
   documents at once. A delete leaves out PDFs an MCQ paper uses and says which. */

const WHAT = { publish: 'published', unpublish: 'unpublished', cohort: 'batch set', delete: 'deleted' } as const;

export const POST = handle(async (req) => {
  const p = await requireStaff('library.manage');
  const b = await body(req, BulkIn);
  const out = await bulk(b);
  if (out.done) {
    const batch = b.action === 'cohort' ? ` (${b.cohort == null ? 'any batch' : CFG.cohorts[b.cohort] ?? `batch ${b.cohort}`})` : '';
    await logActivity(p.id, `PDFs ${WHAT[b.action]}`, `${out.done} document${out.done === 1 ? '' : 's'}${batch}`);
  }
  return out;
});
