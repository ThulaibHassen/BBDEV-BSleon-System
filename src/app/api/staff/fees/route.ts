import { z } from 'zod';
import { handle, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { ymNow } from '@/lib/shared/dates';
import { ledger } from '@/server/fees';

const Ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** The fee ledger for one billing month (defaults to this month). */
export const GET = handle(async (req) => {
  await requireStaff('fees.manage');
  const raw = query(req).get('ym');
  const ym = raw ? Ym.parse(raw) : ymNow();
  return ledger(ym > ymNow() ? ymNow() : ym);
});
