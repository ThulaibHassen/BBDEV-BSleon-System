import 'server-only';
import { z } from 'zod';

/* One validated view of process.env. Read lazily so `next build` does not
   need production secrets, but fail loudly the first time a request needs one. */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  S3_BUCKET_DOCUMENTS: z.string().default('bswl-documents'),
  S3_BUCKET_MEDIA: z.string().default('bswl-media'),
  DOCS_S3_ENDPOINT: z.string().optional(),
  DOCS_S3_REGION: z.string().optional(),
  DOCS_S3_ACCESS_KEY_ID: z.string().optional(),
  DOCS_S3_SECRET_ACCESS_KEY: z.string().optional(),
  MEDIA_S3_ENDPOINT: z.string().optional(),
  MEDIA_S3_REGION: z.string().optional(),
  MEDIA_S3_ACCESS_KEY_ID: z.string().optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_PEPPER: z.string().min(32, 'JWT_REFRESH_PEPPER must be at least 32 characters'),
  FILE_TICKET_SECRET: z.string().min(32, 'FILE_TICKET_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  STAFF_REFRESH_DAYS: z.coerce.number().int().positive().default(14),
  STUDENT_REFRESH_DAYS: z.coerce.number().int().positive().default(60),
  CODE_TTL_MINUTES: z.coerce.number().int().positive().default(1440),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:leonfambeck@gmail.com'),
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  // the .env.example secrets are public: a server must never run on them
  if (parsed.data.NODE_ENV === 'production') {
    const weak = (['JWT_ACCESS_SECRET', 'JWT_REFRESH_PEPPER', 'FILE_TICKET_SECRET'] as const).filter((k) =>
      parsed.data[k].startsWith('change-me'),
    );
    if (weak.length) throw new Error(`Invalid environment: ${weak.join(', ')} still hold the example value — generate real secrets (see DEPLOY.md)`);
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => process.env.NODE_ENV === 'production';
