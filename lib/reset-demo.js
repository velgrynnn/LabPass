import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { acquireStoreLock } from './store-lock.js';

async function portInUse(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(new Error('Belum bisa memastikan server berhenti: ' + error.message));
    });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Pemeriksaan server kehabisan waktu.')); });
  });
}

export async function resetDemo(projectDirectory, port = 8787) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port LabPass tidak valid.');
  const projectRoot = fs.realpathSync(projectDirectory);
  const dataDirectory = path.join(projectRoot, 'data');
  const backupsDirectory = path.join(projectRoot, 'backups');
  if (path.dirname(dataDirectory) !== projectRoot || path.dirname(backupsDirectory) !== projectRoot) {
    throw new Error('Target reset berada di luar folder LabPass.');
  }
  for (const directory of [dataDirectory, backupsDirectory]) {
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error('Reset menolak folder data atau backups yang berupa tautan.');
    }
  }
  const release = acquireStoreLock(dataDirectory);
  try {
    if (await portInUse(port)) throw new Error('Port LabPass masih aktif. Hentikan server dengan Ctrl+C terlebih dahulu.');
    if (!fs.existsSync(dataDirectory)) return { backupPath: null };
    fs.mkdirSync(backupsDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupsDirectory, 'data-' + stamp);
    if (path.dirname(backupPath) !== backupsDirectory) throw new Error('Target cadangan tidak valid.');
    fs.renameSync(dataDirectory, backupPath);
    return { backupPath };
  } finally { release(); }
}
