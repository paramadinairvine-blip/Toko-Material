import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { STORE_INFO } from './constants';

/**
 * Write "Halaman X dari Y" on every page. Call this after all content is drawn,
 * so the total page count is final (didDrawPage only knows the pages so far).
 *
 * @param {jsPDF} doc
 */
export function addPageNumbers(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
  }
}

/**
 * Export table data to PDF (A4 format).
 *
 * @param {string} title - Report title
 * @param {string[]} headers - Column headers
 * @param {Array<Array<string|number>>} data - Table rows (array of arrays)
 * @param {string} [filename='laporan.pdf'] - Output filename
 * @param {object} [options] - Additional options
 * @param {string} [options.subtitle] - Subtitle/filter info
 * @param {Array<'left'|'center'|'right'>} [options.columnStyles] - Column alignments
 */
export function exportTableToPDF(title, headers, data, filename = 'laporan.pdf', options = {}) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();

  // ─── Header ─────────────────────────────────────────
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(STORE_INFO.NAME, pageWidth / 2, 15, { align: 'center' });

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text(STORE_INFO.ADDRESS, pageWidth / 2, 21, { align: 'center' });

  // Divider
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(14, 24, pageWidth - 14, 24);

  // Title
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.text(title, pageWidth / 2, 32, { align: 'center' });

  // Subtitle / filter info
  let startY = 36;
  if (options.subtitle) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(options.subtitle, pageWidth / 2, 38, { align: 'center' });
    startY = 42;
  }

  // Print date
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  const now = new Date();
  const dateStr = `Dicetak: ${now.toLocaleDateString('id-ID')} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
  doc.text(dateStr, pageWidth - 14, startY, { align: 'right' });
  startY += 4;

  // ─── Table ──────────────────────────────────────────
  const columnStyles = {};
  if (options.columnStyles) {
    options.columnStyles.forEach((align, i) => {
      columnStyles[i] = { halign: align };
    });
  }

  autoTable(doc, {
    head: [headers],
    body: data,
    startY,
    theme: 'grid',
    headStyles: {
      fillColor: [59, 130, 246],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    bodyStyles: {
      fontSize: 8,
    },
    columnStyles,
    styles: {
      cellPadding: 2,
      overflow: 'linebreak',
    },
    margin: { left: 14, right: 14 },
  });

  addPageNumbers(doc);

  doc.save(filename);
}
