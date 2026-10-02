import { z } from 'zod';
import { handle, body, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { logActivity } from '@/lib/server/audit';
import { invalidate, TAG } from '@/lib/server/cache';
import { BSWL_SYLLABUS } from '@/lib/shared/constants';
import { sql } from 'drizzle-orm';

/* Unit weightage (#10). One row per syllabus unit, Leon's estimate.
   PUBLISHED IS ALL OR NOTHING: every save writes all units, and one switch
   shows or hides the whole map — half a map reads as "the rest are worth nothing". */

const UNITS = BSWL_SYLLABUS.map((u) => u.u);

async function rows() {
  return db().select().from(schema.unitWeights);
}

export const GET = handle(async () => {
  await requireStaff('app.manage');
  const have = new Map((await rows()).map((r) => [r.unit, r]));
  return jsonCached({
    rows: UNITS.map((u) => {
      const r = have.get(u);
      return { unit: u, band: r?.band ?? 'medium', share: r?.share ?? null, note: r?.note ?? '', published: r?.published ?? false };
    }),
  });
});

async function write(list: { unit: string; band: string; share: number | null; note: string | null; published: boolean }[]) {
  await db()
    .insert(schema.unitWeights)
    .values(list.map((r) => ({ ...r, updatedAt: new Date() })))
    .onConflictDoUpdate({
      target: schema.unitWeights.unit,
      set: {
        band: sql`excluded.band`,
        share: sql`excluded.share`,
        note: sql`excluded.note`,
        published: sql`excluded.published`,
        updatedAt: sql`now()`,
      },
    });
  await invalidate(TAG.weights);
}

/** Save: every unit, keeping the current published state. */
export const PUT = handle(async (req) => {
  const p = await requireStaff('app.manage');
  const b = await body(
    req,
    z.object({
      rows: z.array(
        z.object({
          unit: z.string(),
          band: z.enum(['high', 'medium', 'low']),
          share: z.number().int().min(0).max(100).nullable(),
          note: z.string().trim().max(160).nullable(),
        }),
      ),
    }),
  );
  const cur = await rows();
  const published = cur.some((r) => r.published);
  const given = new Map(b.rows.map((r) => [r.unit, r]));
  await write(
    UNITS.map((u) => {
      const r = given.get(u);
      return { unit: u, band: r?.band ?? 'medium', share: r?.share ?? null, note: r?.note || null, published };
    }),
  );
  await logActivity(p.id, 'Unit weightage saved', `by ${p.name}`);
  return { ok: true };
});

/** The one switch: publish or hide all units together. */
export const POST = handle(async (req) => {
  const p = await requireStaff('app.manage');
  const b = await body(req, z.object({ published: z.boolean() }));
  const have = new Map((await rows()).map((r) => [r.unit, r]));
  await write(
    UNITS.map((u) => {
      const r = have.get(u);
      return { unit: u, band: r?.band ?? 'medium', share: r?.share ?? null, note: r?.note ?? null, published: b.published };
    }),
  );
  await logActivity(p.id, b.published ? 'Unit weightage published' : 'Unit weightage hidden', `by ${p.name}`);
  return { ok: true };
});
