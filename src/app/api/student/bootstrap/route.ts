import { handle, jsonCached } from '@/lib/server/api';
import { requireStudent } from '@/lib/server/auth';
import { bootstrap } from '@/server/student';

/* Everything Today, Learn and Progress need, in one call. */
export const GET = handle(async () => {
  const p = await requireStudent();
  return jsonCached(await bootstrap(p));
});
