'use client';

/* Printable documents opened in a new window: the fee receipt
   (number ABS-YYYYMM-NNN) and the Student Starter Guide.
   Owned by the Fees builder; the Students page imports these too.

   Layout, CSS and wording are the original receiptDoc / onboardingDoc,
   verbatim, with one fix: the receipt shows the payment's real method
   instead of a hard-coded "Cash".

   The window is opened BEFORE the data is fetched, inside the click, so a
   pop-up blocker does not treat it as an unprompted pop-up. Both functions
   throw on failure (blocked pop-up, no payment); callers toast the message. */

import { api } from '@/lib/client/api';
import { CFG } from '@/lib/shared/constants';
import { fmtDate, monthLbl, todayISO } from '@/lib/shared/dates';

export type ReceiptInput = { studentId: number; month: string };

const LOGO = '/brand/logo-doc.png';
const BRAND_ALT = 'Academy of Business Studies by Leon Fambeck';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const f = (n: number) => 'LKR ' + Math.round(n).toLocaleString('en-LK');
const cohortLabel = (c: number) => CFG.cohorts[c] ?? CFG.cohorts[0];

function openBlank(what: string) {
  const w = window.open('', '_blank');
  if (!w) throw new Error(`Allow pop-ups to open the ${what}`);
  w.document.write('<!doctype html><title>Preparing…</title><body style="font-family:Arial,sans-serif;color:#8a8a95;padding:40px">Preparing…</body>');
  return w;
}

