'use client';

/* Bulk import (original 9D): upload a CSV, map its columns to the system
   fields, preview, import. The CSV is parsed here (RFC-style: quoted fields,
   "" escapes, CR/CRLF, blank rows dropped); the server re-validates every row
   and writes them in one transaction. Excel users save as .csv first. */

import { useState, type DragEvent } from 'react';
import { post } from '@/lib/client/api';
import { downloadCsv, useToast } from '@/components/staff/ui';

export type ImportType = 'students' | 'enquiries';
type FieldDef = { k: string; l: string; req?: boolean; num?: boolean };

export const IMPORT_FIELDS: Record<ImportType, FieldDef[]> = {
  students: [
    { k: 'name', l: 'Name', req: true },
    { k: 'phone', l: 'WhatsApp' },
    { k: 'email', l: 'Email' },
    { k: 'batch', l: 'Batch (2027 / 2028)' },
    { k: 'program', l: 'Program (Theory / Revision / Combined)' },
    { k: 'loc', l: 'Location (Kings / JMC / Sasik / Residence / Online)' },
    { k: 'fee', l: 'Monthly fee (optional)', num: true },
    { k: 'joined', l: 'Joined (YYYY-MM-DD)' },
    { k: 'school', l: 'School' },
  ],
  enquiries: [
    { k: 'name', l: 'Name', req: true },
    { k: 'co', l: 'Company/detail' },
    { k: 'phone', l: 'Phone' },
    { k: 'value', l: 'Value', num: true },
    { k: 'stage', l: 'Stage' },
  ],
};

export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  return { headers: (nonEmpty.shift() || []).map((h) => String(h).trim()), rows: nonEmpty };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function ImportWizard({ type, label, onClose, onDone }: { type: ImportType; label: string; onClose: () => void; onDone?: () => void }) {
  const { toast, toastError } = useToast();
  const fields = IMPORT_FIELDS[type];
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; skipped: number } | null>(null);

  const chosen = (file?: File | null) => {
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') return toast('Save the spreadsheet as .csv first (File, Save as, CSV), then choose it here');
    if (ext !== 'csv') return toast('Please choose a .csv file');
    const rd = new FileReader();
    rd.onload = (e) => {
      const d = parseCSV(String(e.target?.result ?? ''));
      if (!d.headers.length) return toast('No columns found, is the first row a header?');
      if (d.rows.length > 2000) return toast('Import up to 2,000 rows at a time. Split the file and import each part.');
      // auto-map: a header matches a field when it equals the key or label, or starts with the key
      const m: Record<string, number> = {};
      for (const f of fields) m[f.k] = d.headers.findIndex((h) => norm(h) === norm(f.k) || norm(h) === norm(f.l) || norm(h).indexOf(norm(f.k)) === 0);
      setHeaders(d.headers);
      setRows(d.rows);
      setMap(m);
      setStep(2);
    };
    rd.readAsText(file);
  };

  const cell = (r: string[], k: string) => {
    const i = map[k] ?? -1;
    return i >= 0 ? String(r[i] ?? '').trim() : '';
  };
  const valid = (r: string[]) => fields.every((f) => !f.req || ((map[f.k] ?? -1) >= 0 && cell(r, f.k) !== ''));
  const mapped = fields.filter((f) => (map[f.k] ?? -1) >= 0);
  const okN = rows.filter(valid).length;

  const doImport = async () => {
    setBusy(true);
    try {
      const payload = rows.map((r) => {
        const o: Record<string, string> = {};
        for (const f of mapped) o[f.k] = cell(r, f.k).slice(0, 500);
        return o;
      });
      const res = await post<{ imported: number; skipped: number }>('/api/staff/import', { type, rows: payload });
      setSummary(res);
      setStep(3);
      onDone?.();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const template = () => {
    const example = fields.map((f) => (f.k === 'name' ? 'Example Company' : f.num ? '1000' : f.k === 'phone' ? '0771234567' : f.k === 'email' ? 'name@example.com' : ''));
    downloadCsv(`${label.toLowerCase().replace(/\s+/g, '-')}-import-template.csv`, fields.map((f) => f.l), [example]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    chosen(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="modal-ov open" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 560 }}>
        <div className="modal-h">
          <div>
            <h3>Import {label}</h3>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>Upload a spreadsheet, then map the columns</div>
          </div>
          <button className="pn-close" onClick={onClose} style={{ position: 'static', width: 30, height: 30 }} aria-label="Close">
            &#10005;
          </button>
        </div>
        <div className="modal-b">
          <div className="imp-steps">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`imp-step${i <= step ? ' on' : ''}`} />
            ))}
          </div>
          {step === 1 && (
            <div>
              <label
                className={`imp-drop${drag ? ' drag' : ''}`}
                style={{ display: 'block' }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <div className="id-t">Drop a .csv here, or tap to choose</div>
                <div className="id-s">First row must be column headers</div>
                <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => chosen(e.target.files?.[0])} />
              </label>
              <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12.5, color: 'var(--muted)' }}>
                Not sure of the format?{' '}
                <button className="lk" style={{ color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }} onClick={template}>
                  Download the import template
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>Match your columns to the system fields. Required fields are marked.</div>
              <div className="imp-map">
                {fields.map((f) => (
                  <div className="imp-map-row" key={f.k}>
                    <div className="imf">
                      {f.l}
                      {f.req && <span className="req">*</span>}
                    </div>
                    <div className="arw">→</div>
                    <select className="filter" value={map[f.k] ?? -1} onChange={(e) => setMap({ ...map, [f.k]: +e.target.value })} aria-label={f.l}>
                      <option value={-1}>(skip)</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="imp-prev">
                {mapped.length ? (
                  <table>
                    <thead>
                      <tr>
                        {mapped.map((f) => (
                          <th key={f.k}>{f.l}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 6).map((r, i) => (
                        <tr key={i} className={valid(r) ? undefined : 'bad'}>
                          {mapped.map((f) => (
                            <td key={f.k}>{cell(r, f.k) || '-'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: 14, color: 'var(--faint)', fontSize: 12.5 }}>Map at least one column to preview.</div>
                )}
              </div>
            </div>
          )}
          {step === 3 && summary && (
            <div className="imp-summary">
              <div className="is-big">{summary.imported}</div>
              <div className="is-sub">
                {label.toLowerCase()} imported
                {summary.skipped ? ` · ${summary.skipped} skipped (missing required)` : ''}
              </div>
              <a className="btn-primary" style={{ marginTop: 18, display: 'inline-flex', textDecoration: 'none' }} href={type === 'students' ? '/staff/customers' : '/staff/records'}>
                View {label.toLowerCase()}
              </a>
            </div>
          )}
        </div>
        {step !== 3 && (
          <div className="modal-f">
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            {step === 2 && (
              <button className="btn-primary" disabled={okN === 0 || busy} onClick={doImport}>
                {busy ? 'Importing' : `Import ${okN} row${okN === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
