import { z } from 'zod';
import { body, handle } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { CFG } from '@/lib/shared/constants';
import { getRow, getStudio, saveStudio } from '@/server/config';
import { StudioSchema } from '@/components/staff/money/studio-schema';

/** Customize studio (owner only): the raw overrides, the applied config and the defaults. */
export const GET = handle(async () => {
  await requireStaff('settings.manage');
  const { studio } = await getRow();
  return { over: studio, cfg: await getStudio(), defaults: CFG };
});

const PutSchema = z.object({ over: StudioSchema, msg: z.string().max(80).optional() });

/* The client sends the WHOLE overrides object (like the original stuSave:
   snapshot, mutate, commit), so Undo is just putting the snapshot back. */
export const PUT = handle(async (req) => {
  const p = await requireStaff('settings.manage');
  const { over, msg } = await body(req, PutSchema);
  await saveStudio(over as Record<string, unknown>);
  if (msg) await logActivity(p.id, 'Customize', msg);
  return { over, cfg: await getStudio() };
});
