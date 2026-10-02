import { z } from 'zod';
import { and, gte, sql, eq } from 'drizzle-orm';
import { handle, body, jsonCached } from '@/lib/server/api';
import { requireStaff, HttpError } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { logActivity } from '@/lib/server/audit';
import { getAppConfig, saveAppConfig } from '@/server/config';
import { accessPage } from '@/server/applogins';
import { audienceCounts } from '@/server/messages';
import { CFG, LOCS } from '@/lib/shared/constants';
import { todayISO } from '@/lib/shared/dates';

/* Student app control: one GET for the four tabs, one PATCH with a small
   set of named operations. Every change is stamped and audited server-side,
   so the activity feed cannot be skipped by a client. */

export const GET = handle(async () => {
  await requireStaff('app.manage');
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [config, access, counts, failed] = await Promise.all([
    getAppConfig(),
    accessPage(),
    audienceCounts(),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.pushLog)
      .where(and(eq(schema.pushLog.test, false), gte(schema.pushLog.sentAt, since), sql`${schema.pushLog.delivered} < ${schema.pushLog.devices}`)),
  ]);
  return jsonCached({ config, access, counts, health: { failed: failed[0]?.n ?? 0, version: CFG.app.version } });
});

const FEATURES = ['rewards', 'batchStats', 'seminars', 'weeklyPlan', 'competition'] as const;
const SHAMING = /lazy|shame|stupid|fail(ure)?s?\b|excuse/i;
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');

const Op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('feature'), key: z.enum(FEATURES), on: z.boolean().optional(), aud: z.enum(['all', 'c0', 'c1']).optional() }),
  z.object({ op: z.literal('road'), i: z.number().int().min(0).max(13), title: z.string().trim().min(1).max(60).optional(), src: z.enum(['leon', 'system', 'self', 'outcome']).optional() }),
  z.object({ op: z.literal('tier'), i: z.number().int().min(0).max(9), prize: z.string().trim().max(80).optional(), claim: z.string().trim().max(120).optional(), toggle: z.boolean().optional() }),
  z.object({ op: z.literal('checks'), k: z.enum(['recheckDays', 'minBatch']), v: z.number().int() }),
  z.object({ op: z.literal('support'), wa: z.string().trim().min(1).max(40), hours: z.string().trim().max(60) }),
  z.object({ op: z.literal('help'), help: z.string().trim().max(400) }),
  z.object({ op: z.literal('splashAdd'), line: z.string().trim() }),
  z.object({ op: z.literal('splashDel'), i: z.number().int().min(0) }),
  z.object({ op: z.literal('oath'), text: z.string().trim().max(600) }),
  z.object({
    op: z.literal('schedule'),
    examDate: ISO,
    classes: z
      .array(
        z.object({
          loc: z.enum(LOCS as [string, ...string[]]),
          cohort: z.number().int().min(0).max(1).nullable(),
          day: z.string().trim().min(1).max(20),
          time: z.string().trim().min(1).max(30),
          note: z.string().trim().max(80).optional(),
        }),
      )
      .max(40),
  }),
  z.object({
    op: z.literal('glossary'),
    items: z.array(z.object({ term: z.string().trim().min(1).max(60), def: z.string().trim().min(1).max(300), unit: z.string().trim().max(4).optional() })).max(300),
  }),
  z.object({ op: z.literal('guide'), text: z.string().max(4000) }),
  z.object({ op: z.literal('expect'), month: z.string().max(12), year: z.string().regex(/^(\d{4})?$/, 'Year as four digits.') }),
]);

const bad = (m: string) => new HttpError(400, m, 'invalid');

