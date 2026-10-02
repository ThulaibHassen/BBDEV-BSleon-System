import { handle, query } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { db, schema } from '@/lib/server/db';
import { listRecords } from '@/server/crm';
import { getStudio } from '@/server/config';

/* THE EXPORT CARRIES THE ROWS ON SCREEN: the same owner / stage / search
   narrowing the page applies, sorted the same way (value, high first). */
export const GET = handle(async (req) => {
  const p = await requireStaff('enquiries.view.own');
  const qs = query(req);
  const stage = qs.get('stage') || 'all';
  const q = (qs.get('q') || '').trim().toLowerCase();
  const studio = await getStudio();
  const team = await db().select({ id: schema.staff.id, name: schema.staff.name }).from(schema.staff);
  const who = new Map(team.map((t) => [t.id, t.name]));
  const label = (k: string) => studio.stages.find((s) => s.k === k)?.label ?? k;
  const rows = (await listRecords(p, qs.get('owner')))
    .filter((r) => stage === 'all' || r.stage === stage)
    .filter((r) => !q || `${r.name} ${r.co} ${r.phone}`.toLowerCase().includes(q));

  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // a text cell starting = + - @ is run as a formula by Excel: keep it plain text
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Name', 'Company', 'Phone', 'Stage', 'Owner', 'Follow-up', `Value (${studio.currency})`];
  const lines = rows.map((r) => [r.name, r.co, r.phone, label(r.stage), r.owner ? (who.get(r.owner) ?? '') : '', r.followUp ?? '', r.value ?? '']);
  const csv = '﻿' + [head, ...lines].map((l) => l.map(cell).join(',')).join('\r\n');
  const file = `${studio.app.client.toLowerCase().replace(/\s+/g, '-')}-${studio.entity.plural.toLowerCase()}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'private, no-store',
      'X-Row-Count': String(rows.length),
    },
  });
});
