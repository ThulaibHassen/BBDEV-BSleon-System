'use client';

import { useState } from 'react';
import { useStaff } from '@/components/staff/StaffContext';
import { PasswordChange } from '@/components/staff/PasswordChange';
import { roleLabel } from '@/lib/shared/rbac';
import { Ok, useToast } from '@/components/staff/ui';

/* Your account — open to every role (Settings is owner-only, so managers and
   staff change their password here). Reached by tapping your name in the sidebar. */
export default function AccountPage() {
  const { me } = useStaff();
  const [changing, setChanging] = useState(false);
  const { toast } = useToast();
  return (
    <div className="card">
      <div className="card-h">
        <h3>Your account</h3>
      </div>
      <div className="card-b">
        <div className="info-grid" style={{ marginBottom: 16 }}>
          <div className="info">
            <div className="il">Name</div>
            <div className="iv">{me.name}</div>
          </div>
          <div className="info">
            <div className="il">Role</div>
            <div className="iv">{roleLabel(me.role)}</div>
          </div>
          <div className="info">
            <div className="il">Email</div>
            <div className="iv">{me.email}</div>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setChanging(true)}>
          Change password
        </button>
        <p className="hint" style={{ marginTop: 10 }}>
          Changing it signs you out on every other device.
        </p>
      </div>
      {changing && <PasswordChange
          onDone={(saved) => {
            setChanging(false);
            if (saved) toast(<Ok>Password changed — other devices are signed out</Ok>);
          }}
        />}
    </div>
  );
}
