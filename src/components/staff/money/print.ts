'use client';

/* The original PRINT core (printDoc / docHead / docFoot): an A4-like page in
   a new window with the company header, used by invoices, the sales report
   and the Customize "Preview a document". */

import { CFG } from '@/lib/shared/constants';
import { fmtDate, todayISO } from '@/lib/shared/dates';

export type Company = { name: string; phone: string; email: string; address: string };

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function docHead(co: Company, right: string) {
  return (
    '<div class="dhead"><div><div class="co">' + esc(co.name) + '</div><div class="cm">' + esc(co.address) + '<br>' + esc(co.phone) + ' · ' + esc(co.email) +
    '</div></div><h1>' + esc(right) + '</h1></div>'
  );
}

export function docFoot(co: Company) {
  return '<div class="foot"><span>' + esc(co.name) + '</span><span>Generated ' + fmtDate(todayISO()) + ' · ' + esc(CFG.app.client) + '</span></div>';
}

/** Throws when pop-ups are blocked so the caller can toast the original message. */
export function printDoc(title: string, inner: string) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('Allow pop-ups to generate the document');
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#141417';
  const css =
    '*{margin:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}body{background:#e9e9e9;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{max-width:820px;margin:20px auto;background:#fff;box-shadow:0 6px 30px rgba(0,0,0,.15)}.pad{padding:30px 40px}.print{position:fixed;top:16px;right:16px;background:' +
    brand +
    ';color:#fff;border:none;padding:11px 20px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;z-index:9}.dhead{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ' +
    brand +
    ';padding-bottom:16px;margin-bottom:20px}.dhead .co{font-size:19px;font-weight:800}.dhead .cm{font-size:11px;color:#666;margin-top:4px;line-height:1.6}.dhead h1{font-size:26px;font-weight:800;letter-spacing:1px;text-align:right}table{width:100%;border-collapse:collapse;margin:14px 0}th{background:#111;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:9px 12px;text-align:left}td{padding:8px 12px;font-size:12.5px;border-bottom:1px solid #e4e4e4}.tr{text-align:right}.tot{display:flex;justify-content:flex-end;margin-top:10px}.tot .box{width:280px}.trow{display:flex;justify-content:space-between;padding:7px 14px;border:1px solid #e2e2e2;border-bottom:none;font-size:12.5px}.grand{background:' +
    brand +
    ';color:#fff;font-weight:800;border-color:' +
    brand +
    '}.foot{margin-top:24px;border-top:1px solid #ddd;padding-top:12px;font-size:11px;color:#666;display:flex;justify-content:space-between}@page{size:auto;margin:0}@media print{.print{display:none}body{background:#fff}.page{box-shadow:none;margin:0;max-width:100%}}';
  w.document.write(
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      esc(title) +
      '</title><style>' +
      css +
      '</style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><div class="page"><div class="pad">' +
      inner +
      '</div></div></body></html>',
  );
  w.document.close();
}

