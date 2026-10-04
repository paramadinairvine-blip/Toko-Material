const logger = require('../utils/logger');
const prisma = require('../lib/prisma');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED === 'true';

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Escape karakter khusus HTML (parse_mode HTML) untuk data dari pengguna.
 */
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/**
 * Send a message to Telegram using the Bot API.
 */
const sendMessage = async (text) => {
  if (!TELEGRAM_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    logger.info('Telegram notification skipped (disabled or not configured)');
    return null;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });

    const data = await res.json();

    if (!data.ok) {
      logger.error('Telegram API error:', data.description);
      return null;
    }

    logger.info('Telegram notification sent successfully');
    return data;
  } catch (error) {
    logger.error('Failed to send Telegram notification:', error.message);
    return null;
  }
};

/**
 * Format and send transaction notification to Telegram.
 */
const sendTransactionNotification = async (transaction) => {
  const formatCurrency = (val) =>
    `Rp ${Number(val).toLocaleString('id-ID')}`;

  const typeLabel = transaction.type === 'CASH' ? '💵 CASH' : '📝 Overbooking TU';
  const date = new Date(transaction.createdAt).toLocaleString('id-ID', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  });

  // Build item list
  const itemLines = (transaction.items || []).map((item, i) => {
    const name = escapeHtml(item.product?.name || 'Produk');
    const unitName = escapeHtml(item.unit?.abbreviation || item.product?.unitOfMeasure?.abbreviation || 'pcs');
    const qty = item.quantity;
    const price = formatCurrency(item.price);
    const subtotal = formatCurrency(item.subtotal);
    return `  ${i + 1}. ${name}\n     ${qty} ${unitName} x ${price} = ${subtotal}`;
  }).join('\n');

  let text = `🧾 <b>TRANSAKSI BARU</b>\n`;
  text += `━━━━━━━━━━━━━━━━━━\n`;
  text += `📋 No: <b>${escapeHtml(transaction.transactionNumber)}</b>\n`;
  text += `📅 ${date}\n`;
  text += `💳 Tipe: ${typeLabel}\n`;
  text += `👤 Kasir: ${escapeHtml(transaction.creator?.fullName || '-')}\n`;

  if (transaction.customerName) {
    text += `🧑 Pelanggan: ${escapeHtml(transaction.customerName)}\n`;
  }

  if (transaction.unitLembaga) {
    text += `🏢 Unit: ${escapeHtml(transaction.unitLembaga.name)}\n`;
  }

  if (transaction.project) {
    text += `📁 Proyek: ${escapeHtml(transaction.project.name)}\n`;
  }

  text += `\n📦 <b>ITEM:</b>\n${itemLines}\n`;
  text += `━━━━━━━━━━━━━━━━━━\n`;
  text += `   Subtotal: ${formatCurrency(transaction.subtotal)}\n`;

  if (Number(transaction.discount) > 0) {
    text += `   Diskon: -${formatCurrency(transaction.discount)}\n`;
  }
  if (Number(transaction.tax) > 0) {
    text += `   Pajak: +${formatCurrency(transaction.tax)}\n`;
  }

  text += `   <b>TOTAL: ${formatCurrency(transaction.total)}</b>\n`;

  if (transaction.type === 'CASH' && Number(transaction.paidAmount) > 0) {
    text += `   Bayar: ${formatCurrency(transaction.paidAmount)}\n`;
    text += `   Kembalian: ${formatCurrency(transaction.changeAmount)}\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━`;

  return sendMessage(text);
};

/**
 * Send daily revenue report to Telegram.
 * Summarizes today's transactions: count, total revenue, cash vs bon breakdown.
 */
