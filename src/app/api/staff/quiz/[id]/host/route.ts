import { handle, paramId } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { createGame } from '@/server/quiz';
import { getQuiz } from '@/server/papers';

/** "Host game": a new game with a fresh 6-digit PIN, in the lobby. */
export const POST = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('papers.manage');
  const id = await paramId(ctx);
  const { quiz, questions } = await getQuiz(id);
  if (!quiz.published) throw new HttpError(400, 'Turn on "Ready to play" first.', 'draft');
  if (!questions.length) throw new HttpError(400, 'Add a question first.', 'empty');
  const g = await createGame(id, p.id);
  await logActivity(p.id, 'Quiz game opened', `${quiz.title} · code ${g.pin}`);
  return { gameId: g.id, pin: g.pin };
});
