import { handle, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { lobbyPlayers } from '@/server/papers';

export const GET = handle<{ id: string }>(async (_req, ctx) => {
  await requireStaff('papers.manage');
  return lobbyPlayers(await paramId(ctx));
});
