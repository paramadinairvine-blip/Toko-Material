import * as XLSX from 'xlsx';

/**
 * Export table data to Excel (.xlsx).
 *
 * @param {string} title - Sheet name / report title
 * @param {string[]} headers - Column headers
 * @param {Array<Array<string|number>>} data - Table rows (array of arrays).
 *   Use plain numbers for numeric values (not formatNumber strings) so Excel can calculate them.
 * @param {string} [filename='laporan.xlsx'] - Output filename
 */
export function exportToExcel(title, headers, data, filename = 'laporan.xlsx') {
  // Build worksheet data: title row + empty row + headers + data
  const wsData = [
    [title],
    [],
    headers,
    ...data,
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // ─── Number format for numeric cells ───────────────
  // Pass raw numbers (not formatted strings) so Excel can sum them;
  // they are displayed with thousand separators.
  const dataRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = 3; r <= dataRange.e.r; r++) {
    for (let c = dataRange.s.c; c <= dataRange.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') {
        cell.z = Number.isInteger(cell.v) ? '#,##0' : '#,##0.00';
      }
    }
  }

  // ─── Bold header row (row index 2 = headers) ───────
  const headerRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: col }); // title
    if (ws[cellRef]) ws[cellRef].s = { font: { bold: true, sz: 14 } };

    const headerRef = XLSX.utils.encode_cell({ r: 2, c: col }); // header row
    if (ws[headerRef]) ws[headerRef].s = { font: { bold: true } };
  }

  // ─── Auto-width columns ────────────────────────────
  const colWidths = headers.map((h, i) => {
    let maxLen = String(h).length;
    data.forEach((row) => {
      const cellLen = String(row[i] ?? '').length;
      if (cellLen > maxLen) maxLen = cellLen;
    });
    return { wch: Math.min(maxLen + 4, 50) };
  });
  ws['!cols'] = colWidths;

  // ─── Merge title row across all columns ────────────
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
  ];

  // ─── Create workbook and save ──────────────────────
  const wb = XLSX.utils.book_new();
  const sheetName = title.length > 31 ? title.slice(0, 31) : title;
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
