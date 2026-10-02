'use client';

/* Customization Studio (original §7, owner only). Every edit goes through
   save(msg, mutator): snapshot the overrides, mutate a copy, PUT the whole
   object, and offer Undo that PUTs the snapshot back. The server validates
   the shape and re-imposes the locked keys (app name, currency, floor
   modules, the stage set). Plus: the owner's own account card and the bulk
   import entry point (System tab). */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { api, fetcher, put } from '@/lib/client/api';
import { useStaff } from '@/components/staff/StaffContext';
import { Empty, ErrorCard, Loading, Ok, Switch, useToast } from '@/components/staff/ui';
import { Icon } from '@/components/staff/Icon';
import { useDialog } from '@/components/staff/Dialog';
import { PasswordChange } from '@/components/staff/PasswordChange';
import { ImportWizard, type ImportType } from '@/components/staff/money/ImportWizard';
import { docFoot, docHead, printDoc } from '@/components/staff/money/print';
import type { StudioOverrides } from '@/components/staff/money/studio-schema';
import { CFG, FLOOR_MODULES, lkr } from '@/lib/shared/constants';

type Over = StudioOverrides;
type Brand = { brand: string; dark: string; sidebar: string; onAccent: string; logo?: string | null };
type Cfg = typeof CFG & { brand?: Partial<Brand>; inventory?: { lowThreshold?: number; deadStockDays?: number } };
type StudioResp = { over: Over; cfg: Cfg; defaults: typeof CFG };

const TABS = [
  ['brand', 'Brand'],
  ['words', 'Vocabulary'],
  ['pipeline', 'Pipeline'],
  ['numbers', 'Numbers'],
  ['messages', 'Messages'],
  ['reminders', 'Student reminders'],
  ['modules', 'Modules'],
  ['documents', 'Documents'],
  ['system', 'System'],
] as const;
type Tab = (typeof TABS)[number][0];

const BRAND_DEFAULT: Brand = { brand: '#141417', dark: '#000000', sidebar: '#101012', onAccent: '#ffffff' };
const BRAND_VARS: [keyof Brand, string, string, string][] = [
  ['brand', '--brand', 'Accent', 'the one brand colour, buttons, highlights'],
  ['dark', '--brand-dark', 'Accent pressed', 'darker shade for pressed states'],
  ['sidebar', '--sidebar', 'Sidebar', 'the app chrome colour'],
  ['onAccent', '--on-accent', 'Text on accent', 'text sitting on the accent colour'],
];
const HEX = /^#[0-9a-fA-F]{6}$/;
const TPL_TOKENS = { wa: ['name'], remind: ['name', 'month', 'amount', 'label'] };
const badTokens = (text: string, allowed: string[]) => (text.match(/\{([^}]*)\}/g) || []).filter((t) => !allowed.includes(t.slice(1, -1)));
const fillTpl = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

const MODULE_INFO: Record<string, [string, string]> = {
  pipeline: ['Board view', 'the drag-and-drop board inside Enquiries'],
  records: ['Records', 'your core list'],
  customers: ['Contacts', 'repeat business + follow-ups'],
  tasks: ['Tasks', 'team to-dos'],
  finance: ['Finance', 'invoices and collections'],
  reports: ['Reports', 'month-over-month numbers'],
  team: ['Team', 'performance per person'],
  activity: ['Activity', 'the audit trail'],
  import: ['Bulk import', 'bring in spreadsheets'],
  quotes: ['Quotes', 'line-item quotes + PDF'],
  recurring: ['Recurring fees', 'monthly collection ledger'],
  cohorts: ['Groups', 'batches / cohorts on contacts'],
  forecast: ['Forecast', 'month-by-month revenue grid'],
  inventory: ['Inventory', 'stock, alerts and photos'],
};
const OPTIONAL = ['import', 'quotes', 'recurring', 'cohorts', 'forecast', 'inventory'];

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o ?? {}));

