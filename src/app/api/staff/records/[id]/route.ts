import { z } from 'zod';
import { handle, body, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { getRecord, moveStage, RecordInput, updateRecord } from '@/server/crm';

export const GET = handle<{ id: string }>(async (_req, ctx) => {
  const p = await requireStaff('enquiries.view.own');
  return { record: await getRecord(p, await paramId(ctx)) };
});

/* Two shapes: the full edit from the modal, or { stage } from a board drag
   ({ stage, undo: true } reverses that drag). */
const Move = z.object({ stage: z.string().min(1).max(20), undo: z.boolean().optional() }).strict();

export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('enquiries.write');
  const id = await paramId(ctx);
  const raw = await body(req, z.record(z.string(), z.unknown()));
  const mv = Move.safeParse(raw);
  if (mv.success) return { record: await moveStage(p, id, mv.data.stage, !!mv.data.undo) };
  return { record: await updateRecord(p, id, RecordInput.parse(raw)) };
});
