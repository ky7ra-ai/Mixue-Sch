'use strict';
/*
 * XlsxLite - pembuat file .xlsx mini (tanpa dependensi, jalan di browser & Node).
 * Dipakai untuk ekspor jadwal ke WPS Office / Excel dengan tampilan tabel berwarna.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XlsxLite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const enc = new TextEncoder();

  /* ---------- ZIP (tanpa kompresi) ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const u16 = (n) => [n & 255, (n >>> 8) & 255];
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const push = (arr) => { const u = arr instanceof Uint8Array ? arr : Uint8Array.from(arr); parts.push(u); offset += u.length; };
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const localOffset = offset;
      push([0x50, 0x4b, 3, 4].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(size), u32(size), u16(name.length), u16(0)));
      push(name);
      push(f.data);
      central.push({ name, crc, size, localOffset });
    });
    const cdStart = offset;
    central.forEach((c) => {
      push([0x50, 0x4b, 1, 2].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(c.crc), u32(c.size), u32(c.size),
        u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.localOffset)));
      push(c.name);
    });
    const cdSize = offset - cdStart;
    push([0x50, 0x4b, 5, 6].concat(u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0)));
    const out = new Uint8Array(offset);
    let p = 0;
    parts.forEach((u) => { out.set(u, p); p += u.length; });
    return out;
  }

  /* ---------- helper XML ---------- */
  const esc = (s) => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colName(i) {
    let s = '';
    let n = i + 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /* ---------- workbook ---------- */
  function createWorkbook() {
    const fonts = [], fills = [], borders = [], xfs = [];
    const idx = (arr, key) => { const i = arr.indexOf(key); if (i >= 0) return i; arr.push(key); return arr.length - 1; };
    // font/fill/border bawaan
    idx(fonts, JSON.stringify({ sz: 11, b: false, color: '000000' }));
    idx(fills, 'none'); idx(fills, 'gray125');
    idx(borders, 'none');
    idx(xfs, JSON.stringify({ f: 0, fl: 0, b: 0, a: null }));

    // style: {bold,size,color,fill,border,h,v,wrap}
    function style(o) {
      const f = idx(fonts, JSON.stringify({ sz: o.size || 11, b: !!o.bold, color: o.color || '000000' }));
      const fl = o.fill ? idx(fills, o.fill) : 0;
      const b = o.border ? idx(borders, o.border) : 0;
      const a = (o.h || o.v || o.wrap) ? { h: o.h || 'center', v: o.v || 'center', wrap: !!o.wrap } : null;
      return idx(xfs, JSON.stringify({ f, fl, b, a }));
    }

    const sheet = { cells: {}, merges: [], rowH: {}, colW: {}, maxR: 0, maxC: 0 };
    const sst = [], sstMap = {};
    const strId = (s) => { if (sstMap[s] === undefined) { sstMap[s] = sst.length; sst.push(s); } return sstMap[s]; };

    function set(r, c, value, styleId) {
      sheet.cells[r + ',' + c] = { r, c, v: value === undefined || value === null || value === '' ? null : String(value), s: styleId || 0 };
      if (r > sheet.maxR) sheet.maxR = r;
      if (c > sheet.maxC) sheet.maxC = c;
    }
    // r,c 0-based
    function fillRange(r1, c1, r2, c2, styleId) {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const k = r + ',' + c;
        if (!sheet.cells[k]) set(r, c, null, styleId);
        else sheet.cells[k].s = styleId;
      }
    }
    function merge(r1, c1, r2, c2) { sheet.merges.push(colName(c1) + (r1 + 1) + ':' + colName(c2) + (r2 + 1)); }

    function fontXml(k) {
      const f = JSON.parse(k);
      return '<font>' + (f.b ? '<b/>' : '') + '<sz val="' + f.sz + '"/><color rgb="FF' + f.color + '"/><name val="Arial"/><family val="2"/></font>';
    }
    function fillXml(k) {
      if (k === 'none') return '<fill><patternFill patternType="none"/></fill>';
      if (k === 'gray125') return '<fill><patternFill patternType="gray125"/></fill>';
      return '<fill><patternFill patternType="solid"><fgColor rgb="FF' + k + '"/><bgColor indexed="64"/></patternFill></fill>';
    }
    function borderXml(k) {
      if (k === 'none') return '<border><left/><right/><top/><bottom/><diagonal/></border>';
      const side = (n) => '<' + n + ' style="thin"><color rgb="FF' + k + '"/></' + n + '>';
      return '<border>' + side('left') + side('right') + side('top') + side('bottom') + '<diagonal/></border>';
    }
    function xfXml(k) {
      const x = JSON.parse(k);
      let s = '<xf numFmtId="0" fontId="' + x.f + '" fillId="' + x.fl + '" borderId="' + x.b + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1"' + (x.a ? ' applyAlignment="1">' : '>');
      if (x.a) s += '<alignment horizontal="' + x.a.h + '" vertical="' + x.a.v + '"' + (x.a.wrap ? ' wrapText="1"' : '') + '/>';
      return s + '</xf>';
    }

    function build(sheetName) {
      const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

      // sheet
      let sd = '';
      for (let r = 0; r <= sheet.maxR; r++) {
        let row = '';
        for (let c = 0; c <= sheet.maxC; c++) {
          const cell = sheet.cells[r + ',' + c];
          if (!cell) continue;
          const ref = colName(c) + (r + 1);
          if (cell.v === null) row += '<c r="' + ref + '" s="' + cell.s + '"/>';
          else row += '<c r="' + ref + '" s="' + cell.s + '" t="s"><v>' + strId(cell.v) + '</v></c>';
        }
        const ht = sheet.rowH[r];
        if (row || ht) sd += '<row r="' + (r + 1) + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>' + row + '</row>';
      }
      let cols = '';
      Object.keys(sheet.colW).map(Number).sort((a, b) => a - b).forEach((c) => {
        cols += '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + sheet.colW[c] + '" customWidth="1"/>';
      });
      const sheetXml = head + '<worksheet xmlns="' + NS + '"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
        '<dimension ref="A1:' + colName(sheet.maxC) + (sheet.maxR + 1) + '"/>' +
        '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
        (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + sd + '</sheetData>' +
        (sheet.merges.length ? '<mergeCells count="' + sheet.merges.length + '">' + sheet.merges.map((m) => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>' : '') +
        '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
        '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';

      const stylesXml = head + '<styleSheet xmlns="' + NS + '">' +
        '<fonts count="' + fonts.length + '">' + fonts.map(fontXml).join('') + '</fonts>' +
        '<fills count="' + fills.length + '">' + fills.map(fillXml).join('') + '</fills>' +
        '<borders count="' + borders.length + '">' + borders.map(borderXml).join('') + '</borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="' + xfs.length + '">' + xfs.map(xfXml).join('') + '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

      const sstXml = head + '<sst xmlns="' + NS + '" count="' + sst.length + '" uniqueCount="' + sst.length + '">' +
        sst.map((s) => '<si><t xml:space="preserve">' + esc(s) + '</t></si>').join('') + '</sst>';

      const workbookXml = head + '<workbook xmlns="' + NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
      const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
      const wbRels = head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="' + REL + '/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId3" Type="' + REL + '/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
      const rels = head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>';
      const types = head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';

      return zip([
        { name: '[Content_Types].xml', data: enc.encode(types) },
        { name: '_rels/.rels', data: enc.encode(rels) },
        { name: 'xl/workbook.xml', data: enc.encode(workbookXml) },
        { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
        { name: 'xl/styles.xml', data: enc.encode(stylesXml) },
        { name: 'xl/sharedStrings.xml', data: enc.encode(sstXml) },
        { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml) },
      ]);
    }

    return {
      style, set, fillRange, merge, build,
      rowHeight: (r, pt) => { sheet.rowH[r] = pt; if (r > sheet.maxR) sheet.maxR = r; },
      colWidth: (c, w) => { sheet.colW[c] = w; },
    };
  }

  /* ---------- tata letak jadwal (sama dengan tabel di aplikasi) ---------- */
  const COLORS = {
    yellow: 'FFE600', green: '92D050', blue: '00B0F0', red: 'FF0000', white: 'FFFFFF',
    line: '000000', offText: '000000',
  };
  const JAM_KERJA = [['PAGI', '08.00-17.00'], ['MIDDLE', '11.00-20.00'], ['CLOSING', '13.00-22.00']];

  /*
   * model: { days:[{name:'SENIN', date:'9-Nov-26'} x7],
   *          pagiK:[7], pagiP:[7], middle:[7], siangK:[7], siangP:[7], off:[7] }  (nama huruf besar, '' bila kosong)
   * Baris: header | PAGI (kasir, piket, kosong) | MIDDLE | SIANG (kasir, piket, kosong, kosong) | OFF (2 baris) | keterangan | JAM KERJA
   */
  function buildWeekWorkbook(model) {
    const wb = createWorkbook();
    const C = COLORS;
    const base = { border: C.line, h: 'center', v: 'center' };
    const sHead = wb.style(Object.assign({}, base, { bold: true, size: 14, fill: C.yellow, wrap: true }));
    const sLabel = wb.style(Object.assign({}, base, { bold: true, size: 16, fill: C.green }));
    const sKasir = wb.style(Object.assign({}, base, { bold: true, size: 11, fill: C.white }));
    const sPiket = wb.style(Object.assign({}, base, { bold: true, size: 11, fill: C.blue }));
    const sGreen = wb.style(Object.assign({}, base, { bold: true, size: 11, fill: C.green }));
    const sMid = wb.style(Object.assign({}, base, { bold: true, size: 11, fill: C.yellow }));
    const sMidLabel = wb.style(Object.assign({}, base, { bold: true, size: 16, fill: C.yellow }));
    const sOffLabel = wb.style(Object.assign({}, base, { bold: true, size: 16, fill: C.red, color: 'FFFFFF' }));
    const sOff = wb.style(Object.assign({}, base, { bold: true, size: 11, fill: C.red, color: C.offText }));
    const sLegK = wb.style(Object.assign({}, base, { bold: true, size: 13, fill: C.white }));
    const sLegP = wb.style(Object.assign({}, base, { bold: true, size: 13, fill: C.blue }));
    const sJamHead = wb.style(Object.assign({}, base, { bold: true, size: 12, fill: C.yellow }));
    const sJam = wb.style(Object.assign({}, base, { bold: false, size: 11, fill: C.green }));

    wb.colWidth(0, 13);
    for (let c = 1; c <= 7; c++) wb.colWidth(c, 17);

    // header
    wb.set(0, 0, 'SHIFT', sHead);
    model.days.forEach((d, i) => wb.set(0, i + 1, d.name + '\n' + d.date, sHead));
    wb.rowHeight(0, 46);

    const block = (r0, rows, label, labelStyle) => {
      wb.set(r0, 0, label, labelStyle);
      rows.forEach((row, k) => {
        row.cells.forEach((v, i) => wb.set(r0 + k, i + 1, v, row.style));
        if (k > 0) wb.set(r0 + k, 0, null, labelStyle);
        wb.rowHeight(r0 + k, row.h || 24);
      });
      wb.merge(r0, 0, r0 + rows.length - 1, 0);
    };
    const blank = ['', '', '', '', '', '', ''];

    block(1, [
      { cells: model.pagiK, style: sKasir },
      { cells: model.pagiP, style: sPiket },
      { cells: blank, style: sGreen },
    ], 'PAGI', sLabel);

    // middle
    wb.set(4, 0, 'MIDDLE', sMidLabel);
    model.middle.forEach((v, i) => wb.set(4, i + 1, v, sMid));
    wb.rowHeight(4, 28);

    block(5, [
      { cells: model.siangK, style: sKasir },
      { cells: model.siangP, style: sPiket },
      { cells: blank, style: sGreen },
      { cells: blank, style: sGreen },
    ], 'SIANG', sLabel);

    block(9, [
      { cells: model.off, style: sOff },
      { cells: blank, style: sOff },
    ], 'OFF', sOffLabel);

    // keterangan warna
    wb.set(11, 0, 'KOLOM PUTIH JADWAL KASIR', sLegK);
    wb.fillRange(11, 1, 11, 7, sLegK); wb.merge(11, 0, 11, 7); wb.rowHeight(11, 28);
    wb.set(12, 0, 'KOLOM BIRU JADWAL PIKET', sLegP);
    wb.fillRange(12, 1, 12, 7, sLegP); wb.merge(12, 0, 12, 7); wb.rowHeight(12, 28);

    // jam kerja
    wb.set(14, 0, 'JAM KERJA', sJamHead);
    wb.set(14, 1, null, sJamHead); wb.merge(14, 0, 14, 1); wb.rowHeight(14, 24);
    JAM_KERJA.forEach((j, k) => {
      wb.set(15 + k, 0, j[0], sJam);
      wb.set(15 + k, 1, j[1], sJam);
      wb.rowHeight(15 + k, 22);
    });
    return wb.build('Jadwal');
  }

  return { createWorkbook, buildWeekWorkbook, zip, crc32, COLORS, JAM_KERJA };
});