/* ── small layout pieces (original stuCard / stuRow) ── */
function StuCard({ title, hint, children, foot }: { title: string; hint?: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="card">
      <div className="card-h">
        <h3>{title}</h3>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="card-b">
        {children}
        {foot && <div className="stu-foot">{foot}</div>}
      </div>
    </div>
  );
}
function StuRow({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="stu-row">
      <div className="sr-l">
        <div className="t">{label}</div>
        {sub && <div className="s">{sub}</div>}
      </div>
      {children}
    </div>
  );
}
const LockIc = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

type Save = (msg: string, mutate: (o: Over) => string | null | void) => Promise<void>;
type Reset = (keys: (keyof Over)[], label: string) => Promise<void>;

export default function SettingsPage() {
  const { can, refreshConfig } = useStaff();
  const { toast, toastUndo, toastError } = useToast();
  const isOwner = can('settings.manage');
  const { data, error, mutate } = useSWR<StudioResp>(isOwner ? '/api/staff/studio' : null, fetcher, { revalidateOnFocus: false });
  const [tab, setTab] = useState<Tab>('brand');
  /* Saves run one after another, each on top of the overrides the last one stored:
     two switches flipped in quick succession used to each start from the same old
     snapshot, so the second PUT silently undid the first. */
  const latest = useRef<Over | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  if (!isOwner) return <Empty icon="users" title="Owner only" sub="Only the owner account can customize the system." />;
  if (error && !data) return <ErrorCard error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;

  const push = async (over: Over, msg?: string) => {
    const r = await put<StudioResp>('/api/staff/studio', { over, msg });
    latest.current = r.over;
    await mutate({ ...data, over: r.over, cfg: r.cfg }, { revalidate: false });
    refreshConfig();
  };

  const save: Save = (msg, mutator) => {
    const run = async () => {
      const base = latest.current ?? data.over;
      const before = clone(base);
      const next = clone(base);
      const err = mutator(next);
      if (err) return toast(err);
      try {
        await push(next, msg);
        toastUndo(<Ok>{msg}</Ok>, async () => {
          try {
            await push(before);
            toast(<Ok>Undone</Ok>);
          } catch (e) {
            toastError(e);
          }
        });
      } catch (e) {
        toastError(e);
      }
    };
    const done = queue.current.then(run);
    queue.current = done;
    return done;
  };
  const reset: Reset = (keys, label) =>
    save(`${label} reset to default`, (o) => {
      for (const k of keys) delete o[k];
    });

  const props = { data, save, reset };
  return (
    <>
      <div className="stu-hero">
        <div className="sh-ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="sh-t">Customization Studio</div>
          <div className="sh-s">Make {data.cfg.app.client} yours. Every change is safe to try: undo any edit, or reset any section back to default.</div>
        </div>
      </div>
      <div className="tabbar" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="stu-sec">
        {tab === 'brand' && <BrandTab key={JSON.stringify(data.over.brand ?? {}) + JSON.stringify(data.over.app ?? {})} {...props} />}
        {tab === 'words' && <WordsTab key={JSON.stringify([data.over.entity, data.over.contactWord, data.over.fieldLabels, data.over.recurring])} {...props} />}
        {tab === 'pipeline' && <PipelineTab key={JSON.stringify(data.over.stages ?? [])} {...props} />}
        {tab === 'numbers' && <NumbersTab key={JSON.stringify([data.over.monthlyTarget, data.over.cadence, data.over.inventory])} {...props} />}
        {tab === 'messages' && <MessagesTab key={JSON.stringify([data.over.waTemplate, data.over.recurring])} {...props} />}
        {tab === 'reminders' && <RemindersTab />}
        {tab === 'modules' && <ModulesTab {...props} />}
        {tab === 'documents' && <DocumentsTab key={JSON.stringify(data.over.company ?? {})} {...props} />}
        {tab === 'system' && <SystemTab {...props} />}
      </div>
    </>
  );
}

