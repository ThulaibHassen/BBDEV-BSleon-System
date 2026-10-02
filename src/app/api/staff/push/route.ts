import { z } from 'zod';
import { handle, body, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { saveAppConfig } from '@/server/config';
import { pushConfig, pushStatus, runReminders, sendTest, slots } from '@/server/push-reminders';

/* Phone reminders: settings (app_config.config.push), live status,
   "Send test" to one student and "Send due reminders now". */

export const GET = handle(async () => {
  await requireStaff('app.manage');
  const [config, status] = await Promise.all([pushConfig(), pushStatus()]);
  return jsonCached({ config, status });
});

const hr = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'am' : 'pm'}`;
const Hour = z.number().int().min(6).max(22);
const Day = z.number().int().min(1).max(28);

export const PUT = handle(async (req) => {
  const p = await requireStaff('app.manage');
  const b = await body(
    req,
    z.object({
      on: z.boolean(),
      max: z.number().int().min(1).max(4),
      from: Hour,
      to: Hour,
      kinds: z.object({
        recording: z.boolean(),
        tute: z.boolean(),
        checkin: z.boolean(),
        exam: z.boolean(),
        topics: z.boolean(),
        comeback: z.boolean(),
      }),
      parent: z.object({ on: z.boolean(), day: Day, day2: Day, hour: Hour }),
    }),
  );
  const to = Math.max(b.from, b.to);
  // the follow-up cannot land before the first one
  const day2 = b.parent.day2 > b.parent.day ? b.parent.day2 : Math.min(28, b.parent.day + 7);
  const push = { ...b, to, parent: { ...b.parent, day2 } };
  await saveAppConfig({ push });
  await logActivity(p.id, 'Student reminders updated', b.on ? `On · ${b.max} a day · ${slots(b.max, b.from, to).map(hr).join(', ')}` : 'Off');
  return { ok: true };
});

export const POST = handle(async (req) => {
  const p = await requireStaff('app.manage');
  const b = await body(req, z.union([z.object({ test: z.literal(true), studentId: z.number().int().positive() }), z.object({ run: z.literal(true) })]));
  if ('test' in b) return sendTest(b.studentId, p.id);
  return runReminders('run');
});