function fill(w: Window, html: string) {
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* ─── Receipt ─────────────────────────────────────────────────────────── */

type ReceiptData = {
  rno: string;
  month: string;
  name: string;
  cohort: number;
  program: string;
  co: string;
  paid: number;
  due: number;
  balance: number;
  date: string;
  method: string;
};

const RECEIPT_CSS =
  "*{margin:0;box-sizing:border-box;font-family:'Inter',Arial,sans-serif}" +
  'body{background:#eceef3;color:#141417;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  '.page{max-width:800px;margin:22px auto;background:#fff;border:1px solid #e6e6ea;box-shadow:0 8px 34px rgba(0,0,0,.12)}' +
  '.pad{padding:44px 50px}' +
  '.print{position:fixed;top:16px;right:16px;background:#141417;color:#fff;border:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:12.5px;cursor:pointer;z-index:9;box-shadow:0 6px 16px rgba(20,20,23,.3)}' +
  '.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}' +
  '.brand{display:flex;align-items:center;gap:14px}.brand .bar{width:2px;height:46px;background:#141417}' +
  ".bn{font-family:'Poppins';font-weight:800;font-size:15px;line-height:1.25;letter-spacing:-.2px}.bn small{display:block;font-weight:700}" +
  '.sub{font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#8a8a95;margin-top:12px;font-weight:600}' +
  ".rc{text-align:right}.rc h1{font-family:'Poppins';font-weight:800;font-size:38px;letter-spacing:1px}" +
  '.rc .row{display:flex;justify-content:space-between;gap:26px;font-size:12.5px;margin-top:7px}.rc .k{color:#6e7178}.rc .v{font-weight:700}' +
  '.hr{height:1px;background:#e6e6ea;margin:22px 0}.hr.dark{height:2px;background:#141417}' +
  '.rf{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8a8a95;font-weight:700}' +
  ".nm{font-family:'Poppins';font-weight:800;font-size:30px;letter-spacing:-.5px;margin:8px 0 12px}" +
  '.meta{display:flex;gap:22px;align-items:center;font-size:13.5px;color:#333}.meta .dot{color:#c9cbd1}' +
  '.tbar{background:#141417;color:#fff;display:flex;justify-content:space-between;padding:12px 18px;font-size:11px;letter-spacing:1.5px;font-weight:700;text-transform:uppercase;margin-top:22px}' +
  '.trow{display:flex;justify-content:space-between;padding:16px 18px;font-size:15px;border-bottom:1px solid #e6e6ea}.trow .amt{font-weight:700}' +
  '.boxes{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}' +
  '.bx{border:1px solid #e6e6ea;border-radius:11px;padding:16px 18px}.bx .l{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8a95;font-weight:700}.bx .v{font-size:15px;font-weight:700;margin-top:6px}.bx .n{font-size:11px;color:#8a8a95;margin-top:3px}' +
  '.total{display:flex;align-items:center;gap:34px;margin-top:26px;padding:6px 0}' +
  ".stamp{border:3px solid #16a34a;color:#16a34a;font-family:'Poppins';font-weight:800;font-size:40px;letter-spacing:3px;padding:10px 30px;border-radius:12px;transform:rotate(-6deg)}" +
  ".tp .l{font-size:12.5px;letter-spacing:2px;text-transform:uppercase;color:#6e7178;font-weight:700}.tp .v{font-family:'Poppins';font-weight:800;font-size:34px;letter-spacing:-.5px;margin-top:4px}" +
  '.ft{display:flex;justify-content:space-between;gap:30px;margin-top:34px;padding-top:8px}' +
  ".sig .sg{font-family:'Sacramento',cursive;font-size:34px;line-height:1;margin-bottom:4px}.sig .ln{border-top:1px solid #141417;width:230px;margin:4px 0 6px}.sig .rb{font-size:12.5px;color:#8a8a95}" +
  '.ty{flex:1;max-width:330px;font-size:12.5px;color:#444;line-height:1.55;border-left:1px solid #e6e6ea;padding-left:22px}.ty b{color:#141417}' +
  '.foot{background:#fff;border-top:1px solid #e6e6ea;padding:16px 50px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}' +
  '.foot .fb{display:flex;align-items:center;gap:10px}.foot .fn{font-size:11px;font-weight:700;line-height:1.3}.foot .loc{font-size:11px;color:#8a8a95;border-left:1px solid #e6e6ea;padding-left:16px}' +
  '.cg{text-align:center;font-size:11px;letter-spacing:1px;color:#8a8a95;padding:12px;text-transform:uppercase}' +
  '@page{size:auto;margin:0}@media print{.print{display:none}body{background:#fff}.page{box-shadow:none;margin:0;max-width:100%;border:none}}';

/** The sub-line under the method: what the original box said, kept for cash. */
const methodNote = (m: string) => (m === 'Cash' ? 'Cash / Bank transfer' : 'Payment received');

function receiptHtml(r: ReceiptData) {
  const ym = r.month;
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@700;800&family=Sacramento&display=swap" rel="stylesheet">' +
    '<title>Receipt ' + esc(r.rno) + ' — ' + esc(r.name) + '</title><style>' + RECEIPT_CSS + '</style></head><body>' +
    '<button class="print" onclick="window.print()">Print / Save as PDF</button>' +
    '<div class="page"><div class="pad">' +
    '<div class="hd"><div class="brand"><img src="' + LOGO + '" alt="' + BRAND_ALT + '" style="height:56px;width:auto"></div>' +
    '<div class="rc"><h1>RECEIPT</h1><div class="row"><span class="k">Receipt No.</span><span class="v">' + esc(r.rno) + '</span></div><div class="row"><span class="k">Date</span><span class="v">' + fmtDate(r.date) + '</span></div></div></div>' +
    '<div class="sub">A/L Business Studies Tuition Class</div>' +
    '<div class="hr"></div>' +
    '<div class="rf">Received From</div><div class="nm">' + esc(r.name) + '</div>' +
    '<div class="meta"><span>' + esc(cohortLabel(r.cohort)) + '</span><span class="dot">|</span><span>' + esc(r.program) + '</span><span class="dot">|</span><span>' + esc(r.co) + '</span></div>' +
    '<div class="tbar"><span>Description</span><span>Amount</span></div>' +
    '<div class="trow"><span>Class fee · ' + monthLbl(ym) + '</span><span class="amt">' + f(r.paid) + '</span></div>' +
    '<div class="boxes"><div class="bx"><div class="l">Payment Method</div><div class="v">' + esc(r.method) + '</div><div class="n">' + methodNote(r.method) + '</div></div>' +
    '<div class="bx"><div class="l">Balance</div><div class="v">' + (r.balance > 0 ? f(r.balance) : 'Nil') + '</div><div class="n">' + (r.balance > 0 ? 'for ' + monthLbl(ym) : 'fully settled') + '</div></div></div>' +
    '<div class="total"><div class="stamp">PAID</div><div class="tp"><div class="l">Total Paid</div><div class="v">' + f(r.paid) + '</div></div></div>' +
    '<div class="hr"></div>' +
    '<div class="ft"><div class="sig"><div class="sg">Leon Fambeck</div><div class="ln"></div><div class="rb">Received by · Leon Fambeck</div></div>' +
    '<div class="ty">Thank you for your payment. We appreciate your commitment to learning and look forward to supporting your progress in Business Studies.<br><br><b>— Leon Fambeck</b></div></div>' +
    '</div>' +
    '<div class="foot"><div class="fb"><img src="' + LOGO + '" alt="" style="height:34px;width:auto"></div><div class="loc">BS With Leon · A/L Business Studies<br>Nugegoda · Kiribathgoda · Gampaha · Online</div></div>' +
    '<div class="cg">This is a computer-generated receipt.</div>' +
    '</div></body></html>'
  );
}

/** Open the receipt for one student's payment(s) in a billing month.
    Resolves with the receipt number (callers toast "Receipt {rno} ready"). */
export async function openReceipt(input: ReceiptInput): Promise<string> {
  const w = openBlank('receipt');
  try {
    const q = new URLSearchParams({ student: String(input.studentId) });
    if (input.month) q.set('month', input.month);
    const r = await api<ReceiptData>(`/api/staff/fees/receipt?${q}`);
    fill(w, receiptHtml(r));
    return r.rno;
  } catch (e) {
    w.close();
    throw e;
  }
}

/* ─── Student Starter Guide ───────────────────────────────────────────── */

type GuideData = { name: string; cohort: number; program: string; co: string; joined: string; fee: number };

const SECS: [number, string, string, string[]][] = [
  [1, 'Start here, the one idea', 'Business Studies is not a memorising subject. Marks come from applying theory to a real business in the question, not from repeating definitions.', ['Understand the question.', 'Apply your knowledge.', 'Write with sense.']],
  [2, 'What the exam actually rewards', 'The exam rewards application and evaluation, not how much you can remember.', ['State / Define, a quick, correct point.', 'Explain / Analyse, build a chain: point, because, therefore, effect on the business.', 'Evaluate / Justify / Discuss, argue both sides, then give a clear, reasoned judgement.']],
  [3, 'Your weekly rhythm', 'Consistency is more powerful than last-minute cramming.', ['Attend the class fully present.', 'Review the same day, rewrite key points in your own words.', 'Practise 2 to 3 application questions on that topic.', 'Flag what you could not answer and bring it to class.']],
  [4, 'How to revise (the right way)', 'Smart revision makes your learning stick and your answers stronger.', ['Active recall over re-reading.', 'One-page summary per unit. If it does not fit on a page, you have not understood it yet.', 'Teach it aloud. Explain a concept as if to a friend.', 'Close the book and write everything you remember.']],
  [5, 'Past papers, how and when', 'Past papers train your mind to think like the examiner.', ['Start early. Do not wait to "finish the syllabus".', 'Do questions topic-by-topic first, full papers later.', 'Mark against the scheme. Study what a full-mark answer contains, not just the final answer.', 'Time yourself. Running out of time on the high-mark questions is a grade-killer.']],
  [6, 'Common mistakes in the BS paper', 'Avoiding errors is as important as knowing the content.', ['Writing textbook definitions without applying them.', 'Ignoring the command word, describing when asked to evaluate.', 'Listing points instead of developing them into a chain of analysis.', 'Weak conclusions with no clear, justified judgement.', 'Poor time management, over-writing early, running dry on the big questions.']],
  [7, 'How to get the most out of this class', 'Use the class, Leon, and every resource to your advantage.', ['The class works best as a back-and-forth, not a lecture.', 'Come with your flagged questions and ask them.', 'Tell Leon early if you are falling behind. Early is easy to fix, late is not.', 'Be active. Ask. Clarify. Engage. Improve.']],
  [8, 'Your first week', 'Set the right habits from the very beginning.', ['Get all your notes and materials organised in one place.', 'Set a fixed same-day review slot after each class.', 'Write a one-page summary of your first topic.', 'Do one past-paper application question and mark it.', 'Note one thing you are unsure about, and ask Leon.']],
];

const RS = 'viewBox="0 0 24 24" fill="none" stroke="#141417" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const RDIC: Record<string, string> = {
  target: `<svg ${RS}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/></svg>`,
  seat: `<svg ${RS}><circle cx="12" cy="6" r="3"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>`,
  clock: `<svg ${RS}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  note: `<svg ${RS}><path d="M4 4h13l3 3v13H4z"/><path d="M8 10h8M8 14h6"/></svg>`,
  qdoc: `<svg ${RS}><path d="M6 3h9l4 4v14H6z"/><path d="M12 11a1.5 1.5 0 1 1 1.5 1.5v1"/><path d="M13.5 16.5h.01"/></svg>`,
  scheme: `<svg ${RS}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8l1.5 1.5L14 6"/><path d="M9 15h6"/></svg>`,
  fix: `<svg ${RS}><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`,
  timer: `<svg ${RS}><circle cx="12" cy="13" r="8"/><path d="M12 13V9M9 2h6"/></svg>`,
  up: `<svg ${RS}><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>`,
  ask: `<svg ${RS}><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><path d="M10.5 9a1.5 1.5 0 1 1 1.5 1.5v.5"/></svg>`,
  chart: `<svg ${RS}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  repeat: `<svg ${RS}><path d="M4 12a8 8 0 0 1 13-6l3 3M20 12a8 8 0 0 1-13 6l-3-3"/><path d="M20 3v3h-3M4 21v-3h3"/></svg>`,
  shield: `<svg ${RS}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>`,
  trophy: `<svg ${RS}><path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3M10 13h4M9 20h6M12 13v3"/></svg>`,
};

