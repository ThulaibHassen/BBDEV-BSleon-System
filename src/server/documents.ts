import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { PDFDocument, type PDFImage } from 'pdf-lib';
import { z } from 'zod';
import { db, schema } from '@/lib/server/db';
import { HttpError } from '@/lib/server/auth';
import { notFound } from '@/lib/server/api';
import { putObject, getObject, deleteObject, sniffPdf, sniffImage, pdfPageCount, LIMITS } from '@/lib/server/storage';
import { invalidateLibrary } from '@/server/library';

/* Staff side of the document library: upload, edit, pair, replace, delete.
   The student side (who may open what, tickets) is server/library.ts.

   A PDF is checked by its bytes (%PDF), capped at LIMITS.pdfBytes and hashed:
   an exact duplicate is refused with the title it already has, so the same
   scan never ends up in the app twice under two names. */

const D = schema.documents;

export const DOC_KIND_KEYS = ['paper', 'scheme', 'tute', 'mcq', 'target', 'guide', 'other'] as const;

const isoOrNull = z
  .string()
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v == null || v === '') return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'not a date' });
      return z.NEVER;
    }
    return d;
  });

/* Year is typed as text in the form; '' means none, anything else must be a
   plausible exam year. */
const yearIn = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v == null || String(v).trim() === '') return null;
    const n = Number(String(v).trim());
    if (!Number.isInteger(n) || n < 1990 || n > 2100) {
      ctx.addIssue({ code: 'custom', message: 'Year must be between 1990 and 2100' });
      return z.NEVER;
    }
    return n;
  });

/** Part is free text ('I', 'II', 'MCQ', 'Structured' …); '' means none. */
const partIn = z
  .string()
  .trim()
  .max(20, 'Part is at most 20 characters')
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

/* Language and source are free text too (en/si/ta, orig/leon are the usual);
   both columns are NOT NULL, so blank is refused rather than stored. */
const wordIn = (what: string) => z.string().trim().min(1, `${what} cannot be blank`).max(20, `${what} is at most 20 characters`).optional();

/** Leon's own typed copies carry real text; scans do not. */
export const isLeon = (source: string | null | undefined) => (source ?? '').trim().toLowerCase() === 'leon';

