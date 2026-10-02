/* Small constants shared by the money pages and their API routes
   (no React, no server imports, so both sides can use them). */

export const PAYMENT_METHODS = ['Cash', 'Bank transfer', 'Card', 'Online', 'Cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
