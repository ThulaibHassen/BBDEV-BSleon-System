import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { listQuizzes, createQuiz } from '@/server/papers';

/* Live class quiz: question sets. */

export const GET = handle(async () => {
  await requireStaff('papers.manage');
  return listQuizzes();
});

const New = z.object({ title: z.string().trim().min(1, 'A set needs a name').max(80) });

export const POST = handle(async (req) => {
  const p = await requireStaff('papers.manage');
  const { title } = await body(req, New);
  const row = await createQuiz(title, p.id);
  await logActivity(p.id, 'Question set created', title);
  return row;
});
