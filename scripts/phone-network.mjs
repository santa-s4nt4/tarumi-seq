import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';

export function phoneAddress() {
  const interfaces = networkInterfaces();
  const candidates = [interfaces.en0, interfaces.en1, ...Object.values(interfaces)].flat().filter(Boolean);
  const address = process.env.TARUMI_PHONE_IP || candidates.find(i => i.family === 'IPv4' && !i.internal)?.address;
  if (address && !isIPv4(address)) throw new Error('TARUMI_PHONE_IP must be an IPv4 LAN address');
  return address;
}
