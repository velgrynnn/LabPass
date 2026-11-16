import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function acquireStoreLock(dataDirectory) {
  const lockPath = path.resolve(dataDirectory) + '.lock';
  const token = randomUUID();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = fs.readFileSync(lockPath, 'utf8');
      let owner;
      try { owner = JSON.parse(previous); } catch {
        throw new Error('File kunci data tidak dapat dibaca. Hentikan LabPass dan periksa file data.lock.');
      }
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('File kunci data tidak valid.');
      try {
        process.kill(owner.pid, 0);
        throw new Error('Data LabPass sedang digunakan. Hentikan server dengan Ctrl+C terlebih dahulu.');
      } catch (probeError) {
        if (probeError.code !== 'ESRCH') throw probeError;
      }
      if (fs.readFileSync(lockPath, 'utf8') === previous) fs.unlinkSync(lockPath);
      continue;
    }
    try {
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
    } finally { fs.closeSync(descriptor); }
    return () => {
      try {
        const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (owner.token === token) fs.unlinkSync(lockPath);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Kunci data belum dapat dilepas:', error.message);
      }
    };
  }
  throw new Error('Data LabPass sedang dikunci proses lain. Coba lagi setelah server berhenti.');
}
