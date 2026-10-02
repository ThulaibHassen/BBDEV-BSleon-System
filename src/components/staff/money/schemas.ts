import { z } from 'zod';
import { ISO_RE, PAYMENT_METHODS } from './shared';

/* Input schemas for the money API routes (kept out of the route files,
   which may only export HTTP handlers). */

/** A real calendar day: '2026-02-31' fits the pattern but Postgres refuses it (a 500). */
export const Day = (msg = 'Pick a real date') =>
  z
    .string()
    .regex(ISO_RE, msg)
    .refine((s) => {
      const [y, m, d] = s.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1, d));
      return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
    }, msg);

export const InvoiceSchema = z.object({
  cust: z.string().trim().min(1, 'Who is it billed to?').max(120),
  studentId: z.number().int().positive().nullable().optional(),
  amount: z.number().int().positive('Amount must be above zero').max(100_000_000),
  date: Day().optional(),
  due: Day('Pick a due date'),
  ref: z.string().trim().max(40).optional(),
  method: z.string().trim().max(40).optional(),
});

export const InvoicePatchSchema = InvoiceSchema.partial().extend({
  paid: z.number().int().min(0).optional(),
});

export const InvoicePaySchema = z.object({
  amount: z.number().int().positive().optional(),
  method: z.enum(PAYMENT_METHODS).default('Cash'),
});
