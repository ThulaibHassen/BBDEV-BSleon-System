import { body, handle, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { payInvoice } from '@/server/finance';
import { InvoicePaySchema } from '@/components/staff/money/schemas';

/** Record a payment; no amount = mark paid in full. Returns the old values for Undo. */
export const POST = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('invoices.manage');
  const id = await paramId(ctx);
  return payInvoice(p, id, await body(req, InvoicePaySchema));
});
