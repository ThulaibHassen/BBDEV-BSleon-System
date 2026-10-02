'use client';

/* In-app replacements for window.prompt() and window.confirm().

   const ask = useDialog();
   const name = await ask.prompt({ title: 'New MCQ paper', label: 'Name', placeholder: 'Unit 3 · Term test' });
   if (name === null) return;                       // cancelled
   if (!(await ask.confirm({ title: 'Delete "x"?', body: '…', okLabel: 'Delete', danger: true }))) return;

   One dialog at a time, rendered in the original .modal styling. Enter
   confirms, Escape or a click outside cancels. The promise always settles. */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Ok, useToast } from './ui';

type PromptOpts = {
  title: string;
  label?: string;
  body?: ReactNode;
  placeholder?: string;
  value?: string;
  okLabel?: string;
  /** refuse to submit an empty answer (default true) */
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
};
type ConfirmOpts = { title: string; body?: ReactNode; okLabel?: string; cancelLabel?: string; danger?: boolean };

type Pending =
  | { kind: 'prompt'; o: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'confirm'; o: ConfirmOpts; resolve: (v: boolean) => void };

type DialogApi = {
  prompt: (o: PromptOpts) => Promise<string | null>;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
};

const Ctx = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null);
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  /* A second ask while one is open (e.g. Escape reaching both this dialog and
     the side panel under it, which asks "Close without saving?") is answered
     "cancel" at once, so the open dialog keeps its promise and nothing stacks. */
  const openRef = useRef(false);

  const prompt = useCallback(
    (o: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        if (openRef.current) return resolve(null);
        openRef.current = true;
        setVal(o.value ?? '');
        setErr('');
        setP({ kind: 'prompt', o, resolve });
      }),
    [],
  );
  const confirm = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        if (openRef.current) return resolve(false);
        openRef.current = true;
        setP({ kind: 'confirm', o, resolve });
      }),
    [],
  );

  useEffect(() => {
    if (p?.kind === 'prompt') setTimeout(() => input.current?.select(), 30);
  }, [p]);

  const close = (ok: boolean) => {
    if (!p) return;
    if (p.kind === 'confirm') p.resolve(ok);
    else {
      if (ok) {
        const v = val.trim();
        if (!v && p.o.required !== false) {
          setErr('This cannot be empty.');
          input.current?.focus();
          return;
        }
        p.resolve(v);
      } else p.resolve(null);
    }
    openRef.current = false;
    setP(null);
  };

  return (
    <Ctx.Provider value={{ prompt, confirm }}>
      {children}
      {/* its own stacking layer above everything, the full-screen quiz host
          (.qh-wrap, z-index 300) included, so "End the game?" is visible */}
      <div style={{ position: 'relative', zIndex: 400 }}>
        <Modal
          open={!!p}
          title={p?.o.title ?? ''}
          onClose={() => close(false)}
          footer={
            p && (
              <>
                <button className="btn-ghost" onClick={() => close(false)}>
                  {p.kind === 'confirm' ? (p.o.cancelLabel ?? 'Cancel') : 'Cancel'}
                </button>
                <button
                  className={p.kind === 'confirm' && p.o.danger ? 'btn-danger' : 'btn-primary'}
                  onClick={() => close(true)}
                  autoFocus={p.kind === 'confirm'}
                >
                  {p.o.okLabel ?? (p.kind === 'confirm' ? 'Continue' : 'Save')}
                </button>
              </>
            )
          }
        >
          {p?.o.body && <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55, marginBottom: p.kind === 'prompt' ? 14 : 0, whiteSpace: 'pre-line' }}>{p.o.body}</div>}
          {p?.kind === 'prompt' && (
            <div className={`fld${err ? ' invalid' : ''}`} style={{ marginBottom: 0 }}>
              {p.o.label && <label>{p.o.label}</label>}
              {p.o.multiline ? (
                <textarea
                  ref={input}
                  rows={3}
                  value={val}
                  maxLength={p.o.maxLength}
                  placeholder={p.o.placeholder}
                  onChange={(e) => {
                    setVal(e.target.value);
                    if (err) setErr('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && close(true)}
                />
              ) : (
                <input
                  ref={input}
                  value={val}
                  maxLength={p.o.maxLength ?? 120}
                  placeholder={p.o.placeholder}
                  onChange={(e) => {
                    setVal(e.target.value);
                    if (err) setErr('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && close(true)}
                />
              )}
              {err && <div className="err">{err}</div>}
            </div>
          )}
        </Modal>
      </div>
    </Ctx.Provider>
  );
}

export function useDialog() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDialog outside DialogProvider');
  return c;
}

/** Copy text to the clipboard with a "Copied" toast. Where the clipboard is
    refused (plain http, an old browser) the text is shown in a dialog to
    select by hand. Resolves true when it reached the clipboard. */
export function useCopy() {
  const { toast } = useToast();
  const ask = useDialog();
  return useCallback(
    async (text: string, done = 'Copied') => {
      try {
        await navigator.clipboard.writeText(text);
        toast(<Ok>{done}</Ok>);
        return true;
      } catch {
        await ask.confirm({ title: 'Copy this', body: text, okLabel: 'Done' });
        return false;
      }
    },
    [toast, ask],
  );
}
