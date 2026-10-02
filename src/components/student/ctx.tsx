'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { ApiError, fetcher, post } from '@/lib/client/api';
import { todayISO } from '@/lib/shared/dates';
import type { Boot, Essay, FlowState, LibDoc, McqItem, Model, RecItem } from './model';
import { routeTask } from './tasks';

/* One context for the whole single-screen app: the data the server sent,
   the writes that save it, and the UI actions every screen shares
   (show a screen, open a sheet, toast with Undo, open a PDF, start a task).

   THE FIX THAT MATTERED: every student write goes to the server. A write
   updates the screen at once, then saves; if the save fails the screen is
   reloaded from the server and the student is told, so nothing a student
   does can silently vanish on reload again. */

export type Screen = 'next' | 'learn' | 'practice' | 'progress';
export type LearnSeg = 'syllabus' | 'tutes' | 'papers' | 'recordings';
export type PracView = 'drill' | 'paper' | 'essays';
export type FlowOpen =
  | { type: 'task'; state: FlowState }
  | { type: 'log'; preset?: { timed?: boolean; mins?: number } }
  | null;
export type QuizRef = { id: number; pin: string; title: string };

type Toast = { msg: string; undo?: () => void; on: boolean; n: number } | null;

type Ctx = {
  boot: Boot | undefined;
  m: Model | undefined;
  loadError: string | null;
  reload: () => void;
  write: (optimistic: (b: Boot) => Boot, call: () => Promise<unknown>) => Promise<boolean>;
  setSelfEv: (topic: string, s: string) => void;
  setProgressTask: (f: FlowState | null) => void;

  screen: Screen;
  show: (sc: Screen, seg?: LearnSeg) => void;
  learnSeg: LearnSeg;
  setLearnSeg: (s: LearnSeg) => void;
  pracView: PracView;
  setPracView: (v: PracView) => void;
  sylFilter: string;
  setSylFilter: (f: string) => void;

  sheet: ReactNode | null;
  openSheet: (n: ReactNode) => void;
  closeSheet: () => void;
  toast: Toast;
  showToast: (msg: string, undo?: () => void) => void;
  hideToast: () => void;
  live: string;
  say: (m: string) => void;

  flow: FlowOpen;
  setFlow: (f: FlowOpen) => void;
  startTask: (r: Pick<RecItem, 'kind'> & Partial<RecItem>) => void;
  inboxOpen: boolean;
  setInboxOpen: (b: boolean) => void;
  mcq: McqItem[] | null;
  reloadMcq: () => void;
  mcqRun: number | null;
  setMcqRun: (id: number | null) => void;
  essays: Essay[] | null;
  wantEssays: () => void;
  lib: LibDoc[] | null;
  libBusy: number | null;
  openDoc: (id: number) => void;
  quiz: QuizRef | null;
  setQuiz: (q: QuizRef | null) => void;
  wtOpen: boolean;
  setWtOpen: (b: boolean) => void;
};

const C = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(C);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

export const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');