/** Metadata shared by upload and edit. Every field optional so PATCH can send one. */
export const DocMeta = z.object({
  title: z.string().trim().min(1, 'A document needs a title').max(160).optional(),
  kind: z.enum(DOC_KIND_KEYS).optional(),
  year: yearIn,
  part: partIn,
  lang: wordIn('Language'),
  source: wordIn('Source'),
  unit: z.string().trim().max(8).nullable().optional(),
  cohort: z.coerce.number().int().min(0).max(9).nullable().optional(),
  audience: z.enum(['public', 'students', 'staff']).optional(),
  published: z.boolean().optional(),
  availableFrom: isoOrNull,
  availableUntil: isoOrNull,
  pairId: z.coerce.number().int().positive().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type DocMetaIn = z.infer<typeof DocMeta>;

/** multipart fields arrive as strings; '' means "not set". */
export function metaFromForm(f: FormData): DocMetaIn {
  const s = (k: string) => {
    const v = f.get(k);
    return typeof v === 'string' ? v : undefined;
  };
  const nul = (k: string) => {
    const v = s(k);
    return v === undefined ? undefined : v.trim() === '' ? null : v;
  };
  return DocMeta.parse({
    // a blank title falls back to the file name (or "12 images")
    title: s('title')?.trim() || undefined,
    kind: s('kind') || undefined,
    year: nul('year'),
    part: nul('part'),
    lang: s('lang') || undefined,
    source: s('source') || undefined,
    unit: nul('unit'),
    cohort: nul('cohort'),
    audience: s('audience') || undefined,
    published: s('published') === undefined ? undefined : s('published') === 'true',
    availableFrom: nul('availableFrom'),
    availableUntil: nul('availableUntil'),
    pairId: nul('pairId'),
    note: nul('note'),
  });
}

function checkWindow(from: Date | null | undefined, until: Date | null | undefined) {
  if (from && until && until <= from) throw new HttpError(400, 'The window closes before it opens.', 'invalid');
}


export async function listStaff(f: { kind?: string | null; year?: number | null; published?: boolean | null; q?: string | null }) {
  const where: SQL[] = [];
  if (f.kind) where.push(eq(D.kind, f.kind));
  if (f.year) where.push(eq(D.year, f.year));
  if (f.published != null) where.push(eq(D.published, f.published));
  if (f.q) where.push(sql`${D.title} ilike ${'%' + f.q.replace(/[%_]/g, '') + '%'}`);
  const rows = await db()
    .select({
      id: D.id,
      title: D.title,
      kind: D.kind,
      year: D.year,
      part: D.part,
      lang: D.lang,
      source: D.source,
      unit: D.unit,
      cohort: D.cohort,
      audience: D.audience,
      published: D.published,
      availableFrom: D.availableFrom,
      availableUntil: D.availableUntil,
      pairId: D.pairId,
      originalName: D.originalName,
      bytes: D.bytes,
      pages: D.pages,
      hasText: D.hasText,
      note: D.note,
      createdAt: D.createdAt,
      updatedAt: D.updatedAt,
      opens30: sql<number>`(select count(*)::int from ${schema.documentLog} l where l.document_id = "documents"."id" and not l.as_staff and l.issued_at >= now() - interval '30 days')`,
      usedBy: sql<number>`(select count(*)::int from ${schema.mcqPapers} p where p.document_id = "documents"."id")`,
    })
    .from(D)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(D.year), D.part, sql`${D.kind} desc`, D.lang, desc(D.id));
  return rows;
}

/** scanned: made from pictures, so never searchable text */
type Pdf = { buf: Uint8Array; sha256: string; name: string; pages: number | null; scanned?: boolean };

const sha = (buf: Uint8Array) => createHash('sha256').update(buf).digest('hex');

/* The quick byte count misses pages kept in compressed object streams
   (most PDFs saved by modern tools); pdf-lib reads those properly. */
async function countPages(buf: Uint8Array) {
  const quick = pdfPageCount(buf);
  if (quick) return quick;
  try {
    return (await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch {
    return null;
  }
}

async function readPdf(file: unknown): Promise<Pdf> {
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a PDF to upload.', 'no_file');
  if (file.size > LIMITS.pdfBytes) throw new HttpError(413, `That PDF is over ${LIMITS.pdfBytes / 1024 / 1024} MB. Compress it and try again.`, 'too_big');
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!sniffPdf(buf)) throw new HttpError(415, `"${file.name}" is not a PDF.`, 'not_pdf');
  return { buf, sha256: sha(buf), name: file.name.slice(0, 200), pages: await countPages(buf) };
}

async function refuseDuplicate(sha256: string, exceptId?: number) {
  const [dup] = await db()
    .select({ id: D.id, title: D.title })
    .from(D)
    .where(exceptId ? and(eq(D.sha256, sha256), ne(D.id, exceptId)) : eq(D.sha256, sha256))
    .limit(1);
  if (dup) throw new HttpError(409, `This exact PDF is already in the library as "${dup.title}".`, 'duplicate');
}

function newKey() {
  return `docs/${new Date().getUTCFullYear()}/${randomUUID()}.pdf`;
}

/* A paper and its marking scheme point at each other. Setting a pair breaks
   any old pairing on both sides first, so a link is never one-way. */
async function setPair(tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0], id: number, pairId: number | null) {
  if (pairId === id) throw new HttpError(400, 'A document cannot be paired with itself.', 'invalid');
  if (pairId) {
    const [other] = await tx.select({ id: D.id }).from(D).where(eq(D.id, pairId)).limit(1);
    if (!other) throw new HttpError(400, 'The document to pair with was not found.', 'invalid');
  }
  await tx
    .update(D)
    .set({ pairId: null })
    .where(pairId ? or(eq(D.pairId, id), eq(D.pairId, pairId)) : eq(D.pairId, id));
  await tx.update(D).set({ pairId }).where(eq(D.id, id));
  if (pairId) await tx.update(D).set({ pairId: id }).where(eq(D.id, pairId));
}

/** The natural partner of a paper/scheme: same year, part, language and source
    (typed text, so compared without case), not yet paired. */
async function findPartner(m: { kind: string; year: number | null; part: string | null; lang: string; source: string }, selfId: number) {
  if ((m.kind !== 'paper' && m.kind !== 'scheme') || !m.year) return null;
  const other = m.kind === 'paper' ? 'scheme' : 'paper';
  const [r] = await db()
    .select({ id: D.id })
    .from(D)
    .where(
      and(
        eq(D.kind, other),
        eq(D.year, m.year),
        m.part ? sql`lower(trim(${D.part})) = ${m.part.trim().toLowerCase()}` : sql`coalesce(trim(${D.part}), '') = ''`,
        sql`lower(trim(${D.lang})) = ${m.lang.trim().toLowerCase()}`,
        sql`lower(trim(${D.source})) = ${m.source.trim().toLowerCase()}`,
        sql`${D.pairId} is null`,
        ne(D.id, selfId),
      ),
    )
    .limit(1);
  return r?.id ?? null;
}

export async function upload(file: unknown, meta: DocMetaIn, staffId: number) {
  return store(await readPdf(file), meta, staffId);
}

/** Save checked PDF bytes as a new document (a plain upload, or pictures made into one PDF). */
async function store(pdf: Pdf, meta: DocMetaIn, staffId: number) {
  await refuseDuplicate(pdf.sha256);
  checkWindow(meta.availableFrom, meta.availableUntil);
  const key = newKey();
  await putObject('documents', key, pdf.buf, 'application/pdf');
  const source = meta.source ?? 'orig';
  try {
    const row = await db().transaction(async (tx) => {
      const [r] = await tx
        .insert(D)
        .values({
          title: meta.title || pdf.name.replace(/\.pdf$/i, ''),
          kind: meta.kind ?? 'paper',
          year: meta.year ?? null,
          part: meta.part ?? null,
          lang: meta.lang ?? 'en',
          source,
          unit: meta.unit || null,
          cohort: meta.cohort ?? null,
          audience: meta.audience ?? 'students',
          published: meta.published ?? false,
          availableFrom: meta.availableFrom ?? null,
          availableUntil: meta.availableUntil ?? null,
          storageKey: key,
          originalName: pdf.name,
          bytes: pdf.buf.length,
          pages: pdf.pages,
          hasText: !pdf.scanned && isLeon(source),
          sha256: pdf.sha256,
          note: meta.note || null,
          createdBy: staffId,
        })
        .returning();
      // an explicit pair wins; otherwise link the obvious partner if there is one.
      // Same transaction: a refused pair must not leave a row whose bytes the catch deletes.
      const pairId = meta.pairId !== undefined ? meta.pairId : await findPartner(r, r.id);
      if (pairId) await setPair(tx, r.id, pairId);
      return { ...r, pairId: pairId ?? null };
    });
    await invalidateLibrary();
    return row;
  } catch (e) {
    await deleteObject('documents', key).catch(() => {});
    throw e;
  }
}

export async function update(id: number, meta: DocMetaIn) {
  const [cur] = await db().select().from(D).where(eq(D.id, id)).limit(1);
  if (!cur) throw notFound('That document');
  const from = meta.availableFrom !== undefined ? meta.availableFrom : cur.availableFrom;
  const until = meta.availableUntil !== undefined ? meta.availableUntil : cur.availableUntil;
  checkWindow(from, until);
  const { pairId, ...rest } = meta;
  const set: Partial<typeof D.$inferInsert> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (set as Record<string, unknown>)[k] = v === '' ? null : v;
  // only a change of source re-decides it: the edit panel sends every field,
  // and a PDF made of pictures must not turn "searchable" on an unrelated save
  if (rest.source && isLeon(rest.source) !== isLeon(cur.source)) set.hasText = isLeon(rest.source);
  await db().transaction(async (tx) => {
    await tx.update(D).set(set).where(eq(D.id, id));
    if (pairId !== undefined) await setPair(tx, id, pairId);
  });
  await invalidateLibrary();
  const [row] = await db().select().from(D).where(eq(D.id, id)).limit(1);
  return row;
}

/* Point the row at its new bytes, but only if they are still the bytes we
   started from: two "Add pages" (or a replace and a delete) at once must not
   drop one set of pages and leave its file orphaned in the bucket. The old
   bytes are unreachable afterwards; removing them is best effort. */
async function swapFile(id: number, oldKey: string, key: string, set: Partial<typeof D.$inferInsert>) {
  let moved: { id: number }[];
  try {
    moved = await db()
      .update(D)
      .set({ ...set, storageKey: key, updatedAt: new Date() })
      .where(and(eq(D.id, id), eq(D.storageKey, oldKey)))
      .returning({ id: D.id });
  } catch (e) {
    await deleteObject('documents', key).catch(() => {});
    throw e;
  }
  if (!moved.length) {
    await deleteObject('documents', key).catch(() => {});
    throw new HttpError(409, 'This PDF was changed a moment ago. Open it again and retry.', 'conflict');
  }
  await deleteObject('documents', oldKey).catch(() => {});
}

export async function replaceFile(id: number, file: unknown) {
  const [cur] = await db().select().from(D).where(eq(D.id, id)).limit(1);
  if (!cur) throw notFound('That document');
  const pdf = await readPdf(file);
  await refuseDuplicate(pdf.sha256, id);
  const key = newKey();
  await putObject('documents', key, pdf.buf, 'application/pdf');
  await swapFile(id, cur.storageKey, key, { originalName: pdf.name, bytes: pdf.buf.length, pages: pdf.pages, sha256: pdf.sha256 });
  await invalidateLibrary();
  return { id, bytes: pdf.buf.length, pages: pdf.pages };
}

export async function remove(id: number) {
  const [cur] = await db().select().from(D).where(eq(D.id, id)).limit(1);
  if (!cur) throw notFound('That document');
  const [used] = await db()
    .select({ title: schema.mcqPapers.title })
    .from(schema.mcqPapers)
    .where(eq(schema.mcqPapers.documentId, id))
    .limit(1);
  if (used) throw new HttpError(409, `The MCQ paper "${used.title}" uses this PDF. Pick another PDF there first.`, 'in_use');
  await db().transaction(async (tx) => {
    await tx.update(D).set({ pairId: null }).where(eq(D.pairId, id));
    // a tute set with this PDF keeps its date, not a link that can only fail
    await tx.update(schema.tuteAssign).set({ documentId: null }).where(eq(schema.tuteAssign.documentId, id));
    await tx.delete(D).where(eq(D.id, id));
  });
  await deleteObject('documents', cur.storageKey).catch((e) => console.warn('[library] orphan object', cur.storageKey, e));
  await invalidateLibrary();
  return cur;
}

/* ─── pictures → one PDF ───

   Phone photos of a paper become one PDF, one picture per A4 page (portrait
   or landscape to match the picture), scaled to fit inside a small margin.
   The browser already turned each picture into a JPEG of sensible size; the
   server still checks the bytes and the cap, and takes PNG as well. A PDF
   made of pictures has no text layer, whatever its source says. */

export const MAX_IMAGES = 60;
const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 18; // a quarter inch

type Img = { buf: Uint8Array; mime: 'image/jpeg' | 'image/png' };

async function readImages(files: unknown[]): Promise<Img[]> {
  if (!files.length) throw new HttpError(400, 'Choose at least one picture.', 'no_file');
  if (files.length > MAX_IMAGES) throw new HttpError(413, `At most ${MAX_IMAGES} pictures in one go.`, 'too_many');
  const out: Img[] = [];
  for (const [i, f] of files.entries()) {
    if (!(f instanceof File)) throw new HttpError(400, `Picture ${i + 1} is not a file.`, 'invalid');
    if (f.size > LIMITS.imageBytes) throw new HttpError(413, `Picture ${i + 1} is over ${LIMITS.imageBytes / 1024 / 1024} MB.`, 'too_big');
    const buf = new Uint8Array(await f.arrayBuffer());
    const mime = sniffImage(buf);
    if (mime !== 'image/jpeg' && mime !== 'image/png') throw new HttpError(415, `Picture ${i + 1} is not a JPEG or PNG.`, 'not_image');
    out.push({ buf, mime });
  }
  return out;
}

async function addImagePages(pdf: PDFDocument, imgs: Img[]) {
  for (const [i, im] of imgs.entries()) {
    let img: PDFImage;
    try {
      img = im.mime === 'image/png' ? await pdf.embedPng(im.buf) : await pdf.embedJpg(im.buf);
    } catch {
      throw new HttpError(415, `Picture ${i + 1} could not be read.`, 'not_image');
    }
    const landscape = img.width > img.height;
    const W = landscape ? A4.h : A4.w;
    const H = landscape ? A4.w : A4.h;
    const k = Math.min((W - 2 * MARGIN) / img.width, (H - 2 * MARGIN) / img.height);
    const w = img.width * k;
    const h = img.height * k;
    pdf.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
  }
}

export async function uploadImages(files: unknown[], meta: DocMetaIn, staffId: number) {
  const imgs = await readImages(files);
  const pdf = await PDFDocument.create();
  await addImagePages(pdf, imgs);
  const buf = await pdf.save();
  if (buf.length > LIMITS.pdfBytes) throw new HttpError(413, 'Those pictures make a PDF over the size limit. Use fewer pictures.', 'too_big');
  const name = `${imgs.length} image${imgs.length === 1 ? '' : 's'}`;
  return store({ buf, sha256: sha(buf), name, pages: pdf.getPageCount(), scanned: true }, meta, staffId);
}

/** Append pictures as new pages at the end of an existing document's PDF. */
export async function appendImages(id: number, files: unknown[]) {
  const [cur] = await db().select().from(D).where(eq(D.id, id)).limit(1);
  if (!cur) throw notFound('That document');
  const imgs = await readImages(files);
  let pdf: PDFDocument;
  try {
    const obj = await getObject('documents', cur.storageKey);
    pdf = await PDFDocument.load(new Uint8Array(await new Response(obj.body).arrayBuffer()));
  } catch {
    // locked or damaged PDFs are not rewritten; replacing the file is the way out
    throw new HttpError(422, 'Pages cannot be added to this PDF (it is locked or damaged). Replace the file instead.', 'unreadable');
  }
  await addImagePages(pdf, imgs);
  const buf = await pdf.save();
  if (buf.length > LIMITS.pdfBytes) throw new HttpError(413, 'With those pictures the PDF would be over the size limit.', 'too_big');
  const sha256 = sha(buf);
  await refuseDuplicate(sha256, id);
  const pages = pdf.getPageCount();
  const key = newKey();
  await putObject('documents', key, buf, 'application/pdf');
  await swapFile(id, cur.storageKey, key, { bytes: buf.length, pages, sha256 });
  await invalidateLibrary();
  return { id, title: cur.title, bytes: buf.length, pages, added: imgs.length };
}

/* ─── bulk actions from the list's checkboxes ─── */

export const BulkIn = z
  .object({
    ids: z.array(z.number().int().positive()).min(1, 'Nothing is selected').max(200, 'At most 200 at a time'),
    action: z.enum(['publish', 'unpublish', 'cohort', 'delete']),
    cohort: z.number().int().min(0).max(9).nullable().optional(),
  })
  .refine((b) => b.action !== 'cohort' || b.cohort !== undefined, { message: 'Choose a batch', path: ['cohort'] });

export type BulkSkip = { id: number; title: string; reason: string };

export async function bulk(b: z.infer<typeof BulkIn>): Promise<{ done: number; skipped: BulkSkip[] }> {
  const ids = [...new Set(b.ids)];
  const now = new Date();
  if (b.action !== 'delete') {
    const set: Partial<typeof D.$inferInsert> =
      b.action === 'cohort' ? { cohort: b.cohort ?? null, updatedAt: now } : { published: b.action === 'publish', updatedAt: now };
    const done = await db().update(D).set(set).where(inArray(D.id, ids)).returning({ id: D.id });
    await invalidateLibrary();
    return { done: done.length, skipped: [] };
  }
  /* Delete: a PDF an MCQ paper points at stays (the same rule as a single
     delete); the rest go in one transaction, their bytes afterwards. */
  const rows = await db().select({ id: D.id, title: D.title, storageKey: D.storageKey }).from(D).where(inArray(D.id, ids));
  const used = await db()
    .select({ documentId: schema.mcqPapers.documentId, title: schema.mcqPapers.title })
    .from(schema.mcqPapers)
    .where(inArray(schema.mcqPapers.documentId, ids));
  const usedBy = new Map(used.map((u) => [u.documentId, u.title]));
  const skipped = rows.filter((r) => usedBy.has(r.id)).map((r) => ({ id: r.id, title: r.title, reason: `used by the MCQ paper "${usedBy.get(r.id)}"` }));
  const go = rows.filter((r) => !usedBy.has(r.id));
  if (go.length) {
    const goIds = go.map((r) => r.id);
    await db().transaction(async (tx) => {
      await tx.update(D).set({ pairId: null }).where(inArray(D.pairId, goIds));
      await tx.update(schema.tuteAssign).set({ documentId: null }).where(inArray(schema.tuteAssign.documentId, goIds));
      await tx.delete(D).where(inArray(D.id, goIds));
    });
    for (const r of go) await deleteObject('documents', r.storageKey).catch((e) => console.warn('[library] orphan object', r.storageKey, e));
    await invalidateLibrary();
  }
  return { done: go.length, skipped };
}
