import { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import { HiArrowLeft, HiPrinter, HiDocumentDownload } from 'react-icons/hi';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addPageNumbers } from '../../utils/exportPDF';
import { returnAPI } from '../../api/endpoints';
import { Card, Button, Loading, Table } from '../../components/common';
import { formatRupiah, formatNumber } from '../../utils/formatCurrency';
import { formatTanggalWaktu, formatTanggal } from '../../utils/formatDate';
import { STORE_INFO } from '../../utils/constants';

export default function ReturnDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const printRef = useRef();

  const { data: ret, isLoading } = useQuery({
    queryKey: ['return', id],
    queryFn: async () => {
      const { data } = await returnAPI.getById(id);
      return data.data;
    },
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Retur-${ret?.returnNumber || ''}`,
  });

  const handleExportPDF = () => {
    if (!ret) return;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pw = doc.internal.pageSize.getWidth();
    const items = ret.items || [];

    // Header Toko
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(STORE_INFO.NAME, pw / 2, 15, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(STORE_INFO.ADDRESS, pw / 2, 21, { align: 'center' });
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(14, 24, pw - 14, 24);

    // Judul
    let y = 32;
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('BUKTI RETUR', pw / 2, y, { align: 'center' });
    y += 10;

    // Info Retur
    const labelX = 14;
    const colonX = 55;
    const valueX = 59;
    const lineHeight = 6;

    const infoRows = [
      ['No. Retur', ret.returnNumber],
      ['No. Transaksi', ret.transaction?.transactionNumber || '-'],
      ['Tanggal', formatTanggalWaktu(ret.createdAt)],
      ['Customer', ret.transaction?.customerName || '-'],
      ['Dibuat Oleh', ret.creator?.fullName || '-'],
      ['Alasan', ret.reason || '-'],
    ];

    doc.setFontSize(10);
    infoRows.forEach(([label, value]) => {
      doc.setFont(undefined, 'bold');
      doc.text(label, labelX, y);
      doc.text(':', colonX, y);
      doc.setFont(undefined, 'normal');
      doc.text(String(value), valueX, y);
      y += lineHeight;
    });

    y += 4;

    // Tabel Item
    const headers = ['No', 'Produk', 'Qty Retur', 'Harga', 'Subtotal'];
    const rows = items.map((item, i) => [
      i + 1,
      item.product?.name || '-',
      item.quantity,
      formatNumber(item.price),
      formatNumber(item.subtotal),
    ]);

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: y,
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold', fontSize: 9, halign: 'center' },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { halign: 'center', cellWidth: 12 },
        1: { halign: 'left' },
        2: { halign: 'center', cellWidth: 25 },
        3: { halign: 'right', cellWidth: 30 },
        4: { halign: 'right', cellWidth: 35 },
      },
      styles: { cellPadding: 2, overflow: 'linebreak' },
      margin: { left: 14, right: 14 },
    });

    // Total Refund
    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Total Refund:', pw - 70, finalY);
    doc.setTextColor(220, 38, 38);
    doc.text(formatRupiah(ret.refundAmount), pw - 14, finalY, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    // Tanggal cetak
    const printY = finalY + 10;
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    const now = new Date();
    doc.text(
      `Dicetak: ${now.toLocaleDateString('id-ID')} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`,
      pw - 14, printY, { align: 'right' }
    );

    addPageNumbers(doc);
    doc.save(`retur-${ret.returnNumber}.pdf`);
  };

  if (isLoading) return <Loading text="Memuat detail retur..." />;
  if (!ret) return <p className="text-center text-gray-500 py-12">Data retur tidak ditemukan</p>;

  const itemColumns = [
    {
      key: 'product',
      header: 'Produk',
      render: (_, row) => (
        <p className="font-medium text-gray-900">{row.product?.name || '-'}</p>
      ),
    },
    {
      key: 'quantity',
      header: 'Qty Retur',
      render: (v) => <span className="font-medium">{v}</span>,
    },
    {
      key: 'price',
      header: 'Harga',
      render: (v) => formatRupiah(v),
    },
    {
      key: 'subtotal',
      header: 'Subtotal',
      render: (v) => <span className="font-medium text-gray-900">{formatRupiah(v)}</span>,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/retur')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <HiArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{ret.returnNumber}</h1>
            <p className="text-sm text-gray-500">{formatTanggalWaktu(ret.createdAt)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <HiPrinter className="w-4 h-4 mr-1" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            <HiDocumentDownload className="w-4 h-4 mr-1" /> PDF
          </Button>
        </div>
      </div>

      {/* Printable Area */}
      <div ref={printRef}>
        {/* Info Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card title="Informasi Retur" padding="md">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">No. Retur</span>
                <span className="text-sm font-mono font-medium">{ret.returnNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">No. Transaksi</span>
                <span className="text-sm font-mono text-blue-600 cursor-pointer hover:underline"
                  onClick={() => navigate(`/transaksi/${ret.transaction?.id}`)}>
                  {ret.transaction?.transactionNumber || '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Total Refund</span>
                <span className="text-sm font-bold text-red-600">{formatRupiah(ret.refundAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Dibuat Oleh</span>
                <span className="text-sm">{ret.creator?.fullName || '-'}</span>
              </div>
              {ret.reason && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">Alasan</p>
                  <p className="text-sm text-gray-700">{ret.reason}</p>
                </div>
              )}
            </div>
          </Card>

          <Card title="Transaksi Asal" padding="md">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Customer</span>
                <span className="text-sm">{ret.transaction?.customerName || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Total Transaksi</span>
                <span className="text-sm font-medium">{formatRupiah(ret.transaction?.total)}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Items */}
        <Card title={`Item Retur (${ret.items?.length || 0})`} padding="none">
          <Table
            columns={itemColumns}
            data={ret.items || []}
            emptyMessage="Tidak ada item"
          />
          {ret.items?.length > 0 && (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
              <div className="text-right">
                <p className="text-sm text-gray-500">Total Refund</p>
                <p className="text-xl font-bold text-red-600">{formatRupiah(ret.refundAmount)}</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