const ROAD: [string, string, string, string][] = [
  ['01', 'Set your goal', 'An A is your standard, not your dream.', 'target'],
  ['02', 'Attend every class', 'Catch what is not in the textbook.', 'seat'],
  ['03', 'Review in 24 hours', 'Rewrite the lesson in your words.', 'clock'],
  ['04', 'Build summary notes', 'One page after every topic.', 'note'],
  ['05', 'Practise questions', 'Apply theory, do not memorise.', 'qdoc'],
  ['06', 'Mark to the scheme', 'Learn how marks are awarded.', 'scheme'],
  ['07', 'Fix every mistake', 'Turn wrongs into lessons.', 'fix'],
  ['08', 'Timed past papers', 'Train under exam conditions.', 'timer'],
  ['09', 'Improve weak topics', 'Time where you lose marks.', 'up'],
  ['10', 'Ask early', 'Never leave confusion late.', 'ask'],
  ['11', 'Track progress', 'Watch your marks climb.', 'chart'],
  ['12', 'Repeat', 'Consistency builds confidence.', 'repeat'],
  ['13', 'Exam ready', 'Walk in fully prepared.', 'shield'],
  ['14', 'Achieve an A', 'Confidence. Application. Success.', 'trophy'],
];

const OATH = [
  'Attend every class, on time and fully present.',
  'Review each lesson the same day, in my own words.',
  'Attempt the questions set for me each week.',
  'Ask when I do not understand, early, not late.',
  'Keep my fees up to date so my seat stays mine.',
  'Aim for an A, and put in the consistent work it takes.',
];

