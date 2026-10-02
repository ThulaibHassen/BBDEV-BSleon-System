import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { editRecording, removeRecording, setRelease, setWindow } from '@/server/classes';

/* One recording: edit the details, change who can watch it (taking access
   away needs `confirm`), change the window, or remove it from the app. */

const Edit = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date of the class.'),
  cohort: z.number().int().min(0).max(1),
  loc: z.string().max(20),
  title: z.string().trim().max(160),
  url: z.string().trim().max(1000),
  mins: z.number().int().min(0).max(600).default(0),
});
const Release = z.object({ release: z.enum(['absent', 'batch', 'picked']), confirm: z.boolean().default(false) });
const Window = z.object({ windowDays: z.union([z.literal(0), z.literal(7), z.literal(14), z.literal(30)]) });

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('classes.manage');
  const id = await paramId(ctx);
  const b = await body(req, z.union([Release, Window, Edit]));
  if ('release' in b) return setRelease(id, b.release, b.confirm, p);
  if ('windowDays' in b) {
    await setWindow(id, b.windowDays, p);
    return { ok: true };
  }
  return editRecording(id, b, p);
});

export const DELETE = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('classes.manage');
  await removeRecording(await paramId(ctx), p);
  return { ok: true };
});
