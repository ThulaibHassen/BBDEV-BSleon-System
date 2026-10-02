import { handle, body, query, jsonCached } from '@/lib/server/api';
import { requireStaff } from '@/lib/server/auth';
import { createRecord, listRecords, RecordInput } from '@/server/crm';

/** Enquiries this role may see (?owner=all|<staffId> narrows for masters). */
export const GET = handle(async (req) => {
  const p = await requireStaff('enquiries.view.own');
  return jsonCached({ rows: await listRecords(p, query(req).get('owner')) });
});

export const POST = handle(async (req) => {
  const p = await requireStaff('enquiries.write');
  return { record: await createRecord(p, await body(req, RecordInput)) };
});
