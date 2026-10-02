import { z } from 'zod';
import { body, handle } from '@/lib/server/api';
import { HttpError, requireStaff } from '@/lib/server/auth';
import { logActivity } from '@/lib/server/audit';
import { db, schema } from '@/lib/server/db';
import { can } from '@/lib/shared/rbac';
import { BSWL_PROGRAMS, LOC_LABEL, LOCS, bswlFee } from '@/lib/shared/constants';
import { todayISO } from '@/lib/shared/dates';
import { getStudio } from '@/server/config';

/* Bulk import (original 9D). The browser parses the CSV and maps columns to
   field keys; this route re-validates every row, fills the per-type
   defaults and writes everything in one transaction. A student row creates
   the student AND their fee plan (same id), as the original's two rows did. */

const Row = z.record(z.string(), z.string().max(500));
const Schema = z.object({ type: z.enum(['students', 'enquiries']), rows: z.array(Row).min(1).max(2000) });

const num = (v?: string) => {
  const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};
const cohortOf = (v?: string) => (/2028|^\s*1\s*$/.test(v ?? '') ? 1 : 0);
const programOf = (v?: string) => {
  const s = (v ?? '').toLowerCase();
  if (s.includes('combined') || (s.includes('theory') && s.includes('revision'))) return 'Combined';
  return BSWL_PROGRAMS.find((p) => s.includes(p.toLowerCase())) ?? 'Theory';
};
const locOf = (v?: string) => {
  const s = (v ?? '').trim().toLowerCase();
  return LOCS.find((k) => s === k.toLowerCase() || s.startsWith(k.toLowerCase()) || LOC_LABEL[k].toLowerCase().includes(s && s.length > 3 ? s : '\u0000')) ?? 'Kings';
};
/* a real calendar day only: '2026-02-31' passes the pattern but Postgres refuses it,
   which used to fail the whole import with a 500 */
const isoOr = (v: string | undefined, d: string) => {
  const s = (v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return d;
  const [y, m, day] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day ? s : d;
};

export const POST = handle(async (req) => {
  const p = await requireStaff('dashboard.view');
  const { type, rows } = await body(req, Schema);
  const studio = await getStudio();
  if (studio.modules.import === false) throw new HttpError(403, 'Bulk import is switched off in Customize.', 'module_off');
  const ok = rows.filter((r) => (r.name ?? '').trim());
  const skipped = rows.length - ok.length;
  if (!ok.length) throw new HttpError(400, 'No row has a name, so nothing was imported.', 'invalid');
  const today = todayISO();
  const d = db();

  if (type === 'students') {
    if (!can(p.role, 'students.write')) throw new HttpError(403, 'You do not have access to that.', 'forbidden');
    await d.transaction(async (tx) => {
      const vals = ok.map((r) => {
        const cohort = cohortOf(r.batch);
        const program = programOf(r.program);
        const loc = locOf(r.loc);
        return {
          name: r.name.trim().replace(/\s+/g, ' ').slice(0, 80),
          phone: (r.phone ?? '').trim().slice(0, 30),
          email: (r.email ?? '').trim().toLowerCase().slice(0, 120),
          program,
          cohort,
          loc,
          co: LOC_LABEL[loc],
          joined: isoOr(r.joined, today),
          school: (r.school ?? '').trim() || null,
          status: 'active',
          fee: num(r.fee) || bswlFee(program, cohort), // unknown price stays null, never guessed
          owner: p.id,
        };
      });
      const ins = await tx.insert(schema.students).values(vals).returning();
      await tx.insert(schema.recurringPlans).values(
        ins.map((s) => ({ id: s.id, name: s.name, phone: s.phone, cohort: s.cohort, program: s.program, loc: s.loc, fee: s.fee, joined: s.joined, status: 'active' })),
      );
    });
  } else {
    if (!can(p.role, 'enquiries.write')) throw new HttpError(403, 'You do not have access to that.', 'forbidden');
    const stageOf = (v?: string) => {
      const s = (v ?? '').trim().toLowerCase();
      return studio.stages.find((x) => x.k === s || x.label.toLowerCase() === s)?.k ?? studio.stages[0].k;
    };
    const at = new Date().toISOString();
    await d.insert(schema.records).values(
      ok.map((r) => ({
        name: r.name.trim().slice(0, 80),
        co: (r.co ?? '').trim().slice(0, 120),
        phone: (r.phone ?? '').trim().slice(0, 30),
        value: num(r.value),
        stage: stageOf(r.stage),
        owner: p.id,
        createdOn: today,
        acts: [{ t: 'Imported', m: 'via bulk import', at }],
      })),
    );
  }

  const label = type === 'students' ? studio.contactWord.plural : studio.entity.plural;
  await logActivity(p.id, 'Bulk import', `${ok.length} ${label.toLowerCase()} imported`);
  return { imported: ok.length, skipped };
});