type TabProps = { data: StudioResp; save: Save; reset: Reset };

/* ── BRAND: name, colours (live preview), logo ── */
function BrandTab({ data, save, reset }: TabProps) {
  const { toast, toastError } = useToast();
  const cur: Brand = { ...BRAND_DEFAULT, ...(data.cfg.brand ?? {}) } as Brand;
  const [name, setName] = useState(data.cfg.app.client);
  const [tag, setTag] = useState(data.cfg.app.tagline);
  const [col, setCol] = useState<Record<string, string>>({ brand: cur.brand, dark: cur.dark, sidebar: cur.sidebar, onAccent: cur.onAccent });
  const [logo, setLogo] = useState<string | null | undefined>(undefined); // undefined = unchanged
  const [uploading, setUploading] = useState(false);

  // live preview on this page; the saved values come back when you leave unsaved
  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of BRAND_VARS) if (HEX.test(col[k] ?? '')) root.style.setProperty(v, col[k]);
  }, [col]);
  useEffect(
    () => () => {
      for (const [k, v] of BRAND_VARS) {
        if (data.over.brand?.[k as 'brand']) document.documentElement.style.setProperty(v, String(data.over.brand[k as 'brand']));
        else document.documentElement.style.removeProperty(v);
      }
    },
    [data.over.brand],
  );

  const pick = async (f?: File | null) => {
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api<{ url: string }>('/api/staff/studio/logo', { method: 'POST', body: fd });
      setLogo(r.url);
    } catch (e) {
      toastError(e);
    } finally {
      setUploading(false);
    }
  };
  const shownLogo = logo !== undefined ? logo : (cur.logo ?? null);

  const doSave = () => {
    if (!name.trim()) return toast('Business name cannot be empty');
    if (Object.values(col).some((v) => !HEX.test(v.trim()))) return toast('Colours must be 6-digit hex, like #E4002B');
    return save('Brand saved', (o) => {
      o.app = { ...(o.app ?? {}), client: name.trim(), tagline: tag.trim() };
      o.brand = { ...(o.brand ?? {}), brand: col.brand.trim(), dark: col.dark.trim(), sidebar: col.sidebar.trim(), onAccent: col.onAccent.trim() };
      if (logo !== undefined) o.brand.logo = logo;
    });
  };

  return (
    <StuCard
      title="Your brand"
      hint="changes preview live: Save to keep them"
      foot={
        <>
          <button className="btn-primary" onClick={doSave}>
            Save brand
          </button>
          <span className="sp" />
          <button className="stu-reset" onClick={() => reset(['brand', 'app'], 'Brand')}>
            Reset to default
          </button>
        </>
      }
    >
      <StuRow label="Business name" sub="shown in the sidebar and login">
        <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </StuRow>
      <StuRow label="Tagline" sub="the small line under your name">
        <input type="text" value={tag} maxLength={48} onChange={(e) => setTag(e.target.value)} />
      </StuRow>
      {BRAND_VARS.map(([k, , l, sub]) => (
        <StuRow key={k} label={l} sub={sub}>
          <div className="stu-color">
            <input type="color" value={HEX.test(col[k]) ? col[k] : '#000000'} onChange={(e) => setCol({ ...col, [k]: e.target.value })} aria-label={`${l} colour`} />
            <input type="text" className={`hex${HEX.test(col[k].trim()) ? '' : ' bad'}`} value={col[k]} maxLength={7} onChange={(e) => setCol({ ...col, [k]: e.target.value })} aria-label={`${l} hex`} />
          </div>
        </StuRow>
      ))}
      <StuRow label="Logo" sub="PNG/JPG · stored in the media store, never inside the settings">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="stu-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {uploading ? 'Uploading…' : shownLogo ? <img src={shownLogo} alt="logo" /> : 'Tap to add logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <button className="stu-reset" onClick={() => setLogo(null)}>
            Remove
          </button>
        </div>
      </StuRow>
    </StuCard>
  );
}

