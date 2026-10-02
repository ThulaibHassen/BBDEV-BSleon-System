import { z } from 'zod';

/* The shape the owner's Customize overrides may take (original §7). Every
   key optional; anything else is refused. Locked keys (app name/version,
   currency, floor modules, stage set) are re-imposed by applyStudio(). */

const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours must be 6-digit hex, like #E4002B');
const label = (max: number) => z.string().trim().min(1, 'Labels cannot be empty').max(max);

export const TPL_TOKENS = { wa: ['name'], remind: ['name', 'month', 'amount', 'label'] };

export function badTokens(text: string, allowed: string[]) {
  return (text.match(/\{([^}]*)\}/g) || []).filter((t) => !allowed.includes(t.slice(1, -1)));
}

const tpl = (allowed: string[]) =>
  z
    .string()
    .trim()
    .min(1, 'Messages cannot be empty')
    .max(400)
    .superRefine((v, ctx) => {
      const bad = badTokens(v, allowed);
      if (bad.length) ctx.addIssue({ code: 'custom', message: `Unknown token ${bad[0]} — use the tokens shown below the box` });
    });

export const StudioSchema = z
  .object({
    app: z.object({ client: z.string().trim().min(1, 'Business name cannot be empty').max(40), tagline: z.string().trim().max(48) }).partial(),
    brand: z.object({ brand: HEX, dark: HEX, sidebar: HEX, onAccent: HEX, logo: z.string().regex(/^\/api\/media\/\d+$/).nullable() }).partial(),
    entity: z.object({ singular: label(20), plural: label(24) }),
    contactWord: z.object({ singular: label(20), plural: label(24) }),
    recurring: z.object({ label: label(20), waRemind: tpl(TPL_TOKENS.remind) }).partial(),
    fieldLabels: z.partialRecord(z.enum(['name', 'co', 'phone', 'value', 'followUp', 'owner', 'stage']), label(26)),
    stages: z.array(z.object({ k: z.string().max(20), label: z.string().trim().min(1, 'Stage names cannot be empty').max(24), prob: z.number().min(0).max(100) })).max(10),
    monthlyTarget: z.number().int().min(1, 'Target must be a positive number').max(1_000_000_000),
    cadence: z
      .tuple([z.number().int(), z.number().int(), z.number().int()])
      .refine((c) => c.every((d) => d >= 1), 'Cadence days must be at least 1')
      .refine((c) => c[0] < c[1] && c[1] < c[2], 'Cadence days must increase: e.g. 30, 60, 90'),
    inventory: z.object({ lowThreshold: z.number().int().min(0), deadStockDays: z.number().int().min(7, 'Dead-stock window must be at least 7 days') }).partial(),
    waTemplate: tpl(TPL_TOKENS.wa),
    modules: z.record(z.string().max(20), z.boolean()),
    company: z
      .object({ name: z.string().trim().min(1, 'Company name cannot be empty').max(60), phone: z.string().trim().max(24), email: z.string().trim().max(60), address: z.string().trim().max(90), regNo: z.string().trim().max(40) })
      .partial(),
  })
  .partial()
  .strict();

export type StudioOverrides = z.infer<typeof StudioSchema>;
