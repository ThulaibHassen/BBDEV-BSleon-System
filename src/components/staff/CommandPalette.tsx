'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';
import { PAGE_TITLES } from '@/lib/shared/rbac';

/* Ctrl/Cmd+K. Pages always; with 2+ characters also students, enquiries,
   tasks and invoices (server-side, scoped to what this role may see).
   Capped at 12 rows. Arrows wrap, Enter runs, Esc closes. */

type Row = { kind: string; title: string; sub: string; href: string };

export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: { id: string; label: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const prevFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement;
      setQ('');
      setTimeout(() => input.current?.focus(), 0);
    } else {
      (prevFocus.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.normalize('NFC').trim().toLowerCase();
    const pageRows: Row[] = pages
      .filter((p) => !term || p.label.toLowerCase().includes(term) || p.id.includes(term))
      .map((p) => ({ kind: 'Page', title: p.label, sub: PAGE_TITLES[p.id]?.[1] ?? '', href: `/staff/${p.id}` }));
    if (term.length < 2) {
      setRows(pageRows.slice(0, 12));
      setTotal(pageRows.length);
      setSel(0);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ rows: Row[] }>(`/api/staff/search?palette=1&q=${encodeURIComponent(term)}`);
        if (!live) return;
        const all = [...pageRows, ...r.rows];
        setRows(all.slice(0, 12));
        setTotal(all.length);
        setSel(0);
      } catch {
        if (live) {
          setRows(pageRows.slice(0, 12));
          setTotal(pageRows.length);
        }
      }
    }, 140);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open, pages]);

  const run = (r?: Row) => {
    if (!r) return;
    onClose();
    router.push(r.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation(); // close the palette, not the modal or panel under it
      onClose();
    }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => (rows.length ? (s + 1) % rows.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => (rows.length ? (s - 1 + rows.length) % rows.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(rows[sel]);
    }
  };

  return (
    <div className={`cmd-wrap${open ? ' on' : ''}`} aria-hidden={!open}>
      <div className="cmd-scrim" onClick={onClose} />
      <div className="cmd-box" role="dialog" aria-modal="true" aria-label="Command palette">
        <input ref={input} className="cmd-in" placeholder="Search pages, students, enquiries…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <div className="cmd-list" role="listbox">
          {rows.length === 0 && <div className="sr-empty">Nothing matches that. Try a name, or a page.</div>}
          {rows.map((r, i) => (
            <div key={i} role="option" aria-selected={i === sel} className={`cmd-row${i === sel ? ' on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(r)}>
              <span className="cmd-k">{r.kind}</span>
              <span className="cmd-t">{r.title}</span>
              <span className="cmd-s">{r.sub}</span>
            </div>
          ))}
        </div>
        <div className="cmd-foot">
          <span>{rows.length === 0 ? 'No results' : total > 12 ? `Showing 12 of ${total} matches` : `${total} result${total === 1 ? '' : 's'}`}</span>
          <span>Arrows to move, Enter to open, Esc to close</span>
        </div>
      </div>
    </div>
  );
}
