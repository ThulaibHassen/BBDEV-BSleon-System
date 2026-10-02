import 'server-only';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { HttpError } from '@/lib/server/auth';
import { publish } from '@/lib/server/realtime';

/* Kahoot-style live class quiz (was migration 022's functions).

   States: lobby → question → reveal → question … → ended.
   The host (owner/manager) drives it with next / reveal / end.
   Phones join with the 6-digit PIN, poll state every 2 s and also listen on
   the SSE channel `quiz:<gameId>` for an instant nudge.
   `answer` and `why` are returned ONLY while state = reveal. */

const G = schema.quizGames;
const QQ = schema.quizQuestions;
const PL = schema.quizPlayers;
const AN = schema.quizAnswers;

export const channel = (gameId: number) => `quiz:${gameId}`;

/** 1000 at 0 ms falling linearly to 500 at the limit, × double, + streak bonus (100/answer, max 500). */
export function points(ms: number, limitSec: number, x: number, streakBefore: number) {
  const lim = limitSec * 1000;
  const base = Math.round(1000 * Math.max(0.5, 1 - Math.min(ms, lim) / lim / 2));
  return Math.max(0, base) * Math.max(1, x) + Math.min(500, Math.max(0, streakBefore) * 100);
}

async function questionAt(quizId: number, idx: number) {
  if (idx < 0) return null;
  const [q] = await db().select().from(QQ).where(eq(QQ.quizId, quizId)).orderBy(asc(QQ.ord), asc(QQ.id)).offset(idx).limit(1);
  return q ?? null;
}

export async function createGame(quizId: number, hostStaff: number) {
  const d = db();
  const [quiz] = await d.select().from(schema.quizzes).where(eq(schema.quizzes.id, quizId)).limit(1);
  if (!quiz) throw new HttpError(404, 'No such quiz', 'not_found');
  for (let i = 0; i < 5; i++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const [g] = await d.insert(G).values({ quizId, pin, hostStaff, cohort: quiz.cohort }).onConflictDoNothing().returning();
    if (g) return g;
  }
  throw new HttpError(500, 'Could not make a game code. Try again.', 'pin');
}

export async function join(pin: string, studentId: number, cohort: number, firstName: string, nick?: string | null, avatar?: string | null) {
  const d = db();
  const [g] = await d
    .select()
    .from(G)
    .where(and(eq(G.pin, pin.trim().toUpperCase()), ne(G.state, 'ended')))
    .orderBy(desc(G.createdAt))
    .limit(1);
  if (!g) throw new HttpError(404, 'No game with that code', 'no_game');
  if (g.cohort != null && g.cohort !== cohort) throw new HttpError(400, 'That game is for another batch', 'batch');
  const nickname = (nick ?? '').trim().slice(0, 18) || firstName;
  await d
    .insert(PL)
    .values({ gameId: g.id, studentId, nickname, avatar: avatar || 'bulb' })
    .onConflictDoUpdate({
      target: [PL.gameId, PL.studentId],
      set: { ...(nick?.trim() ? { nickname } : {}), ...(avatar ? { avatar } : {}) },
    });
  const [quiz] = await d.select({ title: schema.quizzes.title }).from(schema.quizzes).where(eq(schema.quizzes.id, g.quizId)).limit(1);
  await publish(channel(g.id), 'join');
  return { gameId: g.id, pin: g.pin, state: g.state, title: quiz?.title ?? '' };
}

export async function state(gameId: number, viewer: { staff?: boolean; studentId?: number }) {
  const d = db();
  const [g] = await d.select().from(G).where(eq(G.id, gameId)).limit(1);
  if (!g) throw new HttpError(404, 'No such game', 'no_game');
  let me: { score: number; streak: number; answered: boolean; place: number } | null = null;
  if (!viewer.staff) {
    const [p] = await d
      .select()
      .from(PL)
      .where(and(eq(PL.gameId, gameId), eq(PL.studentId, viewer.studentId ?? -1)))
      .limit(1);
    if (!p) throw new HttpError(403, 'not in this game', 'not_player');
    me = { score: p.score, streak: p.streak, answered: false, place: 1 };
  }
  const [{ total }] = await d.select({ total: sql<number>`count(*)::int` }).from(QQ).where(eq(QQ.quizId, g.quizId));
  const q = await questionAt(g.quizId, g.qIndex);
  const [{ players }] = await d.select({ players: sql<number>`count(*)::int` }).from(PL).where(eq(PL.gameId, gameId));
  let answered = 0;
  if (q) {
    [{ answered }] = await d
      .select({ answered: sql<number>`count(*)::int` })
      .from(AN)
      .where(and(eq(AN.gameId, gameId), eq(AN.questionId, q.id)));
    if (me) {
      const [mine] = await d
        .select({ n: sql<number>`count(*)::int` })
        .from(AN)
        .where(and(eq(AN.gameId, gameId), eq(AN.questionId, q.id), eq(AN.studentId, viewer.studentId!)));
      me.answered = mine.n > 0;
    }
  }
  if (me) {
    const [{ above }] = await d
      .select({ above: sql<number>`count(*)::int` })
      .from(PL)
      .where(and(eq(PL.gameId, gameId), sql`${PL.score} > ${me.score}`));
    me.place = above + 1;
  }
  const top = await d
    .select({ nickname: PL.nickname, avatar: PL.avatar, score: PL.score })
    .from(PL)
    .where(eq(PL.gameId, gameId))
    .orderBy(desc(PL.score), asc(PL.joinedAt))
    .limit(viewer.staff ? 10 : 3);
  const reveal = g.state === 'reveal';
  return {
    gameId: g.id,
    pin: g.pin,
    state: g.state,
    qIndex: g.qIndex,
    total,
    startedAt: g.qStartedAt?.toISOString() ?? null,
    serverNow: new Date().toISOString(),
    question: q ? { id: q.id, q: q.q, imageId: q.imageMediaId, opts: q.opts, optImages: q.opts.map((_, i) => q.optImages?.[i] ?? null), seconds: q.seconds, pointsX: q.pointsX, answer: reveal ? q.answer : null, why: reveal ? q.why : null } : null,
    answered,
    players,
    me,
    top,
  };
}

