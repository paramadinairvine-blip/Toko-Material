process.env.TELEGRAM_ENABLED = 'true';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_ID = '12345';

const { mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const telegram = require('../src/services/telegram.service');

let sentBodies;

beforeEach(() => {
  resetMocks();
  sentBodies = [];
  global.fetch = jest.fn(async (_url, opts) => {
    sentBodies.push(JSON.parse(opts.body));
    return { json: async () => ({ ok: true }) };
  });
});

afterAll(() => {
  delete global.fetch;
});

describe('Telegram — escape HTML', () => {
  test('nama produk/pelanggan/kasir di-escape', async () => {
    await telegram.sendTransactionNotification({
      transactionNumber: 'TRX-1',
      type: 'CASH',
      createdAt: new Date(),
      customerName: 'Budi <b>&</b>',
      creator: { fullName: 'Kasir <script>' },
      unitLembaga: { name: 'Unit <A>' },
      project: { name: 'Proyek & Co' },
      items: [{ product: { name: 'Paku <5cm>' }, quantity: 1, price: 100, subtotal: 100 }],
      subtotal: 100, discount: 0, tax: 0, total: 100, paidAmount: 0,
    });

    const { text, parse_mode: parseMode } = sentBodies[0];
    expect(parseMode).toBe('HTML');
    expect(text).toContain('Budi &lt;b&gt;&amp;&lt;/b&gt;');
    expect(text).toContain('Kasir &lt;script&gt;');
    expect(text).toContain('Unit &lt;A&gt;');
    expect(text).toContain('Proyek &amp; Co');
    expect(text).toContain('Paku &lt;5cm&gt;');
    expect(text).not.toContain('<script>');
  });

  test('nama kasir di laporan harian di-escape', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      { type: 'CASH', total: 1000, discount: 0, creator: { fullName: 'Ani <i>' } },
    ]);
    mockPrisma.transactionReturn.findMany.mockResolvedValue([]);

    await telegram.sendDailyReport();

    expect(sentBodies[0].text).toContain('Ani &lt;i&gt;');
  });
});

describe('Telegram — laporan harian', () => {
  test('retur dari transaksi CANCELLED tidak dihitung', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockPrisma.transactionReturn.findMany.mockResolvedValue([]);

    await telegram.sendDailyReport();

    const where = mockPrisma.transactionReturn.findMany.mock.calls[0][0].where;
    expect(where.transaction).toEqual({ status: { not: 'CANCELLED' } });
  });
});
