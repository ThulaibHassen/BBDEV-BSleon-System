'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { api, fetcher, post, ApiError } from '@/lib/client/api';
import { STAFF_NAV, NAV_GROUPS, PAGE_TITLES, roleLabel, type Permission } from '@/lib/shared/rbac';
import { colomboParts, DY, MN } from '@/lib/shared/dates';
import { init2 } from '@/lib/shared/constants';
import { Icon } from './Icon';
import { ToastProvider, Loading, ErrorCard } from './ui';
import { DialogProvider } from './Dialog';
import { StaffContext, type Me, type StaffConfig } from './StaffContext';
import { CommandPalette } from './CommandPalette';
import { PasswordChange } from './PasswordChange';

/* The staff chrome: sidebar (role- and module-filtered), topbar with title,
   clock (15 s), search, theme toggle and the "New Enquiry" action, plus the
   Ctrl/Cmd+K command palette. Pages render inside .content. */

type MeResp = { staff: Me; permissions: Permission[] };
type Badges = { records: number; tasks: number; rec: number };

export function StaffShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const page = pathname.split('/')[2] || 'dashboard';

  const { data: meResp, error: meErr, mutate: retryMe } = useSWR<MeResp>('/api/auth/staff/me', fetcher, { revalidateOnFocus: false });
  const { data: config, error: configErr, mutate: mutateConfig } = useSWR<StaffConfig>(meResp ? '/api/staff/config' : null, fetcher, {
    revalidateOnFocus: false,
  });
  const { data: badges, mutate: mutateBadges } = useSWR<Badges>(meResp ? '/api/staff/badges' : null, fetcher, {
    refreshInterval: 60_000,
  });

  const [sideOpen, setSideOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cmdOpen, setCmdOpen] = useState(false);
  // desktop sidebar: open (default) or folded to an icon rail, remembered per device
  const [rail, setRail] = useState(false);

  useEffect(() => {
    setDark(document.body.classList.contains('dark'));
    try {
      setRail(localStorage.getItem('bswl_side_rail') === '1');
    } catch {}
  }, []);

  const toggleRail = () => {
    const next = !rail;
    setRail(next);
    try {
      localStorage.setItem('bswl_side_rail', next ? '1' : '0');
    } catch {}
  };

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.body.classList.toggle('dark', next);
    try {
      localStorage.setItem('bswl_skel_v1_theme', next ? 'dark' : 'light');
    } catch {}
  };

  // Ctrl/Cmd+K
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  useEffect(() => setSideOpen(false), [pathname]);

  // applyBrandVars(): the owner's Customize colours, set inline on <html>, removed when cleared
  useEffect(() => {
    const b = config?.brand ?? {};
    const root = document.documentElement.style;
    const map: [string, string | null | undefined][] = [
      ['--brand', b.brand],
      ['--brand-dark', b.dark],
      ['--sidebar', b.sidebar],
      ['--on-accent', b.onAccent],
    ];
    for (const [k, v] of map) {
      if (v) root.setProperty(k, v);
      else root.removeProperty(k);
    }
  }, [config]);

  const permissions = useMemo(() => new Set(meResp?.permissions ?? []), [meResp]);
  const can = useCallback((p: Permission) => permissions.has(p), [permissions]);

  const visible = useMemo(
    () => STAFF_NAV.filter((n) => can(n.perm) && (!n.module || config?.modules?.[n.module] !== false)),
    [can, config],
  );

  // a hand-typed URL to a page this role cannot open falls back to the dashboard
  useEffect(() => {
    if (!meResp || !config) return;
    const item = STAFF_NAV.find((n) => n.id === page);
    if (item && !visible.some((v) => v.id === page)) router.replace('/staff/dashboard');
  }, [meResp, config, page, visible, router]);

  const signOut = async () => {
    try {
      await post('/api/auth/staff/logout');
    } catch {}
    window.location.href = '/staff/login';
  };

  const bootErr = meErr ?? (!config ? configErr : undefined);
  if (bootErr) {
    // a dead session: api() is already on its way to the login page
    if (bootErr instanceof ApiError && bootErr.status === 401) return null;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
        <ErrorCard error={bootErr} retry={() => void (meErr ? retryMe() : mutateConfig())} />
      </div>
    );
  }
  if (!meResp || !config) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Loading label="Opening BS With Leon…" />
      </div>
    );
  }

  const me = meResp.staff;
  const [title, sub] = titleFor(page, config);
  const ctx = {
    me,
    permissions,
    can,
    isMaster: me.role !== 'staff',
    config,
    refreshConfig: () => void mutateConfig(),
    refreshBadges: () => void mutateBadges(),
  };

  return (
    <StaffContext.Provider value={ctx}>
      <ToastProvider>
        <DialogProvider>
        <div className="statusfill" aria-hidden="true" />
        <div className={`app${rail ? ' rail' : ''}`} id="app">
          <div className={`sb-overlay${sideOpen ? ' open' : ''}`} onClick={() => setSideOpen(false)} />
          <aside className={`sidebar${sideOpen ? ' open' : ''}`} id="sidebar">
            <div className="logo-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="side-logo" src="/brand/logo-side.png" alt="BS With Leon" />
            </div>
            <nav className="nav" id="sideNav">
              {(Object.keys(NAV_GROUPS) as (keyof typeof NAV_GROUPS)[]).map((g) => {
                const items = visible.filter((n) => n.group === g);
                if (!items.length) return null;
                return (
                  <div key={g} className={`nav-group${collapsed[g] ? ' collapsed' : ''}`} data-group={g}>
                    <button className="nav-label" onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}>
                      {NAV_GROUPS[g]}
                      <span className="chev">
                        <Icon name="chev" className="" strokeWidth={3} />
                      </span>
                    </button>
                    {items.map((n) => {
                      const b = n.badge ? badges?.[n.badge as keyof Badges] : 0;
                      return (
                        <Link
                          key={n.id}
                          href={`/staff/${n.id}`}
                          className={`nav-item${page === n.id ? ' active' : ''}`}
                          title={rail ? navLabel(n.id, n.label, config) : undefined}
                          prefetch={false}
                        >
                          <Icon name={n.icon} className="" />
                          <span className="nl">{navLabel(n.id, n.label, config)}</span>
                          {b ? <span className="badge">{b}</span> : null}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
            <div className="side-foot">
              <Link href="/staff/account" className="av" title={`${me.name} · Your account`}>
                {init2(me.name)}
              </Link>
              <Link href="/staff/account" className="who" style={{ minWidth: 0, color: 'inherit' }} title="Your account">
                <div className="nm">{me.name}</div>
                <div className="rl">{roleLabel(me.role)}</div>
              </Link>
              <button className="out" title="Sign out" onClick={signOut}>
                <Icon name="out" className="" size={17} />
              </button>
            </div>
          </aside>

          <main className="main">
            <div className="topbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="side-toggle" onClick={toggleRail} aria-label={rail ? 'Expand the sidebar' : 'Collapse the sidebar'} title={rail ? 'Expand the sidebar' : 'Collapse the sidebar'} aria-expanded={!rail}>
                  <Icon name="panel" className="" />
                </button>
                <button className="hamb" onClick={() => setSideOpen((o) => !o)} aria-label="Menu">
                  <Icon name="menu" className="" />
                </button>
                <div style={{ minWidth: 0 }}>
                  <div className="pt">{title}</div>
                  <div className="ps">{sub}</div>
                </div>
              </div>
              <div className="tr">
                <Clock />
                <TopSearch />
                <button className="icon-btn" title="Toggle theme" aria-label="Toggle theme" onClick={toggleTheme}>
                  <Icon name={dark ? 'sun' : 'moon'} />
                </button>
                {can('enquiries.write') && (
                  <button className="btn-primary" onClick={() => router.push('/staff/records?new=1')}>
                    <Icon name="plus" className="" size={14} strokeWidth={2.5} />
                    <span>New {config.entity.singular}</span>
                  </button>
                )}
              </div>
            </div>
            <div className="content">
              <div className="page active" key={page}>
                {children}
              </div>
            </div>
          </main>
        </div>
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} pages={visible.map((v) => ({ id: v.id, label: navLabel(v.id, v.label, config) }))} />
        {me.mustChangePassword && <PasswordChange forced />}
        </DialogProvider>
      </ToastProvider>
    </StaffContext.Provider>
  );
}

function navLabel(id: string, label: string, c: StaffConfig) {
  if (id === 'records') return c.entity.plural;
  if (id === 'customers') return c.contactWord.plural;
  if (id === 'recurring') return `${c.recurring.label}s`;
  return label;
}

function titleFor(page: string, c: StaffConfig): [string, string] {
  if (page === 'records') return [c.entity.plural, `Every ${c.entity.singular.toLowerCase()} from first message to enrolled`];
  if (page === 'customers') return [c.contactWord.plural, 'Enrolled students, batches and referrals'];
  if (page === 'recurring') return [`${c.recurring.label} collection`, 'Who paid, collected vs expected, who owes'];
  if (page === 'account') return ['Your account', 'Password and sign-in'];
  return PAGE_TITLES[page] ?? ['BS With Leon', ''];
}

/* ── clock: h:mm AM/PM + "WED 15 JUL", every 15 s, Colombo time ── */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="tb-clock" />;
  const p = colomboParts(now);
  const h12 = p.h % 12 || 12;
  return (
    <div className="tb-clock">
      <div className="t">
        {h12}:{String(p.min).padStart(2, '0')} {p.h < 12 ? 'AM' : 'PM'}
      </div>
      <div className="d">
        {DY[p.dow]} {p.d} {MN[p.m - 1]}
      </div>
    </div>
  );
}

/* ── topbar search: students then enquiries, max 6 each ── */
type SearchHit = { kind: 'student' | 'enquiry'; id: number; name: string; meta: string };
function TopSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ hits: SearchHit[] }>(`/api/staff/search?q=${encodeURIComponent(term)}`);
        if (n === seq.current) setHits(r.hits);
      } catch {}
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const students = hits.filter((h) => h.kind === 'student');
  const enq = hits.filter((h) => h.kind === 'enquiry');
  return (
    <div className="search-wrap">
      <input
        className="search"
        placeholder="Search…"
        aria-label="Search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      <div className={`search-results${open && q.trim() ? ' open' : ''}`}>
        {students.length > 0 && <div className="sr-h">Students</div>}
        {students.map((h) => (
          <div key={`s${h.id}`} className="sr-item" onMouseDown={() => router.push(`/staff/customers?open=${h.id}`)}>
            <span className="sr-ic">{init2(h.name)}</span>
            <div>
              <div className="sr-nm">{h.name}</div>
              <div className="sr-meta">{h.meta}</div>
            </div>
          </div>
        ))}
        {enq.length > 0 && <div className="sr-h">Enquiries</div>}
        {enq.map((h) => (
          <div key={`e${h.id}`} className="sr-item" onMouseDown={() => router.push(`/staff/records?open=${h.id}`)}>
            <span className="sr-ic">{init2(h.name)}</span>
            <div>
              <div className="sr-nm">{h.name}</div>
              <div className="sr-meta">{h.meta}</div>
            </div>
          </div>
        ))}
        {!hits.length && <div className="sr-empty">No matches for &quot;{q}&quot;</div>}
      </div>
    </div>
  );
}
