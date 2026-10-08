// Intercity travel (server-authoritative fare + placement). Pure check; game.ts applies the debit + teleport.
import { TRAVEL, TRAVEL_DESK_RADIUS, cityAt, dist, type City, type TravelMode, type Vec2 } from '../../shared/constants.js';
export type TravelCheck = { ok: true; mode: TravelMode; from: City; to: City; price: number } | { ok: false; error: string };
export function travelCheck(mode: unknown, pos: Vec2, onFoot: boolean, wanted: number, balance: number): TravelCheck {
  if (mode !== 'bus' && mode !== 'flight') return { ok: false, error: 'Unknown ticket' };
  const t = TRAVEL[mode]; const from = cityAt(pos.x, pos.z); const to: City = from === 'benin' ? 'lagos' : 'benin';
  if (!onFoot || dist(pos, t.desk[from]) > TRAVEL_DESK_RADIUS) return { ok: false, error: `Buy ${mode === 'bus' ? 'bus' : 'flight'} tickets at ${t.place[from]}` };
  if (mode === 'flight' && wanted > 0) return { ok: false, error: 'Airport security turned you back — you are wanted by the police' };
  if (balance < t.price) return { ok: false, error: 'Not enough money' };
  return { ok: true, mode, from, to, price: t.price };
}