const sendDailyReport = async () => {
  const formatCurrency = (val) =>
    `Rp ${Number(val).toLocaleString('id-ID')}`;

  // Get today's date range in WIB (Asia/Jakarta, UTC+7)
  const now = new Date();
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD
  const startOfDay = new Date(`${todayStr}T00:00:00+07:00`);
  const endOfDay = new Date(`${todayStr}T23:59:59.999+07:00`);

  const dateLabel = new Date(startOfDay).toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

  try {
    // Fetch today's completed transactions
    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: { gte: startOfDay, lte: endOfDay },
        status: 'COMPLETED',
      },
      include: {
        creator: { select: { fullName: true } },
      },
    });

    // Fetch today's returns (abaikan retur dari transaksi yang dibatalkan)
    const returns = await prisma.transactionReturn.findMany({
      where: {
        createdAt: { gte: startOfDay, lte: endOfDay },
        transaction: { status: { not: 'CANCELLED' } },
      },
    });

    const totalCount = transactions.length;
    const cashTrx = transactions.filter((t) => t.type === 'CASH');
    const bonTrx = transactions.filter((t) => t.type === 'BON');

    const totalRevenue = transactions.reduce((sum, t) => sum + Number(t.total), 0);
    const cashRevenue = cashTrx.reduce((sum, t) => sum + Number(t.total), 0);
    const bonRevenue = bonTrx.reduce((sum, t) => sum + Number(t.total), 0);
    const totalDiscount = transactions.reduce((sum, t) => sum + Number(t.discount || 0), 0);

    const totalReturnCount = returns.length;
    const totalRefund = returns.reduce((sum, r) => sum + Number(r.refundAmount), 0);
    const netRevenue = totalRevenue - totalRefund;

    // Group by kasir
    const kasirMap = {};
    for (const t of transactions) {
      const name = t.creator?.fullName || 'Unknown';
      if (!kasirMap[name]) kasirMap[name] = { count: 0, total: 0 };
      kasirMap[name].count += 1;
      kasirMap[name].total += Number(t.total);
    }

    let text = `📊 <b>LAPORAN HARIAN</b>\n`;
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `📅 ${dateLabel}\n\n`;

    if (totalCount === 0 && totalReturnCount === 0) {
      text += `📭 Tidak ada transaksi hari ini.\n`;
    } else {
      text += `📈 <b>RINGKASAN:</b>\n`;
      text += `   Total Transaksi: <b>${totalCount}</b>\n`;
      text += `   💵 Cash: ${cashTrx.length} transaksi — ${formatCurrency(cashRevenue)}\n`;
      text += `   📝 Overbooking TU: ${bonTrx.length} transaksi — ${formatCurrency(bonRevenue)}\n`;

      if (totalDiscount > 0) {
        text += `   🏷️ Total Diskon: ${formatCurrency(totalDiscount)}\n`;
      }

      text += `\n💰 <b>TOTAL PENDAPATAN: ${formatCurrency(totalRevenue)}</b>\n`;

      // Retur section
      text += `\n🔄 <b>RETUR:</b>\n`;
      if (totalReturnCount > 0) {
        text += `   Total Retur: <b>${totalReturnCount}</b>\n`;
        text += `   Total Refund: ${formatCurrency(totalRefund)}\n`;
      } else {
        text += `   Tidak ada retur hari ini\n`;
      }

      // Net revenue
      text += `\n💎 <b>PENDAPATAN BERSIH: ${formatCurrency(netRevenue)}</b>\n`;

      // Kasir breakdown
      const kasirNames = Object.keys(kasirMap);
      if (kasirNames.length > 0) {
        text += `\n👥 <b>PER KASIR:</b>\n`;
        for (const name of kasirNames) {
          const k = kasirMap[name];
          text += `   • ${escapeHtml(name)}: ${k.count} trx — ${formatCurrency(k.total)}\n`;
        }
      }
    }

    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `🏪 Toko Material Darunnajah`;

    return sendMessage(text);
  } catch (error) {
    logger.error('Failed to generate daily report:', error.message);
    return null;
  }
};

module.exports = {
  sendMessage,
  sendTransactionNotification,
  sendDailyReport,
  escapeHtml,
};
