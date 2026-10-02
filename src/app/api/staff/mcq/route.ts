import { z } from 'zod';
import { handle, body, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { listPapers, createPaper } from '@/server/papers';

/* MCQ papers (?kind=paper) and speed drills (?kind=drill). */

export const GET = handle(async (req) => {
  await requireStaff('papers.manage');
  return listPapers(query(req).get('kind') === 'drill' ? 'drill' : 'paper');
});

const New = z.object({ title: z.string().trim().min(1, 'A paper needs a name').max(80), kind: z.enum(['paper', 'drill']).default('paper') });

export const POST = handle(async (req) => {
  const p = await requireStaff('papers.manage');
  const b = await body(req, New);
  const row = await createPaper(b.title, b.kind, p.id);
  await logActivity(p.id, b.kind === 'drill' ? 'Speed drill created' : 'MCQ paper created', b.title);
  return row;
});
