import 'server-only';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { env } from './env';

/* Two buckets, never mixed:
     documents  PDFs — past papers, marking schemes, tutes, guides
     media      images — MCQ pictures, logos
   Both are PRIVATE. Nothing is ever linked straight to a bucket: documents
   reach a phone only through a two-minute signed ticket (lib/server/tickets),
   media through /api/media/<key> after a session check.

   Each bucket may have its own endpoint and credentials (Railway issues one
   set per bucket); otherwise the shared S3_* values are used. */

export type BucketKind = 'documents' | 'media';

const g = globalThis as unknown as { __bswlS3?: Partial<Record<BucketKind, S3Client>> };

function cfg(kind: BucketKind) {
  const e = env();
  const p = kind === 'documents' ? 'DOCS' : 'MEDIA';
  const pick = (k: string) => (e as Record<string, unknown>)[`${p}_S3_${k}`] as string | undefined;
  return {
    bucket: kind === 'documents' ? e.S3_BUCKET_DOCUMENTS : e.S3_BUCKET_MEDIA,
    endpoint: pick('ENDPOINT') || e.S3_ENDPOINT,
    region: pick('REGION') || e.S3_REGION,
    accessKeyId: pick('ACCESS_KEY_ID') || e.S3_ACCESS_KEY_ID || '',
    secretAccessKey: pick('SECRET_ACCESS_KEY') || e.S3_SECRET_ACCESS_KEY || '',
    forcePathStyle: (e.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  };
}

function client(kind: BucketKind): { s3: S3Client; bucket: string } {
  g.__bswlS3 ??= {};
  const c = cfg(kind);
  if (!g.__bswlS3[kind]) {
    g.__bswlS3[kind] = new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      forcePathStyle: c.forcePathStyle,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
  }
  return { s3: g.__bswlS3[kind]!, bucket: c.bucket };
}

/* ── local-disk driver: used when no S3 endpoint/keys are configured, so the
   app runs on a laptop with nothing but Postgres. Each bucket is a folder
   under ./.storage — still two separate stores. Never used in production
   (Railway always has the bucket variables set). ── */
let warned = false;
export function onDisk(kind: BucketKind) {
  const c = cfg(kind);
  const disk = !c.endpoint || !c.accessKeyId || !c.secretAccessKey;
  if (disk && !warned && process.env.NODE_ENV === 'production') {
    // a mistyped bucket variable must not pass silently: files written inside
    // the container vanish on the next deploy (/api/health reports it too)
    warned = true;
    console.warn(`[storage] no S3 endpoint/keys for "${kind}" — using the local .storage folder`);
  }
  return disk;
}
function diskPath(kind: BucketKind, key: string) {
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) throw new Error('bad key');
  return path.join(process.cwd(), '.storage', cfg(kind).bucket, key);
}

export async function putObject(kind: BucketKind, key: string, body: Uint8Array, contentType: string) {
  if (onDisk(kind)) {
    const p = diskPath(kind, key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
    await fs.writeFile(p + '.type', contentType);
    return;
  }
  const { s3, bucket } = client(kind);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // keys are content-addressed / unique, so the object never changes
      CacheControl: 'private, max-age=31536000, immutable',
    }),
  );
}

export type ObjectStream = {
  body: ReadableStream<Uint8Array>;
  contentLength: number;
  contentRange?: string;
  contentType?: string;
};

/** Read an object, optionally a byte range ("bytes=a-b"), as a web stream. */
export async function getObject(kind: BucketKind, key: string, range?: { start: number; end: number }): Promise<ObjectStream> {
  if (onDisk(kind)) {
    const p = diskPath(kind, key);
    const st = await fs.stat(p);
    const start = range?.start ?? 0;
    const end = range?.end ?? st.size - 1;
    const node = createReadStream(p, { start, end });
    return {
      body: Readable.toWeb(node) as ReadableStream<Uint8Array>,
      contentLength: end - start + 1,
      contentRange: range ? `bytes ${start}-${end}/${st.size}` : undefined,
      contentType: await fs.readFile(p + '.type', 'utf8').catch(() => undefined),
    };
  }
  const { s3, bucket } = client(kind);
  const out = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
  );
  return {
    body: out.Body!.transformToWebStream() as ReadableStream<Uint8Array>,
    contentLength: Number(out.ContentLength ?? 0),
    contentRange: out.ContentRange,
    contentType: out.ContentType,
  };
}

export async function objectSize(kind: BucketKind, key: string): Promise<number | null> {
  try {
    if (onDisk(kind)) return (await fs.stat(diskPath(kind, key))).size;
    const { s3, bucket } = client(kind);
    const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return Number(h.ContentLength ?? 0);
  } catch {
    return null;
  }
}

export async function deleteObject(kind: BucketKind, key: string) {
  if (onDisk(kind)) {
    await fs.rm(diskPath(kind, key), { force: true });
    await fs.rm(diskPath(kind, key) + '.type', { force: true });
    return;
  }
  const { s3, bucket } = client(kind);
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Parse a single HTTP Range header against a known size. null = whole file, 'bad' = 416. */
export function parseRange(h: string | null, size: number): { start: number; end: number } | null | 'bad' {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]); // suffix: last n bytes (iOS Safari asks for the tail first)
    if (n <= 0) return 'bad';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'bad';
  return { start, end };
}

/* ── upload validation: check the bytes, not the browser's claim ── */

export const LIMITS = {
  pdfBytes: 40 * 1024 * 1024, // a scanned paper can be large
  imageBytes: 3 * 1024 * 1024, // same 3 MB cap as the old "mcq" bucket
};

export function sniffPdf(buf: Uint8Array) {
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

export function sniffImage(buf: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)
    return 'image/webp';
  return null;
}

/** Rough page count for a PDF without a PDF library: counts /Type /Page objects. */
export function pdfPageCount(buf: Uint8Array): number | null {
  try {
    const s = Buffer.from(buf).toString('latin1');
    const m = s.match(/\/Type\s*\/Page(?!s)/g);
    return m ? m.length : null;
  } catch {
    return null;
  }
}
