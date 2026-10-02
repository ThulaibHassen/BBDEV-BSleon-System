'use client';

import { createContext, useContext } from 'react';
import type { Permission, StaffRole } from '@/lib/shared/rbac';

export type Me = { id: number; name: string; role: StaffRole; email: string; mustChangePassword: boolean };
export type StaffConfig = {
  modules: Record<string, boolean>;
  entity: { singular: string; plural: string };
  contactWord: { singular: string; plural: string };
  feeLabel: string;
  stages: { k: string; label: string; color: string; prob: number; board: boolean; terminal?: 'won' | 'lost' }[];
  lostReasons: string[];
  waTemplate: string;
  monthlyTarget: number;
  cadence: number[];
  company: { name: string; phone: string; email: string; address: string; regNo: string };
  recurring: { label: string; amount: number; cycle: string; waRemind: string };
  fieldLabels: Partial<Record<'name' | 'co' | 'phone' | 'value' | 'followUp' | 'owner' | 'stage', string>>;
  brand: { brand?: string; dark?: string; sidebar?: string; onAccent?: string; logo?: string | null };
  app: { client: string; tagline: string };
  team: { id: number; name: string; role: StaffRole; active: boolean }[];
};

export type StaffCtx = {
  me: Me;
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
  isMaster: boolean; // manager or owner
  config: StaffConfig;
  refreshConfig: () => void;
  refreshBadges: () => void;
};

export const StaffContext = createContext<StaffCtx | null>(null);

export function useStaff() {
  const c = useContext(StaffContext);
  if (!c) throw new Error('useStaff outside the staff shell');
  return c;
}
