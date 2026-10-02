import 'server-only';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/server/db';
import { cached, invalidate, TAG } from '@/lib/server/cache';
import { CFG, DEFAULT_APP_CONFIG, FLOOR_MODULES, type AppConfig } from '@/lib/shared/constants';

/* app_config row 1 holds two JSON documents:
   config — the student-app configuration (features, road, rewards, push …)
   studio — the owner's Customize overrides for the staff app
   Both are read through the cache; every write invalidates TAG.config. */

type Row = { config: Record<string, unknown>; studio: Record<string, unknown> };

async function loadRow(): Promise<Row> {
  const [r] = await db().select().from(schema.appConfig).where(eq(schema.appConfig.id, 1)).limit(1);
  return { config: r?.config ?? {}, studio: r?.studio ?? {} };
}

export const getRow = () => cached(['config', 'row'], 300, loadRow, [TAG.config]);

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T)) ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj((base as Record<string, unknown>)[k]) ? deepMerge((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

/** Student-app config with defaults filled in. */
export async function getAppConfig(): Promise<AppConfig> {
  const { config } = await getRow();
  return deepMerge(structuredClone(DEFAULT_APP_CONFIG), config);
}

export async function saveAppConfig(patch: Record<string, unknown>) {
  const { config } = await loadRow();
  const next = deepMerge(config, patch) as Record<string, unknown>;
  await db()
    .insert(schema.appConfig)
    .values({ id: 1, config: next })
    .onConflictDoUpdate({ target: schema.appConfig.id, set: { config: next, updatedAt: new Date() } });
  await invalidate(TAG.config);
  return next;
}

/* ── Studio: applyConfig() with the original locked keys ───────────────── */

export async function getStudio() {
  const { studio } = await getRow();
  return applyStudio(studio);
}

export function applyStudio(over: Record<string, unknown>) {
  const merged = deepMerge(structuredClone(CFG), over) as typeof CFG;
  // locked: app name/version, currency
  merged.app = { ...merged.app, name: CFG.app.name, version: CFG.app.version };
  merged.currency = CFG.currency;
  // floor modules always on
  for (const m of FLOOR_MODULES) merged.modules[m] = true;
  // stages: set, keys, colours and terminal flags from defaults; only label (≤24) and prob (non-terminal) overridable
  const oStages = Array.isArray((over as { stages?: unknown }).stages) ? ((over as { stages: { k: string; label?: string; prob?: number }[] }).stages) : [];
  const order = oStages.map((s) => s.k).filter((k) => CFG.stages.some((d) => d.k === k));
  const keys = [...order, ...CFG.stages.map((s) => s.k).filter((k) => !order.includes(k))];
  merged.stages = keys.map((k) => {
    const d = CFG.stages.find((s) => s.k === k)!;
    const o = oStages.find((s) => s.k === k);
    const label = typeof o?.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 24) : d.label;
    const prob = !d.terminal && typeof o?.prob === 'number' ? Math.max(0, Math.min(100, Math.round(o.prob))) : d.prob;
    return { ...d, label, prob };
  });
  if (!Array.isArray(merged.cadence) || merged.cadence.length !== 3 || merged.cadence.some((n) => typeof n !== 'number')) {
    merged.cadence = CFG.cadence;
  }
  return merged;
}

export async function saveStudio(over: Record<string, unknown>) {
  await db()
    .insert(schema.appConfig)
    .values({ id: 1, studio: over })
    .onConflictDoUpdate({ target: schema.appConfig.id, set: { studio: over, updatedAt: new Date() } });
  await invalidate(TAG.config);
}
