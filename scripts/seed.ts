/* Idempotent seed. Runs on every deploy after migrate; only fills what is empty.

   1. app_config row 1 with the default student-app configuration
   2. the 8 syllabus units in unit_weights (unpublished — Leon rates them)
   3. the 18 real chapters (027) for the coming syllabus switch
   4. the first OWNER account from SEED_OWNER_* when the staff table is empty
   5. SEED_DEMO=1 → a demo roster with fees, attendance and class log */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import * as s from '../src/db/schema';
import { DEFAULT_APP_CONFIG, BSWL_SYLLABUS, LOC_LABEL, bswlFee, CFG } from '../src/lib/shared/constants';

const CHAPTERS: [string, string][] = [
  ['1', 'Foundation of biz and biz env'],
  ['2', 'BSR and Ethics'],
  ['3', 'Govt. and Biz'],
  ['4', 'Biz Organizations'],
  ['5', 'Entrepreneurship'],
  ['6', 'SMEs'],
  ['7', 'Money and Fin Institutions'],
  ['8', 'Insurance'],
  ['9', 'Communication'],
  ['10', 'Transportation, W/Housing, Logistics'],
  ['11', 'Trade'],
  ['12', 'Management'],
  ['13', 'Operations'],
  ['14', 'Marketing'],
  ['15', 'Finance'],
  ['16', 'HR'],
  ['17', 'Info systems'],
  ['18', 'Biz Plan'],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({
    connectionString: url,
    ssl: /sslmode=require|\.proxy\.rlwy\.net/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool, { schema: s });

  // 1 · config
  await db.insert(s.appConfig).values({ id: 1, config: DEFAULT_APP_CONFIG, studio: {} }).onConflictDoNothing();

  // 2 · unit weights for the 8 units the apps use today
  await db
    .insert(s.unitWeights)
    .values(BSWL_SYLLABUS.map((u) => ({ unit: u.u, band: 'medium', published: false })))
    .onConflictDoNothing();

  // 3 · chapters
  await db
    .insert(s.chapters)
    .values(CHAPTERS.map(([ch, name], i) => ({ ch, name, sort: i + 1 })))
    .onConflictDoNothing();

  // 4 · first owner
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.staff);
  if (n === 0) {
    const email = (process.env.SEED_OWNER_EMAIL || '').trim().toLowerCase();
    const pw = process.env.SEED_OWNER_PASSWORD || '';
    if (!email || pw.length < 10) {
      console.warn('[seed] no staff yet and SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD (10+ chars) not set — skipping owner');
    } else {
      await db.insert(s.staff).values({
        name: process.env.SEED_OWNER_NAME || 'Owner',
        email,
        role: 'owner',
        active: true,
        mustChangePassword: true,
        passwordHash: await hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 }),
      });
      console.log(`[seed] created owner ${email} — they will be asked to change the password on first sign-in`);
    }
  }

  // 5 · demo data
  if (process.env.SEED_DEMO === '1') await demo(db);

  console.log('[seed] done');
  await pool.end();
}

