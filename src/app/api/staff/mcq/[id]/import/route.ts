import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { importCsv } from '@/server/papers';

/** CSV text: question, option1..option5, answer (1-based), marks, why. All-or-nothing. */
const In = z.object({ csv: z.string().min(1).max(1_000_000) });

export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('papers.manage');
  const out = await importCsv(await paramId(ctx), (await body(req, In)).csv);
  await logActivity(p.id, 'MCQ questions imported', `${out.added} from CSV`);
  return out;
});