export const PATCH = handle(async (req) => {
  const p = await requireStaff('app.manage');
  const o = await body(req, Op);
  const cfg = await getAppConfig();
  const by = p.name;
  const today = todayISO();
  const audit = (t: string, m: string) => logActivity(p.id, t, m);

  switch (o.op) {
    case 'feature': {
      const f = { ...cfg.features[o.key] };
      if (o.aud !== undefined) {
        f.aud = o.aud;
        await audit('App feature scoped', `${o.key} → ${o.aud} · by ${by}`);
      }
      if (o.on !== undefined && o.on !== f.on) {
        f.on = o.on;
        await audit(`App feature ${o.on ? 'enabled' : 'disabled'}`, `${o.key} · by ${by}`);
      }
      f.by = by;
      f.when = today;
      await saveAppConfig({ features: { [o.key]: f } });
      break;
    }
    case 'road': {
      const road = cfg.road.map((r) => [...r]) as typeof cfg.road;
      if (o.title !== undefined) {
        road[o.i][0] = o.title;
        await audit('Road step edited', `Step ${o.i + 1} · by ${by}`);
      }
      if (o.src !== undefined) {
        road[o.i][2] = o.src;
        await audit('Road step source set', `Step ${o.i + 1} → ${o.src} · by ${by}`);
      }
      await saveAppConfig({ road });
      break;
    }
    case 'tier': {
      const tiers = cfg.rewardTiers.map((t) => ({ ...t }));
      const t = tiers[o.i];
      if (!t) throw bad('No such reward tier.');
      if (o.prize !== undefined) t.prize = o.prize;
      if (o.claim !== undefined) t.claim = o.claim;
      if (o.prize !== undefined || o.claim !== undefined) await audit('Reward tier edited', `${t.t} · by ${by}`);
      if (o.toggle) {
        t.state = t.state === 'confirmed' ? 'pending' : 'confirmed';
        await audit(`Reward tier marked ${t.state}`, `${t.t} · by ${by}`);
      }
      await saveAppConfig({ rewardTiers: tiers });
      break;
    }
    case 'checks': {
      const [lo, hi] = o.k === 'recheckDays' ? [14, 90] : [5, 50];
      if (o.v < lo || o.v > hi) throw bad(`Pick a number from ${lo} to ${hi}.`);
      await saveAppConfig({ checks: { [o.k]: o.v } });
      await audit('Self-check setting changed', `${o.k} → ${o.v} · by ${by}`);
      break;
    }
    case 'support':
      await saveAppConfig({ support: { wa: o.wa, hours: o.hours } });
      await audit('Support details changed', `by ${by}`);
      break;
    case 'help':
      await saveAppConfig({ support: { help: o.help } });
      await audit('Help wording changed', `by ${by}`);
      break;
    case 'splashAdd': {
      if (!o.line || o.line.length > 90) throw bad('One line, under 90 characters.');
      if (SHAMING.test(o.line)) throw bad('Not that tone. Useful and calm, never shaming.');
      await saveAppConfig({ splash: [...cfg.splash, o.line] });
      await audit('Splash line added', `by ${by}`);
      break;
    }
    case 'splashDel': {
      if (cfg.splash.length <= 3) throw bad('Keep at least three lines in rotation.');
      await saveAppConfig({ splash: cfg.splash.filter((_, i) => i !== o.i) });
      await audit('Splash line removed', `by ${by}`);
      break;
    }
    case 'oath': {
      if (!o.text) throw bad('The commitment cannot be empty.');
      const version = (cfg.oath.version || 0) + 1;
      await saveAppConfig({ oath: { text: o.text, version, since: today } });
      await audit('Student commitment published', `v${version} · by ${by}`);
      return { ok: true, version };
    }
    case 'schedule':
      await saveAppConfig({ schedule: { examDate: o.examDate, classes: o.classes } });
      await audit('Exam date and class times saved', `${o.examDate} · ${o.classes.length} classes · by ${by}`);
      break;
    case 'glossary':
      await saveAppConfig({ pages: { glossary: o.items } });
      await audit('Glossary saved', `${o.items.length} terms · by ${by}`);
      break;
    case 'guide':
      await saveAppConfig({ pages: { guide: o.text.trim() } });
      await audit('New-student guide saved', `by ${by}`);
      break;
    case 'expect':
      await saveAppConfig({ pages: { expect: { month: o.month, year: o.year } } });
      await audit('"What to expect" saved', `${o.month} ${o.year} · by ${by}`.trim());
      break;
  }
  return { ok: true };
});
