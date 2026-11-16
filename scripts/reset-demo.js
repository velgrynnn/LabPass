import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { resetDemo } from '../lib/reset-demo.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  if (process.env.LABPASS_DATA_DIR && path.resolve(process.env.LABPASS_DATA_DIR) !== path.join(projectRoot, 'data')) {
    throw new Error('Reset ini hanya untuk folder data bawaan. Hapus pengaturan LABPASS_DATA_DIR sebelum mencoba.');
  }
  console.log('Hentikan server LabPass dengan Ctrl+C sebelum melanjutkan.');
  console.log('Reset memindahkan seluruh database, foto, arsip, chain, dan kunci lokal ke folder backups.');
  const answer = await prompt.question('Ketik RESET untuk memulai demo baru, atau Enter untuk batal: ');
  if (answer.trim() !== 'RESET') {
    console.log('Reset dibatalkan.');
  } else {
    const result = await resetDemo(projectRoot, Number(process.env.PORT || 8787));
    console.log(result.backupPath ? 'Cadangan tersimpan di ' + result.backupPath : 'Belum ada data demo.');
    console.log('Jalankan Mulai-LabPass.cmd, lalu muat ulang browser dan masuk kembali.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { prompt.close(); }
