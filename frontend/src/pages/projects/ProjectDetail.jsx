import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import { HiArrowLeft, HiPencil, HiPrinter, HiDocumentDownload } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { projectAPI } from '../../api/endpoints';
import { getErrorMessage } from '../../utils/handleError';
import { Card, Badge, Button, Loading, Modal, Input } from '../../components/common';
import { formatRupiah, formatNumber } from '../../utils/formatCurrency';
import { formatTanggal, formatTanggalPanjang, formatTanggalWaktu } from '../../utils/formatDate';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { addPageNumbers } from '../../utils/exportPDF';
import { PROJECT_STATUS, PROJECT_STATUS_LABELS, PROJECT_STATUS_COLORS, STORE_INFO } from '../../utils/constants';
import useAuth from '../../hooks/useAuth';

function ProgressBar({ value, height = 'h-2', className = '' }) {
  const pct = Math.min(Math.max(value || 0, 0), 100);
  return (
    <div className={`w-full ${height} bg-gray-100 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${
          pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-blue-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-gray-400'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── Update Material Usage Modal ──────────────────────
function UpdateUsageModal({ material, projectId, onClose }) {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [usedQty, setUsedQty] = useState(material.usedQty?.toString() || '0');

  const mutation = useMutation({
    mutationFn: (data) => projectAPI.updateMaterial(projectId, material.id, data),
    onSuccess: () => {
      toast.success('Penggunaan material diperbarui');
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-report', projectId] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal memperbarui')),
  });

  // ADMIN may lower the value to correct a wrong entry; other roles can only add usage
  const currentQty = Number(material.usedQty) || 0;
  const minQty = isAdmin ? 0 : currentQty;
  const estimatedQty = Number(material.estimatedQty) || 0;
  const unitLabel = material.unit?.name || material.product?.unit || '';
  const parsedQty = parseFloat(usedQty);
  const belowMin = !isNaN(parsedQty) && parsedQty < minQty;
  const overEstimate = !isNaN(parsedQty) && parsedQty > estimatedQty;

  const handleSubmit = () => {
    const qty = parseFloat(usedQty);
    if (isNaN(qty) || qty < minQty) {
      toast.error(`Jumlah tidak boleh kurang dari ${minQty}`);
      return;
    }
    if (qty > estimatedQty && !window.confirm(
      `Qty terpakai (${qty} ${unitLabel}) melebihi estimasi (${estimatedQty} ${unitLabel}). Tetap simpan?`
    )) {
      return;
    }
    if (qty < currentQty && !window.confirm(
      `Qty terpakai akan dikoreksi turun dari ${currentQty} menjadi ${qty} ${unitLabel}. Lanjutkan?`
    )) {
      return;
    }
    mutation.mutate({ usedQty: qty });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Update Penggunaan — ${material.product?.name}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button loading={mutation.isPending} onClick={handleSubmit}>Simpan</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Estimasi</span>
            <span className="font-medium">{material.estimatedQty} {material.unit?.name || ''}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Sudah Terpakai</span>
            <span className="font-medium">{material.usedQty || 0} {material.unit?.name || ''}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Sisa Kebutuhan</span>
            <span className="font-medium">
              {(material.estimatedQty || 0) - (material.usedQty || 0)} {material.unit?.name || ''}
            </span>
          </div>
        </div>

        <Input
          label="Qty Terpakai (Total)"
          type="number"
          min={minQty}
          value={usedQty}
          onChange={(e) => setUsedQty(e.target.value)}
          helperText={isAdmin
            ? 'Admin dapat mengisi nilai lebih kecil untuk koreksi'
            : `Minimal ${minQty} (tidak bisa dikurangi)`}
          error={belowMin ? `Tidak boleh kurang dari ${minQty}` : ''}
        />
        {overEstimate && (
          <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
            Melebihi estimasi ({estimatedQty} {unitLabel}). Anda akan diminta konfirmasi saat menyimpan.
          </p>
        )}
      </div>
    </Modal>
  );
}

// ─── Project Report Print ─────────────────────────────
// eslint-disable-next-line no-unused-vars
function ProjectReportPrint({ project, report, printRef }) {
  const materials = project.materials || [];

  return (
    <div
      ref={printRef}
      className="p-8 bg-white hidden print:block"
      style={{ fontFamily: 'Arial, sans-serif', fontSize: '12px' }}
    >
      <div style={{ textAlign: 'center', marginBottom: '24px', borderBottom: '2px solid #000', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 4px 0' }}>LAPORAN PROYEK</h1>
        <p style={{ margin: 0 }}>{STORE_INFO.NAME}</p>
      </div>

      <table style={{ fontSize: '12px', marginBottom: '16px' }}>
        <tbody>
          <tr><td style={{ padding: '2px 8px 2px 0', fontWeight: 'bold' }}>Nama Proyek</td><td>: {project.name}</td></tr>
          <tr><td style={{ padding: '2px 8px 2px 0', fontWeight: 'bold' }}>Status</td><td>: {PROJECT_STATUS_LABELS[project.status]}</td></tr>
          <tr><td style={{ padding: '2px 8px 2px 0', fontWeight: 'bold' }}>Periode</td><td>: {formatTanggal(project.startDate)} — {project.endDate ? formatTanggal(project.endDate) : '-'}</td></tr>
          <tr><td style={{ padding: '2px 8px 2px 0', fontWeight: 'bold' }}>Budget</td><td>: {formatRupiah(project.budget)}</td></tr>
        </tbody>
      </table>

      <h3 style={{ fontWeight: 'bold', marginBottom: '8px' }}>Material</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
        <thead>
          <tr style={{ backgroundColor: '#f3f4f6' }}>
            <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'center', width: '30px' }}>No</th>
            <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'left' }}>Material</th>
            <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'center' }}>Estimasi</th>
            <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'center' }}>Terpakai</th>
            <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'center' }}>Sisa</th>
            <th style={{ border: '1px solid #d1d5db', padding: '6px', textAlign: 'center' }}>Progress</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m, i) => {
            const pct = m.estimatedQty > 0 ? Math.round((m.usedQty || 0) / m.estimatedQty * 100) : 0;
            return (
              <tr key={m.id || i}>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: 'center' }}>{i + 1}</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 6px' }}>{m.product?.name || '-'}</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: 'center' }}>{m.estimatedQty} {m.unit?.name || ''}</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: 'center' }}>{m.usedQty || 0}</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: 'center' }}>{m.estimatedQty - (m.usedQty || 0)}</td>
                <td style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: 'center' }}>{pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p style={{ fontSize: '10px', color: '#888', textAlign: 'right' }}>
        Dicetak pada {formatTanggalWaktu(new Date())}
      </p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────
export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isKasir } = useAuth();
  const printRef = useRef();

  const [updateMaterial, setUpdateMaterial] = useState(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data } = await projectAPI.getById(id);
      return data.data;
    },
  });

  // Proyek selesai / dibatalkan hanya bisa dilihat
  const isEditable = !!project && ![PROJECT_STATUS.COMPLETED, PROJECT_STATUS.CANCELLED].includes(project.status);
  const canEdit = (isAdmin || isKasir) && isEditable;

  const { data: report } = useQuery({
    queryKey: ['project-report', id],
    queryFn: async () => {
      const { data } = await projectAPI.getReport(id);
      return data.data;
    },
    enabled: !!id,
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Laporan-Proyek-${project?.name || ''}`,
  });

  const handleExportPDF = () => {
    if (!project) return;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pw = doc.internal.pageSize.getWidth();
    const mats = project.materials || [];
    const budgetEst = Number(project.budget) || 0;
    const budgetAct = mats.reduce((sum, m) => sum + (parseFloat(m.usedQty) || 0) * (parseFloat(m.unitPrice) || 0), 0);

    // ─── Header Toko ────────────────────────────
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text(STORE_INFO.NAME, pw / 2, 15, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(STORE_INFO.ADDRESS, pw / 2, 21, { align: 'center' });
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(14, 24, pw - 14, 24);

    // ─── Info Proyek (key-value) ────────────────
    let y = 32;
    const labelX = 14;
    const colonX = 50;
    const valueX = 54;
    const lineHeight = 6;

    const infoRows = [
      ['Nama Proyek', project.name],
      ['Status', PROJECT_STATUS_LABELS[project.status]],
      ['Periode', `${formatTanggal(project.startDate)} — ${project.endDate ? formatTanggal(project.endDate) : '-'}`],
      ['Budget', formatRupiah(budgetEst)],
      ['Pengeluaran Aktual', formatRupiah(budgetAct)],
      ['Sisa Budget', formatRupiah(budgetEst - budgetAct)],
    ];

    doc.setFontSize(10);
    infoRows.forEach(([label, value]) => {
      doc.setFont(undefined, 'bold');
      doc.text(label, labelX, y);
      doc.text(':', colonX, y);
      doc.setFont(undefined, 'normal');
      doc.text(value, valueX, y);
      y += lineHeight;
    });

    // ─── Label Material ─────────────────────────
    y += 4;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Material', 14, y);
    y += 4;

    // ─── Tabel Material ─────────────────────────
    const headers = ['No', 'Material', 'Estimasi', 'Terpakai', 'Sisa', 'Harga', 'Sub. Estimasi', 'Sub. Aktual', 'Progress'];
    const rows = mats.map((m, i) => {
      const est = m.estimatedQty || 0;
      const used = m.usedQty || 0;
      const remaining = est - used;
      const price = parseFloat(m.unitPrice) || 0;
      const pct = est > 0 ? Math.round((used / est) * 100) : 0;
      const unitName = m.unit?.name || m.product?.unit || '';
      return [
        i + 1,
        m.product?.name || '-',
        `${est} ${unitName}`,
        `${used} ${unitName}`,
        `${remaining} ${unitName}`,
        formatNumber(price),
        formatNumber(est * price),
        formatNumber(used * price),
        `${pct}%`,
      ];
    });

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: y,
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { halign: 'center' },
        1: { halign: 'left' },
        2: { halign: 'center' },
        3: { halign: 'center' },
        4: { halign: 'center' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
        8: { halign: 'center' },
      },
      styles: { cellPadding: 2, overflow: 'linebreak' },
      margin: { left: 14, right: 14 },
    });

    // ─── Tanggal cetak ──────────────────────────
    const finalY = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    const now = new Date();
    doc.text(
      `Dicetak: ${now.toLocaleDateString('id-ID')} ${now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`,
      pw - 14, finalY, { align: 'right' }
    );

    addPageNumbers(doc);
    doc.save(`laporan-proyek-${project.name.toLowerCase().replace(/\s+/g, '-')}.pdf`);
  };

  if (isLoading) return <Loading text="Memuat detail proyek..." />;
  if (!project) return <p className="text-center text-gray-500 py-12">Proyek tidak ditemukan</p>;

  const materials = project.materials || [];
  const progress = project.summary?.progressPercent || 0;
  const budgetEstimate = Number(project.budget) || 0;
  const budgetActual = materials.reduce((sum, m) => sum + (parseFloat(m.usedQty) || 0) * (parseFloat(m.unitPrice) || 0), 0);
  const budgetPct = budgetEstimate > 0 ? Math.round((budgetActual / budgetEstimate) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/proyek')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Kembali ke daftar proyek">
            <HiArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
              <Badge colorClass={PROJECT_STATUS_COLORS[project.status]} size="sm">
                {PROJECT_STATUS_LABELS[project.status]}
              </Badge>
            </div>
            <p className="text-sm text-gray-500">
              {formatTanggal(project.startDate)} — {project.endDate ? formatTanggal(project.endDate) : 'Belum ditentukan'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={HiDocumentDownload} onClick={handleExportPDF}>
            Cetak PDF
          </Button>
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={handlePrint}>
            Cetak Laporan
          </Button>
          {canEdit && (
            <Button size="sm" icon={HiPencil} onClick={() => navigate(`/proyek/${id}/edit`)}>
              Edit Proyek
            </Button>
          )}
        </div>
      </div>

      {/* Project Info + Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info */}
        <Card title="Informasi Proyek" padding="md" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-y-4 gap-x-6 mb-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <Badge colorClass={PROJECT_STATUS_COLORS[project.status]} size="sm">
                {PROJECT_STATUS_LABELS[project.status]}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Tanggal Mulai</p>
              <p className="text-sm font-medium">{formatTanggalPanjang(project.startDate)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Tanggal Selesai</p>
              <p className="text-sm font-medium">{project.endDate ? formatTanggalPanjang(project.endDate) : '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Dibuat Oleh</p>
              <p className="text-sm font-medium">{project.createdBy?.fullName || '-'}</p>
            </div>
          </div>
          {project.description && (
            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-1">Deskripsi</p>
              <p className="text-sm text-gray-700">{project.description}</p>
            </div>
          )}
        </Card>

        {/* Overall Progress */}
        <Card title="Progress Keseluruhan" padding="md">
          <div className="text-center mb-4">
            <p className="text-4xl font-bold text-gray-900">{progress}%</p>
            <p className="text-xs text-gray-500 mt-1">Material terpenuhi</p>
          </div>
          <ProgressBar value={progress} height="h-3" />

          <div className="mt-6 space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Budget</span>
                <span className="font-medium">{budgetPct}%</span>
              </div>
              <ProgressBar value={budgetPct} />
            </div>
            <div className="pt-3 border-t border-gray-100 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Estimasi</span>
                <span className="font-medium">{formatRupiah(budgetEstimate)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Aktual</span>
                <span className="font-medium">{formatRupiah(budgetActual)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Sisa</span>
                <span className={`font-bold ${budgetEstimate - budgetActual < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatRupiah(budgetEstimate - budgetActual)}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Material Table */}
      <Card title={`Material (${materials.length})`} padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 w-8">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 min-w-[180px]">Material</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 w-24">Estimasi</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 w-24">Terpakai</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 w-24">Sisa</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 min-w-[140px]">Progress</th>
                {canEdit && <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 w-20">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {materials.map((mat, idx) => {
                const used = mat.usedQty || 0;
                const estimated = mat.estimatedQty || 0;
                const remaining = estimated - used;
                const pct = estimated > 0 ? Math.round((used / estimated) * 100) : 0;
                const unitName = mat.unit?.name || mat.product?.unit || '';

                return (
                  <tr key={mat.id || idx} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{mat.product?.name || '-'}</p>
                      {mat.variant && <p className="text-xs text-gray-500">{mat.variant.name}</p>}
                      {mat.notes && <p className="text-xs text-gray-400 mt-0.5">{mat.notes}</p>}
                    </td>
                    <td className="text-center px-4 py-3 text-gray-700">
                      {estimated} {unitName}
                    </td>
                    <td className="text-center px-4 py-3 font-medium text-gray-900">
                      {used} {unitName}
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className={remaining < 0 ? 'text-red-600 font-medium' : remaining === 0 && estimated > 0 ? 'text-green-600 font-medium' : 'text-gray-700'}>
                        {remaining} {unitName}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={pct} className="flex-1" />
                        <span className="text-xs font-medium text-gray-600 w-10 text-right">{pct}%</span>
                      </div>
                    </td>
                    {canEdit && (
                      <td className="text-center px-4 py-3">
                        <button
                          onClick={() => setUpdateMaterial(mat)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                        >
                          Update
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {materials.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-4 py-8 text-center text-gray-400 text-sm">
                    Belum ada material
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Budget Summary */}
      <Card title="Ringkasan Budget" padding="md">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-blue-50 rounded-lg p-4 text-center">
            <p className="text-xs text-blue-600 font-medium mb-1">Estimasi Budget</p>
            <p className="text-lg font-bold text-blue-700">{formatRupiah(budgetEstimate)}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <p className="text-xs text-green-600 font-medium mb-1">Pengeluaran Aktual</p>
            <p className="text-lg font-bold text-green-700">{formatRupiah(budgetActual)}</p>
          </div>
          <div className={`rounded-lg p-4 text-center ${budgetEstimate - budgetActual < 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
            <p className={`text-xs font-medium mb-1 ${budgetEstimate - budgetActual < 0 ? 'text-red-600' : 'text-gray-600'}`}>
              Sisa Budget
            </p>
            <p className={`text-lg font-bold ${budgetEstimate - budgetActual < 0 ? 'text-red-700' : 'text-gray-700'}`}>
              {formatRupiah(budgetEstimate - budgetActual)}
            </p>
          </div>
        </div>
      </Card>

      {/* Timeline / History */}
      {(report?.history || project.auditLogs)?.length > 0 && (
        <Card title="Riwayat Perubahan" padding="md">
          <div className="space-y-3">
            {(report?.history || project.auditLogs || []).slice(0, 10).map((entry, idx) => (
              <div key={idx} className="flex gap-3 items-start">
                <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm text-gray-700">{entry.action || entry.description || 'Perubahan data'}</p>
                  <p className="text-xs text-gray-400">
                    {formatTanggalWaktu(entry.createdAt)} — {entry.user?.fullName || '-'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Update Material Usage Modal */}
      {canEdit && updateMaterial && (
        <UpdateUsageModal
          material={updateMaterial}
          projectId={id}
          onClose={() => setUpdateMaterial(null)}
        />
      )}

      {/* Hidden Print Content */}
      <div className="hidden">
        <ProjectReportPrint project={project} report={report} printRef={printRef} />
      </div>
    </div>
  );
}