export async function answer(gameId: number, questionId: number, choice: number, studentId: number) {
  const d = db();
  const [g] = await d.select().from(G).where(eq(G.id, gameId)).limit(1);
  if (!g || g.state !== 'question') throw new HttpError(400, 'Not taking answers now', 'closed');
  const [p] = await d
    .select()
    .from(PL)
    .where(and(eq(PL.gameId, gameId), eq(PL.studentId, studentId)))
    .limit(1);
  if (!p) throw new HttpError(403, 'not in this game', 'not_player');
  const [q] = await d
    .select()
    .from(QQ)
    .where(and(eq(QQ.id, questionId), eq(QQ.quizId, g.quizId)))
    .limit(1);
  if (!q) throw new HttpError(400, 'That question is not in this game', 'bad_q');
  // only the question on screen takes answers — never an earlier, already revealed one
  const current = await questionAt(g.quizId, g.qIndex);
  if (!current || current.id !== q.id) throw new HttpError(400, 'Not taking answers now', 'closed');
  const ms = Math.max(0, Date.now() - (g.qStartedAt?.getTime() ?? Date.now()));
  if (ms > (q.seconds + 3) * 1000) throw new HttpError(400, 'Too late', 'late');
  const ok = choice === q.answer;
  const pts = ok ? points(ms, q.seconds, q.pointsX, p.streak) : 0;

  const res = await d.transaction(async (tx) => {
    const ins = await tx
      .insert(AN)
      .values({ gameId, questionId, studentId, choice, ms, correct: ok, points: pts })
      .onConflictDoNothing()
      .returning();
    if (!ins.length) throw new HttpError(400, 'Already answered', 'dup');
    const streak = ok ? p.streak + 1 : 0;
    const [np] = await tx
      .update(PL)
      .set({ score: sql`${PL.score} + ${pts}`, streak, bestStreak: sql`greatest(${PL.bestStreak}, ${streak})` })
      .where(and(eq(PL.gameId, gameId), eq(PL.studentId, studentId)))
      .returning();
    return { correct: ok, points: pts, score: np.score, streak: np.streak, ms };
  });
  await publish(channel(gameId), 'answer');
  return res;
}

/* Each action only from the state the host screen offers it in, and only
   while the game is still where the host saw it (`at` = the q_index on their
   screen). A double-clicked "Next", a second host tab or a late auto-reveal
   then changes nothing, instead of skipping a question or reviving an ended
   game (whose answer would then be shown to every phone). */
const FROM: Record<'next' | 'reveal' | 'end', string[]> = {
  next: ['lobby', 'reveal'],
  reveal: ['question'],
  end: ['lobby', 'question', 'reveal'],
};

export async function host(gameId: number, action: 'next' | 'reveal' | 'end', at?: number) {
  const d = db();
  const [g] = await d.select().from(G).where(eq(G.id, gameId)).limit(1);
  if (!g) throw new HttpError(404, 'No such game', 'no_game');
  if (!FROM[action]) throw new HttpError(400, 'Unknown action', 'bad_action');
  if (!FROM[action].includes(g.state) || (at !== undefined && at !== g.qIndex)) return state(gameId, { staff: true });
  const [{ total }] = await d.select({ total: sql<number>`count(*)::int` }).from(QQ).where(eq(QQ.quizId, g.quizId));
  let set: Partial<typeof G.$inferInsert>;
  if (action === 'next') {
    const nxt = g.qIndex + 1;
    set = nxt >= total ? { state: 'ended', endedAt: new Date() } : { state: 'question', qIndex: nxt, qStartedAt: new Date() };
  } else if (action === 'reveal') set = { state: 'reveal' };
  else set = { state: 'ended', endedAt: new Date() };
  // conditional on the state we read, so two requests racing cannot both move it
  const moved = await d
    .update(G)
    .set(set)
    .where(and(eq(G.id, gameId), eq(G.state, g.state), eq(G.qIndex, g.qIndex)))
    .returning({ id: G.id });
  if (moved.length) await publish(channel(gameId), action);
  return state(gameId, { staff: true });
}

export async function results(gameId: number) {
  const d = db();
  const [g] = await d.select().from(G).where(eq(G.id, gameId)).limit(1);
  if (!g) throw new HttpError(404, 'No such game', 'no_game');
  const players = await d.execute<{
    student_id: number;
    nickname: string;
    avatar: string;
    score: number;
    best_streak: number;
    correct: number;
    answered: number;
  }>(sql`
    select p.student_id, p.nickname, p.avatar, p.score, p.best_streak,
           count(a.*) filter (where a.correct)::int as correct, count(a.*)::int as answered
    from ${PL} p left join ${AN} a on a.game_id = p.game_id and a.student_id = p.student_id
    where p.game_id = ${gameId}
    group by p.game_id, p.student_id
    order by p.score desc`);
  const questions = await d.execute<{ ord: number; q: string; opts: string[]; answer: number; got_it: number; tried: number }>(sql`
    select q.ord, q.q, q.opts, q.answer,
           count(a.*) filter (where a.correct)::int as got_it, count(a.*)::int as tried
    from ${QQ} q left join ${AN} a on a.question_id = q.id and a.game_id = ${gameId}
    where q.quiz_id = ${g.quizId}
    group by q.id order by q.ord, q.id`);
  return { players: players.rows, questions: questions.rows };
}
