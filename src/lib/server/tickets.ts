import 'server-only';
import { createHmac } from 'node:crypto';
import { env } from './env';
import { safeEqual } from './tokens';

/* Document tickets — the same idea as the old get.php, now in-process.

   A signed-in student asks for a document; the server decides (published?
   right audience? right batch?) and answers with a URL good for 120 seconds:
       /api/files/<docId>?exp=<unix>&who=<s:12>&sig=<hmac>
   The file route checks only the signature and the clock, then streams the
   bytes from the private "documents" bucket. A link copied into WhatsApp is
   dead two minutes later. The bucket itself is never exposed. */

export const TICKET_TTL_SEC = 120;
const SKEW = 5;

function mac(docId: number, exp: number, who: string) {
  return createHmac('sha256', env().FILE_TICKET_SECRET).update(`${docId}.${exp}.${who}`).digest('base64url');
}

export function mintTicket(docId: number, who: string) {
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
  const sig = mac(docId, exp, who);
  const qs = new URLSearchParams({ exp: String(exp), who, sig });
  return { url: `/api/files/${docId}?${qs}`, expiresAt: exp };
}

export function checkTicket(docId: number, q: URLSearchParams) {
  const exp = Number(q.get('exp'));
  const who = q.get('who') || '';
  const sig = q.get('sig') || '';
  if (!exp || !who || !sig) return null;
  const now = Math.floor(Date.now() / 1000);
  if (exp + SKEW < now || exp > now + TICKET_TTL_SEC + SKEW) return null;
  if (!safeEqual(sig, mac(docId, exp, who))) return null;
  return { who };
}
