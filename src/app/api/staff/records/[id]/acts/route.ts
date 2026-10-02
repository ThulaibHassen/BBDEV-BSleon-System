import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { addAct } from '@/server/crm';

/* Log activity on an enquiry. Only the two kinds the panel creates. */
const Act = z.object({
  t: z.enum(['Activity', 'WhatsApp sent']),
  m: z.string().trim().min(1).max(500),
});

export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('enquiries.write');
  const a = await body(req, Act);
  return { record: await addAct(p, await paramId(ctx), a.t, a.m) };
});
