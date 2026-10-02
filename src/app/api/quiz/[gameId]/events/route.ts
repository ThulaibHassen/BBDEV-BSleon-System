import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { getPrincipal } from '@/lib/server/auth';
import { can } from '@/lib/shared/rbac';
import { sseResponse } from '@/lib/server/realtime';
import { channel } from '@/server/quiz';

/* Server-Sent Events for one live quiz game. The stream only says "something
   changed, refresh"; the state itself is always read from the server. Open
   to the staff host, or to a student who has joined this game. */

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const gameId = Number((await ctx.params).gameId);
  if (!Number.isInteger(gameId) || gameId <= 0) return new Response('Bad game', { status: 400 });

  const staff = await getPrincipal('staff');
  let ok = !!staff && can(staff.role, 'papers.manage');
  if (!ok) {
    const st = await getPrincipal('student');
    if (st) {
      const [pl] = await db()
        .select({ g: schema.quizPlayers.gameId })
        .from(schema.quizPlayers)
        .where(and(eq(schema.quizPlayers.gameId, gameId), eq(schema.quizPlayers.studentId, st.id)))
        .limit(1);
      ok = !!pl;
    }
  }
  if (!ok) return new Response('Not available', { status: 403 });
  return sseResponse(req, channel(gameId));
}
