import { StaffShell } from '@/components/staff/StaffShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <StaffShell>{children}</StaffShell>;
}