/* ── VOCABULARY: record/contact names + field labels ── */
function WordsTab({ data, save, reset }: TabProps) {
  const { toast } = useToast();
  const c = data.cfg;
  const [v, setV] = useState({
    es: c.entity.singular,
    ep: c.entity.plural,
    cs: c.contactWord.singular,
    cp: c.contactWord.plural,
    rl: c.recurring.label,
    name: c.fieldLabels.name,
    co: c.fieldLabels.co,
    phone: c.fieldLabels.phone,
    value: c.fieldLabels.value,
    followUp: c.fieldLabels.followUp,
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const doSave = () => {
    const t = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])) as typeof v;
    if (Object.values(t).some((x) => !x)) return toast('Labels cannot be empty');
    return save('Vocabulary saved', (o) => {
      o.entity = { singular: t.es, plural: t.ep };
      o.contactWord = { singular: t.cs, plural: t.cp };
      o.recurring = { ...(o.recurring ?? {}), label: t.rl };
      o.fieldLabels = { ...(o.fieldLabels ?? {}), name: t.name, co: t.co, phone: t.phone, value: t.value, followUp: t.followUp };
    });
  };
  return (
    <>
      <StuCard
        title="What things are called"
        hint="renames ripple through the whole app: nav, titles, buttons, tables"
        foot={
          <>
            <button className="btn-primary" onClick={doSave}>
              Save vocabulary
            </button>
            <span className="sp" />
            <button className="stu-reset" onClick={() => reset(['entity', 'contactWord', 'fieldLabels'], 'Vocabulary')}>
              Reset to default
            </button>
          </>
        }
      >
        <StuRow label="Record, singular" sub="your core record: Lead, Student, Booking…">
          <input type="text" value={v.es} maxLength={20} onChange={set('es')} />
        </StuRow>
        <StuRow label="Record, plural">
          <input type="text" value={v.ep} maxLength={24} onChange={set('ep')} />
        </StuRow>
        <StuRow label="Contact, singular" sub="post-sale contact: Customer, Client, Parent…">
          <input type="text" value={v.cs} maxLength={20} onChange={set('cs')} />
        </StuRow>
        <StuRow label="Contact, plural">
          <input type="text" value={v.cp} maxLength={24} onChange={set('cp')} />
        </StuRow>
        <StuRow label="Recurring unit" sub="what one billing cycle is called: Fee, Subscription…">
          <input type="text" value={v.rl} maxLength={20} onChange={set('rl')} />
        </StuRow>
      </StuCard>
      <StuCard title="Field labels" hint="rename the columns your team sees: the data underneath never changes">
        {(['name', 'co', 'phone', 'value', 'followUp'] as const).map((k) => (
          <StuRow key={k} label={data.defaults.fieldLabels[k]}>
            <input type="text" value={v[k]} maxLength={26} onChange={set(k)} />
          </StuRow>
        ))}
      </StuCard>
    </>
  );
}

