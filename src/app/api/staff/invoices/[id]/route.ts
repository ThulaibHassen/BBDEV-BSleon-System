import { body, handle, paramId } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { updateInvoice } from '@/server/finance';
import { logActivity } from '@/lib/server/audit';
import { InvoicePatchSchema } from '@/components/staff/money/schemas';

/** Edit an invoice (also how Undo puts a payment back). */
export const PATCH = handle<{ id: string }>(async (req, ctx) => {
  const p = await requireStaff('invoices.manage');
  const id = await paramId(ctx);
  const invoice = await updateInvoice(id, await body(req, InvoicePatchSchema));
  await logActivity(p.id, 'Invoice edited', `${invoice.ref} · ${invoice.cust} · LKR ${invoice.paid} of ${invoice.amount} paid`);
  return { invoice };
});