function readJSON<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function writeJSON(k: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { data: boot, error, mutate } = useSWR<Boot>('/api/student/bootstrap', fetcher, { revalidateOnFocus: true, dedupingInterval: 4000 });
  const { data: mcqData, mutate: reloadMcqRaw } = useSWR<{ papers: McqItem[] }>(boot ? '/api/student/mcq' : null, fetcher);
  const { data: libData } = useSWR<{ docs: LibDoc[] }>(boot ? '/api/student/library' : null, fetcher, { refreshInterval: 5 * 60_000 });
  const [essaysOn, setEssaysOn] = useState(false);
  const { data: essData } = useSWR<{ essays: Essay[] }>(boot && essaysOn ? '/api/student/essays' : null, fetcher);

  /* Self-check results (the task flow's questions) stay on this phone: the
     server only takes a student's own rating, never evidence. */
  const sid = boot?.me.id;
  const [selfEv, setSelfEvState] = useState<Record<string, { s: string; d: string }>>({});
  const [progressTask, setPT] = useState<FlowState | null>(null);
  /* read once per signed-in student, as soon as the boot names them */
  const [readFor, setReadFor] = useState<number | undefined>(undefined);
  if (sid && readFor !== sid) {
    setReadFor(sid);
    setSelfEvState(readJSON(`bswl_self_${sid}`, {}));
    setPT(readJSON(`bswl_task_${sid}`, null));
  }
  const setSelfEv = useCallback(
    (topic: string, s: string) => {
      setSelfEvState((cur) => {
        const next = { ...cur, [topic]: { s, d: todayISO() } };
        if (sid) writeJSON(`bswl_self_${sid}`, next);
        return next;
      });
    },
    [sid],
  );
  const setProgressTask = useCallback(
    (f: FlowState | null) => {
      setPT(f);
      if (sid) writeJSON(`bswl_task_${sid}`, f);
    },
    [sid],
  );

  const m = useMemo<Model | undefined>(() => {
    if (!boot) return undefined;
    const evAll = { ...boot.ev };
    for (const [t, v] of Object.entries(selfEv)) if (!evAll[t] || evAll[t].d <= v.d) evAll[t] = v;
    return { ...boot, evAll, progressTask };
  }, [boot, selfEv, progressTask]);

  /* ── feedback ── */
  const [toast, setToast] = useState<Toast>(null);
  const [live, setLive] = useState('');
  const tt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((msg: string) => setLive(msg), []);
  const hideToast = useCallback(() => setToast((t) => (t ? { ...t, on: false } : t)), []);
  const showToast = useCallback(
    (msg: string, undo?: () => void) => {
      setToast({ msg, undo, on: true, n: Date.now() });
      say(msg);
      if (tt.current) clearTimeout(tt.current);
      tt.current = setTimeout(() => setToast((t) => (t ? { ...t, on: false } : t)), undo ? 5200 : 2600);
    },
    [say],
  );

  const write = useCallback(
    async (optimistic: (b: Boot) => Boot, call: () => Promise<unknown>) => {
      await mutate((cur) => (cur ? optimistic(cur) : cur), { revalidate: false });
      try {
        await call();
        return true;
      } catch (e) {
        showToast('Not saved. ' + errText(e));
        mutate();
        return false;
      }
    },
    [mutate, showToast],
  );

  /* ── navigation ── */
  const [screen, setScreen] = useState<Screen>('next');
  const [learnSeg, setLearnSeg] = useState<LearnSeg>('syllabus');
  const [pracView, setPracView] = useState<PracView>('drill');
  const [sylFilter, setSylFilter] = useState('next');
  const show = useCallback((sc: Screen, seg?: LearnSeg) => {
    if (seg) setLearnSeg(seg);
    setScreen(sc);
    window.scrollTo(0, 0);
  }, []);

  const [sheet, setSheet] = useState<ReactNode | null>(null);
  const openSheet = useCallback((n: ReactNode) => setSheet(n), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const [flow, setFlow] = useState<FlowOpen>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [mcqRun, setMcqRun] = useState<number | null>(null);
  const [quiz, setQuiz] = useState<QuizRef | null>(null);
  const [wtOpen, setWtOpen] = useState(false);

  /* ── PDFs ──
     THE WINDOW IS OPENED ON THE TAP, NOT WHEN THE TICKET ARRIVES. Mobile
     browsers block a window.open inside an async callback, so a blank tab
     opens first and is pointed at the two-minute ticket when it lands. */
  const [libBusy, setLibBusy] = useState<number | null>(null);
  const openDoc = useCallback(
    (id: number) => {
      if (libBusy) return;
      setLibBusy(id);
      let w: Window | null = null;
      try {
        w = window.open('', '_blank');
      } catch {}
      post<{ url: string }>(`/api/student/library/${id}/ticket`)
        .then((j) => {
          if (w) {
            try {
              w.opener = null;
            } catch {}
            w.location.href = j.url;
          } else window.location.href = j.url;
        })
        .catch(() => {
          try {
            w?.close();
          } catch {}
          showToast('Leon has not shared that one yet.');
        })
        .finally(() => setLibBusy(null));
    },
    [libBusy, showToast],
  );

  /* ── the task router: a card that names a task opens that exact task.
     It reads the context through a ref so a delayed start (after a sheet
     closes) still sees the latest data. ── */
  const ctxRef = useRef<Ctx | null>(null);

  const value: Ctx = {
    boot,
    m,
    loadError: error ? errText(error) : null,
    reload: () => {
      mutate();
    },
    write,
    setSelfEv,
    setProgressTask,
    screen,
    show,
    learnSeg,
    setLearnSeg,
    pracView,
    setPracView,
    sylFilter,
    setSylFilter,
    sheet,
    openSheet,
    closeSheet,
    toast,
    showToast,
    hideToast,
    live,
    say,
    flow,
    setFlow,
    startTask: (r) => {
      if (ctxRef.current) routeTask(ctxRef.current, r);
    },
    inboxOpen,
    setInboxOpen,
    mcq: mcqData?.papers ?? null,
    reloadMcq: () => {
      reloadMcqRaw();
    },
    mcqRun,
    setMcqRun,
    essays: essData?.essays ?? null,
    wantEssays: () => setEssaysOn(true),
    lib: libData?.docs ?? null,
    libBusy,
    openDoc,
    quiz,
    setQuiz,
    wtOpen,
    setWtOpen,
  };
  useEffect(() => {
    ctxRef.current = value;
  });
  return <C.Provider value={value}>{children}</C.Provider>;
}

export type { Ctx };
