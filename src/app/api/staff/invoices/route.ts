import { body, handle } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { createInvoice, listInvoices } from '@/server/finance';
import { InvoiceSchema } from '@/components/staff/money/schemas';

export const GET = handle(async () => {
  await requireStaff('invoices.manage');
  return { invoices: await listInvoices() };
});

export const POST = handle(async (req) => {
  const p = await requireStaff('invoices.manage');
  return { invoice: await createInvoice(p, await body(req, InvoiceSchema)) };
});
