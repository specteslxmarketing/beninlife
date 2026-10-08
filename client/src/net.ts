import { io, type Socket } from 'socket.io-client';
export function connect(): Socket {
  return io({ withCredentials: true, transports: ['websocket', 'polling'] });
}
export function emitAck<T = Record<string, unknown>>(s: Socket, ev: string, payload: unknown = null): Promise<T> {
  return new Promise((resolve) => s.timeout(20000).emit(ev, payload, (err: unknown, res: T) => resolve(err ? ({ ok: false, error: 'timeout' } as T) : res)));
}
export const naira = (n: number) => '₦' + Math.round(n).toLocaleString('en-NG');
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