/* ── demo roster: a deterministic, smaller version of the original seedData() ── */
async function demo(db: ReturnType<typeof drizzle<typeof s>>) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.students);
  if (n > 0) {
    console.log('[seed] students exist — demo data skipped');
    return;
  }
  let seed = 20260715;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const FIRST = ['Amaya', 'Nadun', 'Sachini', 'Kavindu', 'Dilini', 'Tharindu', 'Hiruni', 'Isuru', 'Nethmi', 'Pasindu', 'Sanduni', 'Ravindu', 'Chamodi', 'Yasiru', 'Imasha', 'Dulaj', 'Senuri', 'Kasun', 'Anjali', 'Lahiru', 'Methmi', 'Dinuka', 'Tharushi', 'Sahan', 'Piumi', 'Janith', 'Oshadi', 'Supun', 'Rashmi', 'Vihanga'];
  const LAST = ['Perera', 'Fernando', 'Silva', 'Jayasinghe', 'Wijesinghe', 'Bandara', 'Dissanayake', 'Gunawardena', 'Rathnayake', 'Herath'];
  const roster: [number, string, number][] = [
    [0, 'Kings', 10], [0, 'JMC', 3], [0, 'Residence', 5], [0, 'Online', 3],
    [1, 'Kings', 8], [1, 'Sasik', 2], [1, 'Residence', 6], [1, 'Online', 3],
  ];
  const used = new Set<string>();
  const today = new Date();
  const ym = (d: Date) => d.toISOString().slice(0, 7);
  const rows: (typeof s.students.$inferInsert)[] = [];
  for (const [cohort, loc, count] of roster) {
    for (let i = 0; i < count; i++) {
      let name = '';
      do name = `${pick(FIRST)} ${pick(LAST)}`;
      while (used.has(name));
      used.add(name);
      const program = loc === 'Residence' ? 'Theory' : pick(['Theory', 'Theory', 'Revision', 'Combined']);
      const joined = new Date(today.getFullYear(), today.getMonth() - Math.floor(rnd() * 8), 3 + Math.floor(rnd() * 20));
      rows.push({
        name,
        phone: `07${pick([1, 2, 5, 6, 7, 8])} ${String(Math.floor(rnd() * 90) + 10)} ${String(Math.floor(rnd() * 9000) + 1000)}`,
        program,
        cohort,
        loc,
        co: LOC_LABEL[loc],
        joined: joined.toISOString().slice(0, 10),
        status: 'active',
        level: pick(['good', 'good', 'okay', 'okay', 'okay', 'bad']),
        fee: bswlFee(program, cohort) ?? 3000,
      });
    }
  }
  const inserted = await db.insert(s.students).values(rows).returning();
  await db.insert(s.recurringPlans).values(
    inserted.map((st) => ({ id: st.id, name: st.name, phone: st.phone, cohort: st.cohort, program: st.program, loc: st.loc, fee: st.fee, joined: st.joined, status: 'active' })),
  );
  const pays: (typeof s.recurringPayments.$inferInsert)[] = [];
  const nowYm = ym(today);
  for (const st of inserted) {
    let m = st.joined!.slice(0, 7);
    while (m <= nowYm) {
      const cur = m === nowYm;
      const r = rnd();
      const fee = st.fee ?? 3000;
      if (cur ? r < 0.68 : r < 0.9) pays.push({ planId: st.id, month: m, amount: fee, status: 'paid', paidAt: `${m}-05` });
      else if (cur ? r < 0.78 : r < 0.96) pays.push({ planId: st.id, month: m, amount: Math.round((fee * 0.5) / 500) * 500, status: 'partial', paidAt: `${m}-08` });
      const [y, mo] = m.split('-').map(Number);
      m = ym(new Date(Date.UTC(y, mo, 1)));
    }
  }
  if (pays.length) await db.insert(s.recurringPayments).values(pays);

  // ten weekly classes, Saturdays back from today
  const sat = new Date(today);
  sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7));
  const att: (typeof s.attendance.$inferInsert)[] = [];
  const log: (typeof s.classLog.$inferInsert)[] = [];
  const topics0 = BSWL_SYLLABUS.flatMap((u) => u.topics.map((t) => t[0]));
  for (let w = 9; w >= 0; w--) {
    const d = new Date(sat);
    d.setDate(d.getDate() - w * 7);
    const iso = d.toISOString().slice(0, 10);
    for (const st of inserted) if (st.joined! <= iso) att.push({ studentId: st.id, date: iso, present: (st.id * 7 + w * 3) % 10 !== 0 });
    const idx = 9 - w;
    log.push({ date: iso, cohort: 0, topics: topics0.slice(idx * 2, idx * 2 + 2) });
    if (idx < 4) log.push({ date: iso, cohort: 1, topics: topics0.slice(idx * 2, idx * 2 + 2) });
  }
  if (att.length) await db.insert(s.attendance).values(att).onConflictDoNothing();
  await db.insert(s.classLog).values(log).onConflictDoNothing();

  await db.insert(s.records).values([
    { name: 'Hasini Perera', co: `${CFG.cohorts[0]} · Theory`, phone: '077 123 4567', stage: 'new', value: 2900, createdOn: today.toISOString().slice(0, 10), batch: 0, prog: 'Theory', followUp: today.toISOString().slice(0, 10) },
    { name: 'Ruwan Silva', co: `${CFG.cohorts[1]} · Theory`, phone: '071 555 1234', stage: 'contacted', value: 3000, createdOn: today.toISOString().slice(0, 10), batch: 1, prog: 'Theory' },
    { name: 'Malsha Fernando', co: `${CFG.cohorts[0]} · Combined`, phone: '076 222 9876', stage: 'quoted', value: 5500, createdOn: today.toISOString().slice(0, 10), batch: 0, prog: 'Combined' },
  ]);
  console.log(`[seed] demo: ${inserted.length} students, ${pays.length} payments, ${att.length} attendance marks`);
}

main().catch((e) => {
  console.error('[seed] failed:', e);
  process.exit(1);
});
