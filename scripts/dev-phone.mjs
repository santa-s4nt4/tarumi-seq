import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { phoneAddress } from './phone-network.mjs';

const ip = phoneAddress();
if (!ip) throw new Error('同じWi-Fiに接続してから起動してください。');
process.umask(0o077);
const dir = join(homedir(), '.local', 'share', 'tarumi-phone', ip);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const openssl = args => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
const usable = () => {
  try { openssl(['x509', '-in', 'server.crt', '-checkend', '86400', '-noout']); return existsSync(join(dir, 'server.key')); }
  catch { return false; }
};
if (!usable()) {
  writeFileSync(join(dir, 'cert.conf'), `[req]
distinguished_name=dn
[dn]
[ca]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
[server]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost
`);
  try {
    openssl(['req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '90', '-sha256', '-subj', '/CN=Tarumi GPS Local CA',
      '-config', 'cert.conf', '-extensions', 'ca', '-keyout', 'ca.key', '-out', 'tarumi-phone-ca.crt']);
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=' + ip, '-keyout', 'server.key', '-out', 'server.csr']);
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'tarumi-phone-ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '89',
      '-sha256', '-extfile', 'cert.conf', '-extensions', 'server', '-out', 'server.crt']);
    chmodSync(join(dir, 'tarumi-phone-ca.crt'), 0o644);
  } finally { rmSync(join(dir, 'ca.key'), { force: true }); }
}
const server = await createServer({ server: { host: '0.0.0.0', port: 5174, strictPort: true,
  https: { key: readFileSync(join(dir, 'server.key')), cert: readFileSync(join(dir, 'server.crt')) } } });
await server.listen();
console.log('スマホ用HTTPS  https://' + ip + ':5174/performance/');
console.log('スマホで信頼するローカルCA証明書  ' + join(dir, 'tarumi-phone-ca.crt'));
