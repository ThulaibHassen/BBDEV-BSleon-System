/* Pure helpers under src/lib: Colombo dates, RBAC ranks, document tickets,
   the HTTP Range parser, and the memory paths of the cache and the rate
   limiter (the fallback the app runs on when Redis is absent). No database. */

import 'dotenv/config';
process.env.REDIS_URL = ''; // force the in-process fallbacks
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  colomboParts,
  colomboToDate,
  dateToColombo,
  daysBetween,
  dPlus,
  fmtDate,
  fmtDateLong,
  fmtTime,
  monthLbl,
  monthShort,
  todayISO,
  ymShift,
} from '@/lib/shared/dates';
import { can, PAGE_TITLES, PERMISSIONS, ROLE_PERMISSIONS, STAFF_NAV } from '@/lib/shared/rbac';
import { checkTicket, mintTicket, TICKET_TTL_SEC } from '@/lib/server/tickets';
import { parseRange, sniffImage, sniffPdf } from '@/lib/server/storage';
import { cached, invalidate } from '@/lib/server/cache';
import { rateLimit } from '@/lib/server/ratelimit';
import { init2, lkr, waLink } from '@/lib/shared/constants';

/* ── dates ─────────────────────────────────────────────────────────────── */

test('dPlus crosses month ends, leap days and the year boundary', () => {
  assert.equal(dPlus('2026-01-31', 1), '2026-02-01');
  assert.equal(dPlus('2026-02-28', 1), '2026-03-01');
  assert.equal(dPlus('2028-02-28', 1), '2028-02-29');
  assert.equal(dPlus('2026-12-31', 1), '2027-01-01');
  assert.equal(dPlus('2027-01-01', -1), '2026-12-31');
  assert.equal(dPlus('2026-03-01', -1), '2026-02-28');
  assert.equal(dPlus('2026-07-15', 0), '2026-07-15');
  assert.equal(dPlus('2026-01-01', 365), '2027-01-01');
});

test('daysBetween is signed whole days, inverse of dPlus', () => {
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
  assert.equal(daysBetween('2026-01-01', '2025-12-31'), -1);
  assert.equal(daysBetween('2028-02-01', '2028-03-01'), 29);
  assert.equal(daysBetween('2026-07-15', '2026-07-15'), 0);
  for (const n of [-400, -31, -1, 0, 1, 28, 59, 366]) assert.equal(daysBetween('2026-03-31', dPlus('2026-03-31', n)), n);
});

test('ymShift wraps months and years both ways', () => {
  assert.equal(ymShift('2026-01', -1), '2025-12');
  assert.equal(ymShift('2026-12', 1), '2027-01');
  assert.equal(ymShift('2026-05', -17), '2024-12');
  assert.equal(ymShift('2026-05', 24), '2028-05');
  assert.equal(ymShift('2026-05', 0), '2026-05');
});

test('"today" flips at Colombo midnight (18:30 UTC), not UTC midnight', () => {
  assert.equal(todayISO(new Date('2026-12-31T18:29:59Z')), '2026-12-31');
  assert.equal(todayISO(new Date('2026-12-31T18:30:00Z')), '2027-01-01');
  const p = colomboParts(new Date('2026-12-31T18:30:00Z'));
  assert.deepEqual([p.y, p.m, p.d, p.h, p.min, p.dow], [2027, 1, 1, 0, 0, 5]); // a Friday, hour 0 not 24
});

test('Colombo wall time round-trips, padded or not', () => {
  assert.equal(colomboToDate('2026-10-02 09:41').toISOString(), '2026-10-02T04:11:00.000Z');
  assert.equal(colomboToDate('2026-10-02T09:41').toISOString(), '2026-10-02T04:11:00.000Z');
  assert.equal(colomboToDate('2026-10-02 9:05').toISOString(), '2026-10-02T03:35:00.000Z');
  assert.equal(colomboToDate('2026-10-02').toISOString(), '2026-10-01T18:30:00.000Z');
  assert.equal(dateToColombo(colomboToDate('2027-01-01 00:15')), '2027-01-01 00:15');
});

test('formatters', () => {
  assert.equal(fmtTime(new Date('2026-12-31T18:30:00Z')), '12:00 AM');
  assert.equal(fmtTime(new Date('2026-12-31T06:30:00Z')), '12:00 PM');
  assert.equal(fmtTime('2026-07-15T04:11:00Z'), '9:41 AM');
  assert.equal(fmtDate('2026-07-15'), '15 Jul');
  assert.equal(fmtDate('2026-07-05T10:00:00Z'), '5 Jul');
  assert.equal(fmtDate(null), '-');
  assert.equal(fmtDateLong('2026-12-01'), '1 Dec 2026');
  assert.equal(monthLbl('2026-01'), 'January 2026');
  assert.equal(monthShort('2026-12'), 'Dec 26');
});

/* ── rbac ──────────────────────────────────────────────────────────────── */