/* ── PIPELINE: rename + reorder stages (keys and terminals locked) ── */
function PipelineTab({ data, save, reset }: TabProps) {
  const { toast } = useToast();
  const [st, setSt] = useState(data.cfg.stages.map((s) => ({ ...s, prob: String(s.prob) })));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= st.length) return;
    const a = [...st];
    [a[i], a[j]] = [a[j], a[i]];
    setSt(a);
  };
  const edit = (i: number, f: 'label' | 'prob', val: string) => setSt(st.map((s, x) => (x === i ? { ...s, [f]: val } : s)));
  const doSave = () => {
    if (st.some((s) => !s.label.trim())) return toast('Stage names cannot be empty');
    return save('Pipeline saved', (o) => {
      o.stages = st.map((s) => ({ k: s.k, label: s.label.trim(), prob: Math.max(0, Math.min(100, Math.round(+s.prob) || 0)) }));
    });
  };
  return (
    <StuCard
      title="Pipeline stages"
      hint="rename and reorder: the win % drives your weighted pipeline value"
      foot={
        <>
          <button className="btn-primary" onClick={doSave}>
            Save pipeline
          </button>
          <span className="sp" />
          <button className="stu-reset" onClick={() => reset(['stages'], 'Pipeline')}>
            Reset to default
          </button>
        </>
      }
    >
      {st.map((s, i) => (
        <div className="stg-row" key={s.k}>
          <div className="stg-move">
            <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ▲
            </button>
            <button disabled={i === st.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
              ▼
            </button>
          </div>
          <span className="dot" style={{ background: s.color }} />
          <input type="text" className="lbl" value={s.label} maxLength={24} onChange={(e) => edit(i, 'label', e.target.value)} aria-label="Stage name" />
          {s.terminal ? (
            <span className="stu-lock">
              <LockIc />
              {s.terminal === 'won' ? 'won · 100%' : 'lost · 0%'}
            </span>
          ) : (
            <>
              <input type="number" className="prob" min={0} max={100} value={s.prob} onChange={(e) => edit(i, 'prob', e.target.value)} aria-label="Win %" />
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>%</span>
            </>
          )}
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--faint)', padding: '10px 0 4px' }}>
        Stages can be renamed and reordered, never deleted. Every existing deal keeps its place. The won and lost stages keep their meaning.
      </div>
    </StuCard>
  );
}

/* ── NUMBERS: targets, cadence, stock thresholds ── */
function NumbersTab({ data, save, reset }: TabProps) {
  const { toast } = useToast();
  const c = data.cfg;
  const [target, setTarget] = useState(c.monthlyTarget.toLocaleString());
  const [cad, setCad] = useState(c.cadence.map(String));
  const [low, setLow] = useState(String(c.inventory?.lowThreshold ?? 5));
  const [dead, setDead] = useState(String(c.inventory?.deadStockDays ?? 60));
  const int = (s: string) => parseInt(String(s).replace(/[^0-9]/g, ''), 10) || 0;
  const doSave = () => {
    const t = int(target);
    if (t < 1) return toast('Target must be a positive number');
    const cd = cad.map(int) as [number, number, number];
    if (cd.some((d) => d < 1)) return toast('Cadence days must be at least 1');
    if (!(cd[0] < cd[1] && cd[1] < cd[2])) return toast('Cadence days must increase: e.g. 30, 60, 90');
    const dd = int(dead);
    if (dd < 7) return toast('Dead-stock window must be at least 7 days');
    return save('Numbers saved', (o) => {
      o.monthlyTarget = t;
      o.cadence = cd;
      o.inventory = { ...(o.inventory ?? {}), lowThreshold: int(low), deadStockDays: dd };
    });
  };
  return (
    <StuCard
      title="Targets and timing"
      hint="these numbers drive real behaviour: due dates, alerts, the target bar"
      foot={
        <>
          <button className="btn-primary" onClick={doSave}>
            Save numbers
          </button>
          <span className="sp" />
          <button className="stu-reset" onClick={() => reset(['monthlyTarget', 'cadence', 'inventory'], 'Numbers')}>
            Reset to default
          </button>
        </>
      }
    >
      <StuRow label="Monthly revenue target" sub="the dashboard progress bar aims at this">
        <input type="text" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
      </StuRow>
      <StuRow label="Follow-up cadence (days)" sub={`the 3 ${c.contactWord.singular.toLowerCase()} re-engage steps`}>
        <div style={{ display: 'flex', gap: 8, flex: 1 }}>
          {cad.map((d, i) => (
            <input key={i} type="number" min={1} value={d} style={{ width: 70, flex: 'none' }} onChange={(e) => setCad(cad.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Step ${i + 1} days`} />
          ))}
        </div>
      </StuRow>
      <StuRow label="Low-stock alert at" sub='inventory flags "running low" at or below this'>
        <input type="number" min={0} value={low} style={{ width: 90, flex: 'none' }} onChange={(e) => setLow(e.target.value)} />
      </StuRow>
      <StuRow label="Dead-stock window (days)" sub='no sale for this long flags "consider a promo"'>
        <input type="number" min={7} value={dead} style={{ width: 90, flex: 'none' }} onChange={(e) => setDead(e.target.value)} />
      </StuRow>
    </StuCard>
  );
}

/* ── MESSAGES: WhatsApp templates in the client's voice ── */
function MessagesTab({ data, save, reset }: TabProps) {
  const { toast } = useToast();
  const c = data.cfg;
  const [wa, setWa] = useState(c.waTemplate);
  const [rm, setRm] = useState(c.recurring.waRemind);
  const chips = (a: string[]) => a.map((t) => <span key={t} className="tok">{`{${t}}`}</span>);
  const doSave = () => {
    const w = wa.trim();
    const r = rm.trim();
    if (!w || !r) return toast('Messages cannot be empty');
    const bad = [...badTokens(w, TPL_TOKENS.wa), ...badTokens(r, TPL_TOKENS.remind)];
    if (bad.length) return toast(`Unknown token ${bad[0]} — use the tokens shown below the box`);
    return save('Messages saved', (o) => {
      o.waTemplate = w;
      o.recurring = { ...(o.recurring ?? {}), waRemind: r };
    });
  };
  return (
    <StuCard
      title="WhatsApp messages"
      hint="written in your voice, the {tokens} fill in automatically"
      foot={
        <>
          <button className="btn-primary" onClick={doSave}>
            Save messages
          </button>
          <span className="sp" />
          <button className="stu-reset" onClick={() => reset(['waTemplate'], 'Messages')}>
            Reset to default
          </button>
        </>
      }
    >
      <StuRow label={`New ${c.entity.singular.toLowerCase()} message`} sub={`sent from the ${c.entity.singular.toLowerCase()} panel`}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <textarea maxLength={400} value={wa} onChange={(e) => setWa(e.target.value)} style={{ width: '100%' }} />
          <div style={{ marginTop: 6 }}>{chips(TPL_TOKENS.wa)}</div>
          <div className="tpl-prev">
            <b>Preview:</b> {fillTpl(wa, { name: 'Amara' })}
          </div>
        </div>
      </StuRow>
      <StuRow label={`${c.recurring.label} reminder`} sub={`used by the recurring ${c.recurring.label.toLowerCase()} ledger`}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <textarea maxLength={400} value={rm} onChange={(e) => setRm(e.target.value)} style={{ width: '100%' }} />
          <div style={{ marginTop: 6 }}>{chips(TPL_TOKENS.remind)}</div>
          <div className="tpl-prev">
            <b>Preview:</b> {fillTpl(rm, { name: 'Amara', month: 'July', amount: lkr(c.recurring.amount), label: c.recurring.label.toLowerCase() })}
          </div>
        </div>
      </StuRow>
    </StuCard>
  );
}

/* ── STUDENT REMINDERS: run from the Student app page ── */
function RemindersTab() {
  return (
    <StuCard title="Phone reminders" hint="notifications on students’ phones, even with the app closed">
      <div style={{ padding: '12px 0', fontSize: 13.5, lineHeight: 1.6 }}>
        Student and parent reminders (how many a day, the hours, which kinds, the parent fee reminders, a test send and the last ones sent) are set on the Student app page, next to the
        rest of the app settings.
      </div>
      <div className="stu-foot">
        <Link className="btn-primary" href="/staff/app?tab=reminders" prefetch={false} style={{ textDecoration: 'none' }}>
          Open student reminders
        </Link>
      </div>
    </StuCard>
  );
}

/* ── MODULES: the floor is locked on; extras toggle instantly ── */
function ModulesTab({ data, save }: TabProps) {
  const row = (m: string, locked: boolean) => {
    const [name, sub] = MODULE_INFO[m] ?? [m, ''];
    const on = data.cfg.modules[m] !== false;
    return (
      <div className="stu-row" key={m}>
        <div className="sr-l" style={{ width: 220 }}>
          <div className="t">{name}</div>
          <div className="s">{sub}</div>
        </div>
        <span className="sp" style={{ flex: 1 }} />
        {locked ? (
          <span className="stu-lock">
            <LockIc /> part of your system
          </span>
        ) : (
          <Switch
            on={on}
            label={name}
            onChange={(v) =>
              save(`${name} ${v ? 'shown' : 'hidden'}`, (o) => {
                o.modules = { ...(o.modules ?? {}), [m]: v };
              })
            }
          />
        )}
      </div>
    );
  };
  return (
    <>
      <StuCard title="Always on" hint="the core that keeps your data trustworthy: reports, exports and the audit trail never switch off">
        {FLOOR_MODULES.map((m) => row(m, true))}
      </StuCard>
      <StuCard title="Optional modules" hint="show only what you use: turning one off hides it, nothing is deleted">
        {OPTIONAL.map((m) => row(m, false))}
      </StuCard>
    </>
  );
}

/* ── DOCUMENTS: the header on every printed invoice and report ── */
function DocumentsTab({ data, save, reset }: TabProps) {
  const { toast } = useToast();
  const co = data.cfg.company;
  const [v, setV] = useState({ name: co.name, phone: co.phone, email: co.email, address: co.address });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const doSave = () => {
    if (!v.name.trim()) return toast('Company name cannot be empty');
    return save('Document header saved', (o) => {
      o.company = { ...(o.company ?? {}), name: v.name.trim(), phone: v.phone.trim(), email: v.email.trim(), address: v.address.trim() };
    });
  };
  const preview = () => {
    const c = { name: v.name, phone: v.phone, email: v.email, address: v.address };
    const inner =
      docHead(c, 'SAMPLE') +
      '<div style="font-size:12.5px;margin-bottom:8px">This is how your documents will look.</div>' +
      '<table><thead><tr><th>Description</th><th class="tr">Amount</th></tr></thead><tbody><tr><td>Example line item</td><td class="tr">' + lkr(25000) + '</td></tr></tbody></table>' +
      '<div class="tot"><div class="box"><div class="trow grand"><span>Total</span><span>' + lkr(25000) + '</span></div></div></div>' +
      docFoot(c);
    try {
      printDoc('Sample document', inner);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <StuCard
      title="Printed documents"
      hint="this header appears on every invoice and report PDF"
      foot={
        <>
          <button className="btn-primary" onClick={doSave}>
            Save documents
          </button>
          <button className="btn-ghost" onClick={preview}>
            Preview a document
          </button>
          <span className="sp" />
          <button className="stu-reset" onClick={() => reset(['company'], 'Documents')}>
            Reset to default
          </button>
        </>
      }
    >
      <StuRow label="Company name">
        <input type="text" value={v.name} maxLength={60} onChange={set('name')} />
      </StuRow>
      <StuRow label="Phone">
        <input type="text" value={v.phone} maxLength={24} onChange={set('phone')} />
      </StuRow>
      <StuRow label="Email">
        <input type="text" value={v.email} maxLength={60} onChange={set('email')} />
      </StuRow>
      <StuRow label="Address">
        <input type="text" value={v.address} maxLength={90} onChange={set('address')} />
      </StuRow>
    </StuCard>
  );
}

/* ── SYSTEM: your account, theme, import, about, what's protected, reset ── */
function SystemTab({ data, save }: TabProps) {
  const { me, config, refreshBadges } = useStaff();
  const ask = useDialog();
  const [dark, setDark] = useState(() => document.body.classList.contains('dark'));
  const [pwOpen, setPwOpen] = useState(false);
  const { toast } = useToast();
  const [importing, setImporting] = useState<ImportType | null>(null);
  const theme = (d: boolean) => {
    document.body.classList.toggle('dark', d);
    setDark(d);
    try {
      localStorage.setItem('bswl_skel_v1_theme', d ? 'dark' : 'light');
    } catch {}
  };
  const n = Object.keys(data.over ?? {}).length;
  const shield = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" style={{ verticalAlign: -3, marginRight: 6 }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
  const importOn = config.modules.import !== false;

  return (
    <>
      <StuCard title="Your account" hint="the password you sign in with">
        <StuRow label="Signed in as">
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            {me.name} · {me.email}
          </span>
        </StuRow>
        <StuRow label="Password" sub="at least 10 characters, with letters and numbers">
          <button className="btn-ghost" onClick={() => setPwOpen(true)}>
            <Icon name="lock" /> Change password
          </button>
        </StuRow>
      </StuCard>
      {pwOpen && <PasswordChange
          onDone={(saved) => {
            setPwOpen(false);
            if (saved) toast(<Ok>Password changed — other devices are signed out</Ok>);
          }}
        />}

      <StuCard title="Appearance">
        <StuRow label="Theme">
          <div className="seg-toggle">
            <button className={`segt${dark ? '' : ' active'}`} onClick={() => theme(false)}>
              Light
            </button>
            <button className={`segt${dark ? ' active' : ''}`} onClick={() => theme(true)}>
              Dark
            </button>
          </div>
        </StuRow>
      </StuCard>

      {importOn && (
        <StuCard title="Bulk import" hint="bring in a spreadsheet: save it as .csv, then match its columns">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '12px 0' }}>
            <button className="btn-ghost" onClick={() => setImporting('students')}>
              <Icon name="upload" /> Import {config.contactWord.plural.toLowerCase()}
            </button>
            <button className="btn-ghost" onClick={() => setImporting('enquiries')}>
              <Icon name="upload" /> Import {config.entity.plural.toLowerCase()}
            </button>
          </div>
          <div className="hint" style={{ paddingBottom: 8 }}>
            Each imported {config.contactWord.singular.toLowerCase()} gets a {config.recurring.label.toLowerCase()} plan straight away, priced from the batch and programme unless the file gives a fee.
          </div>
        </StuCard>
      )}
      {importing && (
        <ImportWizard
          type={importing}
          label={importing === 'students' ? config.contactWord.plural : config.entity.plural}
          onClose={() => setImporting(null)}
          onDone={refreshBadges}
        />
      )}

      <StuCard title="About this system">
        <StuRow label="Product">
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>
            {data.cfg.app.name} · {data.cfg.app.version}
          </span>
        </StuRow>
        <StuRow label="Data mode">
          <span className="bdg bdg-green">Saved in the database</span>
        </StuRow>
        <StuRow label="Customizations">
          <span className={`bdg ${n ? 'bdg-blue' : 'bdg-grey'}`}>{n ? `${n} section${n === 1 ? '' : 's'} customized` : 'factory defaults'}</span>
        </StuRow>
      </StuCard>

      <StuCard title="Protected: cannot be changed here" hint="these stay locked so your system can never break">
        <div style={{ padding: '10px 0 6px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 2 }}>
          {shield}Your data and records: renaming labels never edits data
          <br />
          {shield}Security, logins and tenant isolation
          <br />
          {shield}Roles, staff see their own work, owner sees everything
          <br />
          {shield}Reports, exports and the audit trail (your system floor)
        </div>
      </StuCard>

      <StuCard title="Resets" hint="asks before doing anything">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '12px 0' }}>
          <button
            className="btn-ghost"
            onClick={async () => {
              if (
                !(await ask.confirm({
                  title: 'Put every customization back to the factory default?',
                  body: 'Your data is not touched.',
                  okLabel: 'Reset',
                  danger: true,
                }))
              )
                return;
              await save('All customizations reset', (o) => {
                for (const k of Object.keys(o)) delete o[k as keyof Over];
              });
            }}
          >
            Reset ALL customizations
          </button>
        </div>
      </StuCard>
    </>
  );
}
