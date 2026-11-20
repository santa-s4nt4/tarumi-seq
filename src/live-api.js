import { DEFAULT_ENDPOINT, requestEndpoint } from './api.js';

const root = new URL(requestEndpoint(DEFAULT_ENDPOINT), location.origin);
export async function liveRequest(resource, { method = 'GET', token, body, signal, keepalive } = {}) {
  const url = new URL(resource, root);
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, body: body && JSON.stringify(body),
    cache: 'no-store', signal: signal ?? AbortSignal.timeout(10000), keepalive });
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return method === 'HEAD' ? null : response.json();
}
