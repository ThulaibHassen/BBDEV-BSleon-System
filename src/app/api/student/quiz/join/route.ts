import { z } from 'zod';
import { handle, body } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { join } from '@/server/quiz';
import { loadMe } from '@/server/student';

const AVATARS = ['bulb', 'star', 'bolt', 'leaf', 'moon', 'cube', 'rocket', 'anchor'] as const;
const Body = z.object({
  pin: z.string().trim().regex(/^\d{4,8}$/, 'Type the code from the class screen.'),
  nick: z.string().trim().max(18).nullish(),
  avatar: z.enum(AVATARS).default('bulb'),
});

/* Join Leon's live class quiz with the code on the class screen. */
export const POST = handle(async (req) => {
  const me = await loadMe(await requireStudent());
  const b = await body(req, Body);
  return join(b.pin, me.id, me.cohort, me.first, b.nick ?? null, b.avatar);
});
