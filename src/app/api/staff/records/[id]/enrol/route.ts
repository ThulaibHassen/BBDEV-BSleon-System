import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { EnrolInput, enrolFromRecord } from '@/server/crm';

/* Enrol an enquiry as a student: students row + recurring_plans row (same id)
   + the link on the enquiry, in one transaction. 409 'duplicate' asks the
   client to confirm a second active student with the same name. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('enquiries.write');
  return { student: await enrolFromRecord(p, await paramId(ctx), await body(req, EnrolInput)) };
});
