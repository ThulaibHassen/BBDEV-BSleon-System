import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { listEssays, createEssay } from '@/server/papers';

export const GET = handle(async () => {
  await requireStaff('papers.manage');
  return listEssays();
});

const New = z.object({ title: z.string().trim().min(1, 'A template needs a name').max(120) });

export const POST = handle(async (req) => {
  const p = await requireStaff('papers.manage');
  const { title } = await body(req, New);
  const row = await createEssay(title, p.id);
  await logActivity(p.id, 'Essay template created', title);
  return row;
});