test('roles nest: staff ⊂ manager ⊂ owner, and every page has a title', () => {
  for (const p of ROLE_PERMISSIONS.staff) assert.ok(can('manager', p), p);
  for (const p of ROLE_PERMISSIONS.manager) assert.ok(can('owner', p), p);
  for (const p of ROLE_PERMISSIONS.owner) assert.ok(PERMISSIONS.includes(p), p);
  assert.equal(can(null, 'dashboard.view'), false);
  for (const n of STAFF_NAV) assert.ok(PAGE_TITLES[n.id], n.id);
});

/* ── tickets ───────────────────────────────────────────────────────────── */

test('ticket: valid for its document and two minutes, nothing else', (t) => {
  const { url } = mintTicket(42, 's7');
  const q = new URL(url, 'http://x').searchParams;
  assert.deepEqual(checkTicket(42, q), { who: 's7' });
  assert.equal(checkTicket(43, q), null); // another document
  const forged = new URLSearchParams(q);
  forged.set('who', 's8');
  assert.equal(checkTicket(42, forged), null);
  assert.equal(checkTicket(42, new URLSearchParams()), null);

  const now = Date.now();
  t.mock.method(Date, 'now', () => now + (TICKET_TTL_SEC + 4) * 1000); // inside the 5 s skew
  assert.deepEqual(checkTicket(42, q), { who: 's7' });
  t.mock.method(Date, 'now', () => now + (TICKET_TTL_SEC + 7) * 1000);
  assert.equal(checkTicket(42, q), null);
});

test('ticket: an expiry far in the future is refused even when signed', (t) => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 3600_000);
  const { url } = mintTicket(42, 's7'); // minted "an hour from now"
  t.mock.restoreAll();
  assert.equal(checkTicket(42, new URL(url, 'http://x').searchParams), null);
});

/* ── storage helpers ───────────────────────────────────────────────────── */

test('parseRange: whole file, spans, open ends, suffixes, bad', () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  for (const bad of ['bytes=-', 'bytes=100-', 'bytes=9-3', 'bytes=-0', 'items=0-1', 'bytes=0-1,4-5']) assert.equal(parseRange(bad, 100), 'bad', bad);
  assert.equal(parseRange('bytes=0-0', 0), 'bad');
});

test('sniffers look at bytes, not names', () => {
  assert.equal(sniffPdf(new TextEncoder().encode('%PDF-1.7\n')), true);
  assert.equal(sniffPdf(new TextEncoder().encode('<html>')), false);
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), 'image/png');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a......')), null);
});

/* ── memory cache ──────────────────────────────────────────────────────── */

test('cache: a miss and a hit return the same JSON shape', async () => {
  const at = new Date('2026-07-15T04:11:00Z');
  let loads = 0;
  const load = async () => (loads++, { at, n: 1 });
  const first = await cached(['t-core', 'shape'], 60, load, ['t-core']);
  const second = await cached(['t-core', 'shape'], 60, load, ['t-core']);
  assert.equal(loads, 1);
  assert.deepEqual(first, second);
  assert.equal(typeof first.at, 'string');
});

test('cache: invalidate drops every key under the tag, and only those', async () => {
  let a = 0;
  let b = 0;
  await cached(['t-core', 'a'], 60, async () => ++a, ['t-core-a']);
  await cached(['t-core', 'b'], 60, async () => ++b, ['t-core-b']);
  await invalidate('t-core-a');
  assert.equal(await cached(['t-core', 'a'], 60, async () => ++a, ['t-core-a']), 2);
  assert.equal(await cached(['t-core', 'b'], 60, async () => ++b, ['t-core-b']), 1);
});

test('cache: entries expire after their ttl', async (t) => {
  const now = Date.now();
  let n = 0;
  await cached(['t-core', 'ttl'], 10, async () => ++n);
  t.mock.method(Date, 'now', () => now + 11_000);
  assert.equal(await cached(['t-core', 'ttl'], 10, async () => ++n), 2);
});

/* ── memory rate limiter ───────────────────────────────────────────────── */

test('rate limit: the limit-th call passes, the next fails, a new window resets', async (t) => {
  const key = `t-core:${Math.random()}`;
  for (let i = 0; i < 3; i++) assert.equal((await rateLimit(key, 3, 60)).ok, true);
  const over = await rateLimit(key, 3, 60);
  assert.equal(over.ok, false);
  assert.ok(over.retryAfter > 0 && over.retryAfter <= 60);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 61_000);
  assert.equal((await rateLimit(key, 3, 60)).ok, true);
});

/* ── constants ─────────────────────────────────────────────────────────── */

test('waLink: every way a Sri Lankan number is typed reaches 94…', () => {
  for (const p of ['071 234 5678', '+94 71 234 5678', '0094712345678', '94712345678', '712345678']) {
    assert.equal(waLink(p, 'hi there'), 'https://wa.me/94712345678?text=hi%20there', p);
  }
});

test('lkr and init2', () => {
  assert.match(lkr(1234567.4), /1,234,567$/);
  assert.match(lkr(null), / 0$/);
  assert.equal(init2('anjali  perera silva'), 'AP');
  assert.equal(init2(''), '');
});
