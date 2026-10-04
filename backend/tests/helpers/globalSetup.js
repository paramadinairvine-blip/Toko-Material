// Jalankan test dengan zona waktu server UTC (sama seperti Railway), supaya
// logika batas hari/bulan WIB teruji walau mesin developer memakai WIB.
module.exports = async () => {
  process.env.TZ = 'UTC';
};