const GUIDE_CSS =
  "*{margin:0;box-sizing:border-box;font-family:'Inter',Arial,sans-serif}" +
  'body{background:#eceef3;color:#141417;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  '.page{max-width:820px;margin:22px auto;background:#fff;border:1px solid #e6e6ea;box-shadow:0 8px 34px rgba(0,0,0,.12);padding:46px 54px 42px}' +
  '.print{position:fixed;top:16px;right:16px;background:#141417;color:#fff;border:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:12.5px;cursor:pointer;z-index:9}' +
  '.top{display:flex;align-items:center;gap:14px;border-bottom:2px solid #141417;padding-bottom:20px}.top .bar{width:2px;height:44px;background:#141417}' +
  ".bn{font-family:'Poppins';font-weight:800;font-size:15px;line-height:1.25}.bn small{display:block}" +
  ".tag{margin-left:auto;text-align:right}.tag .t1{font-family:'Poppins';font-weight:800;font-size:13.5px}.tag .t2{font-size:11px;color:#8a8a95;margin-top:2px}" +
  "h1{font-family:'Poppins';font-size:30px;font-weight:800;letter-spacing:-.6px;margin:26px 0 8px}" +
  '.lead{font-size:13.5px;color:#44454d;line-height:1.6;max-width:64ch}' +
  '.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin:22px 0 6px}' +
  '.box{border:1px solid #e6e6ea;border-radius:11px;padding:13px 15px}.box .l{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#8a8a95;font-weight:700}.box .v{font-size:15px;font-weight:700;margin-top:4px}' +
  '.feebar{background:#f5f5f8;border-radius:11px;padding:15px 18px;font-size:12.5px;color:#333;line-height:1.6;margin:4px 0 8px}.feebar b{color:#141417}' +
  ".gt{font-family:'Poppins';font-size:22px;font-weight:800;letter-spacing:-.4px;margin:34px 0 4px;border-top:2px solid #141417;padding-top:20px}" +
  '.gsub{font-size:12.5px;color:#8a8a95;margin-bottom:10px}' +
  '.srow{display:flex;gap:20px;padding:18px 0;border-bottom:1px solid #eee;page-break-inside:avoid}' +
  ".num{font-family:'Poppins';font-weight:800;font-size:34px;color:#141417;width:56px;flex:none;line-height:1}" +
  ".sc h3{font-family:'Poppins';font-size:15px;font-weight:800;margin-bottom:5px}.sc .in{font-size:12.5px;color:#555;margin-bottom:9px}" +
  ".sc ul{list-style:none;display:grid;gap:6px}.sc li{font-size:12.5px;color:#333;padding-left:18px;position:relative;line-height:1.45}.sc li:before{content:'';position:absolute;left:0;top:6px;width:6px;height:6px;border-radius:2px;background:#141417}" +
  '.quote{border:1px solid #e6e6ea;border-left:4px solid #141417;border-radius:0 10px 10px 0;padding:16px 20px;margin:22px 0 4px;font-style:italic;font-size:13.5px;color:#222;line-height:1.5}' +
  ".chk{border:1px solid #e6e6ea;border-radius:11px;padding:18px 20px;margin-top:16px}.chk h4{font-family:'Poppins';font-size:12.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}.chk ul{list-style:none;display:grid;gap:10px}.chk li{font-size:12.5px;padding-left:28px;position:relative;color:#333}.chk li:before{content:'';position:absolute;left:0;top:-1px;width:16px;height:16px;border:1.6px solid #141417;border-radius:4px}" +
  ".roadmap{margin-top:12px}.rr{display:flex;justify-content:space-between;gap:6px;position:relative;margin-bottom:24px;page-break-inside:avoid}.rr:before{content:'';position:absolute;top:18px;left:9%;right:9%;height:2px;background:#e2e2e8;z-index:0}.rs{flex:1;text-align:center;position:relative;z-index:1;padding:0 2px}.rc{width:36px;height:36px;border:2px solid #141417;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-family:'Poppins';font-weight:800;font-size:12.5px;margin:0 auto 9px}.ri{height:26px;margin-bottom:7px}.ri svg{width:24px;height:24px}" +
  ".rt{font-family:'Poppins';font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.2px;line-height:1.25;margin-bottom:3px}.rp{font-size:9px;color:#666;line-height:1.35}" +
  ".oath{border:2px solid #141417;border-radius:14px;padding:24px 26px;margin-top:16px}.oath h4{font-family:'Poppins';font-size:15px;font-weight:800;margin-bottom:6px}.oath .oi{font-size:12.5px;color:#555;margin-bottom:14px}.oath ul{list-style:none;display:grid;gap:9px}.oath li{font-size:12.5px;color:#222;padding-left:20px;position:relative;line-height:1.5}.oath li:before{content:'✓';position:absolute;left:0;top:0;font-weight:800}" +
  '.osign{display:flex;gap:40px;margin-top:22px}.osign .c{flex:1}.osign .ln{border-top:1px solid #141417;margin-top:34px;padding-top:6px;font-size:11px;color:#8a8a95}' +
  '.pgbreak{page-break-before:always}' +
  '.foot{margin-top:30px;border-top:1px solid #e6e6ea;padding-top:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}.foot .fn{font-size:11px;font-weight:700;line-height:1.3}.foot .loc{font-size:11px;color:#8a8a95;border-left:1px solid #e6e6ea;padding-left:14px}' +
  '@page{size:auto;margin:14mm}@media print{.print{display:none}body{background:#fff}.page{box-shadow:none;margin:0;max-width:100%;border:none;padding:0}}';

const ordinal = (n: number) => n + ([1, 21, 31].includes(n) ? 'st' : [2, 22].includes(n) ? 'nd' : [3, 23].includes(n) ? 'rd' : 'th');

function guideHtml(g: GuideData) {
  const due = 5; // fees are due by the 5th, as the original guide says
  const first = g.name.split(' ')[0];
  const secHTML = SECS.map(
    (v) =>
      '<div class="srow"><div class="num">' + String(v[0]).padStart(2, '0') + '</div><div class="sc"><h3>' + v[1] + '</h3><p class="in">' + v[2] + '</p><ul>' +
      v[3].map((li) => '<li>' + li + '</li>').join('') +
      '</ul></div></div>',
  ).join('');
  const roadRow = (items: typeof ROAD) =>
    '<div class="rr">' +
    items.map((v) => '<div class="rs"><div class="rc">' + v[0] + '</div><div class="ri">' + RDIC[v[3]] + '</div><div class="rt">' + v[1] + '</div><div class="rp">' + v[2] + '</div></div>').join('') +
    '</div>';
  const roadHTML = '<div class="roadmap">' + roadRow(ROAD.slice(0, 5)) + roadRow(ROAD.slice(5, 10)) + roadRow(ROAD.slice(10, 14)) + '</div>';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@700;800&display=swap" rel="stylesheet">' +
    '<title>Student Starter Guide — ' + esc(g.name) + '</title><style>' + GUIDE_CSS + '</style></head><body>' +
    '<button class="print" onclick="window.print()">Print / Save as PDF</button>' +
    '<div class="page">' +
    '<div class="top"><img src="' + LOGO + '" alt="' + BRAND_ALT + '" style="height:54px;width:auto"><div class="tag"><div class="t1">STUDENT STARTER GUIDE</div><div class="t2">' + fmtDate(todayISO()) + '</div></div></div>' +
    '<h1>Welcome to the class, ' + esc(first) + '.</h1>' +
    '<p class="lead">You are now enrolled in A/L Business Studies with Leon. This guide is your short path to studying the right way from day one. How the exam actually rewards you, your weekly rhythm, and the road to an A. Read it before your first class and keep it close.</p>' +
    '<div class="grid"><div class="box"><div class="l">Student</div><div class="v">' + esc(g.name) + '</div></div><div class="box"><div class="l">Batch & program</div><div class="v">' + esc(cohortLabel(g.cohort).replace(' Batch', '')) + ' · ' + esc(g.program) + '</div></div><div class="box"><div class="l">Location</div><div class="v">' + esc(g.co) + '</div></div><div class="box"><div class="l">Start date</div><div class="v">' + fmtDate(g.joined) + '</div></div></div>' +
    '<div class="feebar">Your fee is <b>LKR ' + g.fee.toLocaleString('en-LK') + ' per month</b>, due by the <b>' + ordinal(due) + '</b> of each month. Pay at class or by transfer; if a payment slips you will get a friendly reminder on WhatsApp.</div>' +
    '<div class="gt">Studying it the right way</div><div class="gsub">A short path to studying A/L Business Studies well, from day one.</div>' +
    secHTML +
    '<div class="quote">"Success in Business Studies doesn’t come from memorising. It comes from understanding and applying."</div>' +
    '<div class="chk"><h4>Your first-week checklist</h4><ul><li>Get all your notes and materials organised in one place.</li><li>Set a fixed same-day review slot after each class.</li><li>Write a one-page summary of your first topic.</li><li>Do one past-paper application question and mark it.</li><li>Note one thing you’re unsure about, and ask Leon.</li></ul></div>' +
    '<div class="pgbreak"></div>' +
    '<div class="gt">The road to an A</div><div class="gsub">Your Business Studies success blueprint.</div>' +
    roadHTML +
    '<div class="quote">"The students who earn A grades aren’t always the smartest. They’re simply the most consistent."</div>' +
    '<div class="oath"><h4>My commitment</h4><div class="oi">I, <b>' + esc(g.name) + '</b>, am joining this class to earn a top grade. I commit to:</div><ul>' +
    OATH.map((li) => '<li>' + li + '</li>').join('') +
    '</ul>' +
    '<div class="osign"><div class="c"><div class="ln">Student signature</div></div><div class="c"><div class="ln">Date</div></div></div></div>' +
    '<div class="foot"><img src="' + LOGO + '" alt="" style="height:34px;width:auto"><div class="loc">BS With Leon · A/L Business Studies<br>Nugegoda · Kiribathgoda · Gampaha · Online</div></div>' +
    '</div></body></html>'
  );
}

/** Open the Student Starter Guide for one student. Resolves with the first name
    (callers toast "Starter guide ready for {First}"). */
export async function openStarterGuide(studentId: number): Promise<string> {
  const w = openBlank('starter guide');
  try {
    const g = await api<GuideData>(`/api/staff/fees/guide?student=${studentId}`);
    fill(w, guideHtml(g));
    return g.name.split(' ')[0];
  } catch (e) {
    w.close();
    throw e;
  }
}
