// Shared game constants and world layout used by BOTH client and server.
// The server uses the zones for authoritative validation; the client uses them for rendering.

export const DAY_LENGTH_MS = 12 * 60 * 1000; // one in-game day = 12 real minutes
export const DAY_OFFSET_HOURS = 7; // shifts epoch so cycle phase is deterministic

/** In-game hour of day (0..24) for a given real timestamp. Same on every client & server. */
export function gameHourAt(nowMs: number): number {
  const h = (nowMs / DAY_LENGTH_MS) * 24 + DAY_OFFSET_HOURS;
  return ((h % 24) + 24) % 24;
}

export const START_BALANCE = 5000;
export const ADMIN_BALANCE = 5_000_000_000;
export const ADMIN_USERNAME = 'bestx';
export const ADMIN_DISPLAY = 'BEST 𝕏';

export const DELIVERY_PAY = 1500;
export const CARWASH_PRICE = 500;
export const PICKUP_RADIUS = 8; // generous enough to pull up at the kerb in a car
export const DROPOFF_RADIUS = 8;
export const CAR_ENTER_RADIUS = 5;
export const MAX_SPEED_FOOT = 9; // m/s (sprint)
export const MAX_SPEED_CAR = 42; // m/s (~150 km/h)
export const WORLD_HALF = 185;
/** metres of driving to go from spotless (0) to fully dirty (1) */
export const DIRT_PER_METRE = 1 / 1500;

/** Minimum seconds a delivery may take, given straight-line distance. */
export function minDeliverySeconds(distance: number): number {
  return Math.max(12, distance / 30);
}

export interface Vec2 { x: number; z: number }
export interface Zone { x: number; z: number; w: number; d: number } // centre + size (AABB)

export const SPAWN: Vec2 & { rot: number } = { x: -44, z: 10.5, rot: 0 };

/** Parking slots near spawn; each player's car is assigned slot = userId % length */
export const PARKING_SLOTS: (Vec2 & { rot: number })[] = [
  { x: -40, z: 19, rot: Math.PI }, { x: -44, z: 19, rot: Math.PI }, { x: -48, z: 19, rot: Math.PI },
  { x: -52, z: 19, rot: Math.PI }, { x: -56, z: 19, rot: Math.PI }, { x: -60, z: 19, rot: Math.PI },
  { x: -64, z: 19, rot: Math.PI }, { x: -40, z: 31, rot: 0 }, { x: -44, z: 31, rot: 0 }, { x: -48, z: 31, rot: 0 },
  { x: -52, z: 31, rot: 0 }, { x: -56, z: 31, rot: 0 }, { x: -60, z: 31, rot: 0 }, { x: -64, z: 31, rot: 0 },
];

export const MARKET_PICKUP: Vec2 = { x: 10, z: 58 };

export const DROPOFFS: (Vec2 & { name: string })[] = [
  { name: 'Edo Heritage Bank', x: 10, z: -45 },
  { name: 'Grace Assembly Church', x: 10, z: -104 },
  { name: 'Central Mosque', x: -10, z: -105 },
  { name: 'Osas Provisions', x: -46, z: -10 },
  { name: 'Uyi Fashion House', x: 44, z: -10 },
  { name: 'Mama Efe Kitchen', x: -10, z: 44 },
  { name: 'Uwelu Apartments', x: -10, z: 120 },
  { name: 'Sapele Rd Plaza', x: 128, z: -10 },
];

/** Drive-through car wash bay (car must be inside to buy a wash). */
export const CARWASH_ZONE: Zone = { x: 47, z: 21, w: 9, d: 14 };

export function inZone(p: Vec2, z: Zone): boolean {
  return Math.abs(p.x - z.x) <= z.w / 2 && Math.abs(p.z - z.z) <= z.d / 2;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export const SKIN_TONES = ['#3b2219', '#4a2c20', '#5c3826', '#6e4430', '#82543a', '#9a6a4a'];
export const OUTFIT_COLORS = ['#7a1f1f', '#1f3a5f', '#2f4f2f', '#c9b48a', '#202020', '#e8e4da', '#6b4a8a', '#b5651d'];

export interface Appearance {
  body: 'male' | 'female';
  skin: number; // index into SKIN_TONES
  outfit: number; // index into OUTFIT_COLORS
}

export function validAppearance(a: unknown): a is Appearance {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return (o.body === 'male' || o.body === 'female') &&
    Number.isInteger(o.skin) && (o.skin as number) >= 0 && (o.skin as number) < SKIN_TONES.length &&
    Number.isInteger(o.outfit) && (o.outfit as number) >= 0 && (o.outfit as number) < OUTFIT_COLORS.length;
}

export interface PlayerSnapshot {
  id: number; name: string; admin: boolean;
  x: number; z: number; rot: number; moving: number;
  inCar: boolean; carX: number; carZ: number; carRot: number;
  dirt: number; app: Appearance | null;
  carModel?: string; carColor?: string;
  style?: string; wanted?: number;
  /** riding as a passenger: driver id + seat (1 front passenger, 2 rear left, 3 rear right) */
  ride?: { driver: number; seat: number };
  /** proximity voice chat enabled */
  voice?: boolean;
  /** combat: health when hurt, knocked down, weapon in hand, wearing armour, gang badge */
  hp?: number; down?: boolean; wpn?: 'pistol' | 'smg' | 'shotgun'; arm?: number;
  gang?: { id: number; tag: string; color: string; emblem: string };
}

export interface StateUpdate {
  x: number; z: number; rot: number; moving: number;
  inCar: boolean; carX: number; carZ: number; carRot: number;
}

// ---------------- HOUSES (phase 2) ----------------
export type HouseKind = 'flat' | 'bungalow' | 'duplex' | 'mansion';
export interface HouseDef {
  id: string; kind: HouseKind; name: string; price: number;
  /** exterior: lot centre and the door/approach point players stand at (outside) */
  lot: { x: number; z: number; w: number; d: number }; door: { x: number; z: number };
  /** interior: origin of the interior room block (far outside the city, separate area) and the size */
  interior: { x: number; z: number; w: number; d: number };
  forSale: boolean;
}
// Interiors live in a separate area at z ≈ 600+ so they never overlap the city; each house has its own block.
export const HOUSES: HouseDef[] = [
  { id: 'flat1', kind: 'flat', name: 'Uselu Mini Flat', price: 4_500_000, lot: { x: -165, z: 24, w: 12, d: 12 }, door: { x: -165, z: 15.2 }, interior: { x: -120, z: 620, w: 12, d: 10 }, forSale: true },
  { id: 'bung1', kind: 'bungalow', name: 'GRA Bungalow', price: 18_000_000, lot: { x: -80, z: 25, w: 15, d: 13 }, door: { x: -80, z: 15.2 }, interior: { x: -60, z: 620, w: 16, d: 12 }, forSale: true },
  { id: 'dup1', kind: 'duplex', name: 'Ugbowo Duplex', price: 45_000_000, lot: { x: -120, z: 25, w: 16, d: 14 }, door: { x: -120, z: 15.2 }, interior: { x: 0, z: 620, w: 20, d: 14 }, forSale: true },
  { id: 'mansion', kind: 'mansion', name: 'BEST 𝕏 Mansion', price: 0, lot: { x: 117, z: 37, w: 50, d: 46 }, door: { x: 117, z: 11.5 }, interior: { x: 90, z: 640, w: 44, d: 30 }, forSale: false },
];
export const HOUSE_DOOR_RADIUS = 4;
export const houseById = (id: string) => HOUSES.find((h) => h.id === id);
/** Interior spawn just inside the entrance (front wall is at interior.z - d/2). */
export const interiorSpawn = (h: HouseDef) => ({ x: h.interior.x, z: h.interior.z - h.interior.d / 2 + 1.6, rot: 0 });
/** Exit point inside (next to the entrance door). */
export const interiorExit = (h: HouseDef) => ({ x: h.interior.x, z: h.interior.z - h.interior.d / 2 + 0.6 });
export function houseAt(x: number, z: number): HouseDef | undefined {
  // mansion interior includes a pool terrace and garage beyond the walls
  return HOUSES.find((h) => Math.abs(x - h.interior.x) <= h.interior.w / 2 + (h.kind === 'mansion' ? 14 : 0.5) && z >= h.interior.z - h.interior.d / 2 - 0.5 && z <= h.interior.z + h.interior.d / 2 + (h.kind === 'mansion' ? 16 : 0.5));
}
// ---------------- BENIN AIRPORT (phase 2) ----------------
/** Landside airport area north of the city (terminal + forecourt). Airside (apron/runway) is fenced off. */
export const AIRPORT = {
  /** walkable landside rectangle: forecourt + terminal hall */
  zone: { x: 0, z: -213, w: 80, d: 58 } as Zone,
  terminal: { x: 0, z: -229, w: 72, d: 24 } as Zone,
  /** where a new arrival appears after walking off the plane (arrivals hall, by the gate door) */
  arrival: { x: -10, z: -236.5, rot: 0 },
  name: 'Benin Airport',
};
export function inAirport(x: number, z: number): boolean {
  const a = AIRPORT.zone; return Math.abs(x - a.x) <= a.w / 2 && Math.abs(z - a.z) <= a.d / 2;
}
export function inPlayableArea(x: number, z: number): boolean {
  return (Math.abs(x) <= WORLD_HALF + 1 && Math.abs(z) <= WORLD_HALF + 1) || !!houseAt(x, z) || inAirport(x, z) || inLagos(x, z);
}

// ---------------- WEATHER (phase 2) ----------------
export type WeatherKind = 'sunny' | 'cloudy' | 'light_rain' | 'heavy_rain' | 'storm';
export const WEATHER_KINDS: WeatherKind[] = ['sunny', 'cloudy', 'light_rain', 'heavy_rain', 'storm'];
export const WEATHER_LABEL: Record<WeatherKind, string> = { sunny: '☀ Sunny', cloudy: '☁ Cloudy', light_rain: '🌦 Light rain', heavy_rain: '🌧 Heavy rain', storm: '⛈ Thunderstorm' };
export const WEATHER_SLOT_MS = 6 * 60_000;
/** Deterministic weather for a real-time slot (all clients/servers agree). Benin City: lots of sun, frequent showers. */
export function weatherAt(t: number): WeatherKind {
  const slot = Math.floor(t / WEATHER_SLOT_MS);
  let h = (slot * 2654435761) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  const r = (h % 1000) / 1000;
  return r < 0.4 ? 'sunny' : r < 0.65 ? 'cloudy' : r < 0.83 ? 'light_rain' : r < 0.93 ? 'heavy_rain' : 'storm';
}
export const WEATHER_PARAMS: Record<WeatherKind, { overcast: number; rain: number; wet: number; lightning: boolean }> = {
  sunny: { overcast: 0, rain: 0, wet: 0, lightning: false },
  cloudy: { overcast: 0.55, rain: 0, wet: 0, lightning: false },
  light_rain: { overcast: 0.7, rain: 0.35, wet: 0.6, lightning: false },
  heavy_rain: { overcast: 0.88, rain: 0.85, wet: 1, lightning: false },
  storm: { overcast: 1, rain: 1, wet: 1, lightning: true },
};

// ---------------- VEHICLES / CAR STANDS (phase 2) ----------------
export type BodyType = 'sedan' | 'suv' | 'minivan' | 'pickup' | 'bus' | 'compact' | 'keke' | 'okada';
export interface CarModel { id: string; name: string; body: BodyType; price: number; colors: string[]; scale?: number; seats: number }
/** "-style" names: generic procedural bodies inspired by cars common in Nigeria. No manufacturer logos. Prices are game estimates (₦). */
export const CAR_MODELS: CarModel[] = [
  { id: 'rio', name: 'Kia Rio-style hatch', body: 'compact', price: 7_500_000, colors: ['#b3121b', '#e9e9e4', '#2b2f36'], seats: 5 },
  { id: 'camry_muscle', name: 'Camry "Muscle"-style (2005)', body: 'sedan', price: 9_500_000, colors: ['#1d1f24', '#8a8f96', '#e9e9e4'], seats: 5 },
  { id: 'elantra', name: 'Elantra-style sedan', body: 'sedan', price: 11_000_000, colors: ['#e9e9e4', '#1c3a6b', '#5b6770'], seats: 5 },
  { id: 'camry_bigdaddy', name: 'Camry "Big Daddy"-style (2008)', body: 'sedan', price: 12_000_000, colors: ['#121316', '#6d1a1a', '#c9ccd1'], scale: 1.04, seats: 5 },
  { id: 'corolla', name: 'Corolla-style sedan', body: 'sedan', price: 13_000_000, colors: ['#c9ccd1', '#121316', '#7a1d1d'], scale: 0.98, seats: 5 },
  { id: 'accord', name: 'Accord-style sedan', body: 'sedan', price: 14_000_000, colors: ['#2a2a2c', '#e9e9e4', '#4a5568'], scale: 1.02, seats: 5 },
  { id: 'sienna', name: 'Sienna-style minivan', body: 'minivan', price: 16_000_000, colors: ['#c9ccd1', '#2f3a46', '#e9e9e4'], seats: 7 },
  { id: 'glk', name: 'GLK 350-style SUV', body: 'suv', price: 18_000_000, colors: ['#e9e9e4', '#0e0f11', '#8a8f96'], scale: 0.96, seats: 5 },
  { id: 'es350', name: 'ES 350-style luxury sedan', body: 'sedan', price: 22_000_000, colors: ['#e9e9e4', '#0e0f11', '#6b5a43'], scale: 1.05, seats: 5 },
  { id: 'c300', name: 'C300-style sport sedan', body: 'sedan', price: 26_000_000, colors: ['#0e0f11', '#c9ccd1', '#1c3a6b'], seats: 5 },
  { id: 'highlander', name: 'Highlander-style SUV', body: 'suv', price: 28_000_000, colors: ['#2b2f36', '#e9e9e4', '#6d1a1a'], scale: 1.04, seats: 7 },
  { id: 'hiace', name: 'HiAce-style bus', body: 'bus', price: 30_000_000, colors: ['#e9e9e4', '#f2c230', '#1d4ed8'], seats: 14 },
  { id: 'rx350', name: 'RX 350-style SUV', body: 'suv', price: 32_000_000, colors: ['#e9e9e4', '#0e0f11', '#7a7f86'], seats: 5 },
  { id: 'hilux', name: 'Hilux-style pickup', body: 'pickup', price: 35_000_000, colors: ['#e9e9e4', '#121316', '#8a8f96'], seats: 5 },
];
export const STARTER_MODEL: CarModel = { id: 'starter', name: 'Used Corolla-style (starter)', body: 'sedan', price: 0, colors: ['#5b6770'], scale: 0.98, seats: 5 };
export const carModel = (id: string | null | undefined): CarModel => CAR_MODELS.find((m) => m.id === id) ?? STARTER_MODEL;
/** BEST 𝕏 Car Stands lot (east side of the South road) and display slots (one per model). */
export const CAR_STANDS = { x: 28.5, z: 91, w: 31, d: 20, office: { x: 41, z: 91 } };
export const DISPLAY_SLOTS = CAR_MODELS.map((m, i) => ({ model: m.id, x: 16.5 + (i % 7) * 3.4, z: i < 7 ? 86 : 96.5, rot: i < 7 ? Math.PI / 2 * 0 + Math.PI : 0 }));
export const DEALER_RADIUS = 3.6;

// ---------------- JOBS (phase 2): taxi + station jobs (car-wash attendant, mechanic) ----------------
export const TAXI_BASE = 500;
export const TAXI_PER_M = 6;
export const TAXI_CLEAN_TIP = 300;
export const TAXI_RADIUS = 8;
export function taxiFare(distance: number): number { return Math.round((TAXI_BASE + distance * TAXI_PER_M) / 50) * 50; }
export const TAXI_STOPS: (Vec2 & { name: string })[] = [
  ...DROPOFFS,
  { name: 'Benin Airport (arrivals kerb)', x: -16, z: -208 },
  { name: 'City car park', x: -38, z: 11 },
  { name: 'New Benin Market', x: 10, z: 40 },
  { name: 'BEST 𝕏 Car Stands', x: 10, z: 84 },
  { name: 'Iyare Guest House', x: -70, z: -10 },
  { name: 'Ring Road Car Wash', x: 40, z: 10 },
];
export const TAXI_PASSENGERS = ['Mama Efe', 'Osaro', 'Ivie', 'Uyi', 'Eki', 'Nosa', 'Aisosa', 'Osagie', 'Itohan', 'Efosa', 'Amaka', 'Tunde'];

export interface StationJob {
  id: 'carwash' | 'mechanic'; name: string; place: string;
  /** where to stand to start / stop a shift */
  start: Vec2; startRadius: number;
  /** where the customer's car is parked; spots are offsets in the car's frame (+z = bonnet) */
  car: Vec2 & { rot: number };
  spots: { dx: number; dz: number; label: string }[];
  pay: number; workMs: number;
}
export const STATION_JOBS: Record<'carwash' | 'mechanic', StationJob> = {
  carwash: {
    id: 'carwash', name: 'Car-wash attendant', place: 'Ring Road Car Wash', start: { x: 54.5, z: 19.2 }, startRadius: 3,
    car: { x: 47, z: 21, rot: 0 }, pay: 600, workMs: 2500,
    spots: [{ dx: 0, dz: 3.0, label: 'Soap the bonnet' }, { dx: 1.75, dz: 0, label: 'Scrub the left side' }, { dx: 0, dz: -3.0, label: 'Rinse the boot' }, { dx: -1.75, dz: 0, label: 'Wipe the right side dry' }],
  },
  mechanic: {
    id: 'mechanic', name: 'Mechanic', place: 'Osaze Mechanic Workshop', start: { x: -111.5, z: -13.5 }, startRadius: 3,
    car: { x: -118, z: -18.5, rot: 0 }, pay: 1200, workMs: 3500,
    spots: [{ dx: 0, dz: 2.9, label: 'Open the bonnet & check the engine' }, { dx: 1.6, dz: 1.35, label: 'Change the front tyre' }, { dx: -1.6, dz: 1.35, label: 'Top up oil & coolant' }, { dx: 1.6, dz: -0.4, label: 'Test the brakes' }],
  },
};
export const STATION_RADIUS = 1.8;
/** world position of spot i (car frame: +z forward = (sin rot, cos rot), +x = (cos rot, -sin rot)) */
export function stationSpot(j: StationJob, i: number): Vec2 {
  const s = j.spots[i], c = Math.cos(j.car.rot), n = Math.sin(j.car.rot);
  return { x: j.car.x + s.dx * c + s.dz * n, z: j.car.z - s.dx * n + s.dz * c };
}

// ---------------- CLOTHING (phase 2): Uyi Fashion House ----------------
export type OutfitStyle = 'casual' | 'ankara' | 'senator' | 'agbada' | 'black_suit' | 'white_suit' | 'edo_coral' | 'police'; // police = NPC uniform, not sold
export const CLOTHES: { id: OutfitStyle; name: string; price: number; desc: string }[] = [
  { id: 'casual', name: 'Casual (your own clothes)', price: 0, desc: 'T-shirt/top in your chosen colour' },
  { id: 'ankara', name: 'Ankara shirt', price: 25_000, desc: 'Bold wax-print shirt' },
  { id: 'senator', name: 'Senator wear', price: 60_000, desc: 'Tailored navy kaftan top with matching trousers' },
  { id: 'agbada', name: 'Agbada with fila cap', price: 150_000, desc: 'Flowing embroidered robe for big occasions' },
  { id: 'black_suit', name: 'Black suit', price: 180_000, desc: 'Sharp black suit, white shirt, tie' },
  { id: 'white_suit', name: 'White suit', price: 250_000, desc: 'All-white suit (the look BEST 𝕏 made famous)' },
  { id: 'edo_coral', name: 'Edo traditional (white + coral beads)', price: 300_000, desc: 'White attire with red coral bead necklace and cap' },
];
export const CLOTHING_STORE = { name: 'Uyi Fashion House', door: { x: 42, z: -11.6 } as Vec2, radius: 5 };
export function clothById(id: unknown): (typeof CLOTHES)[number] | undefined { return CLOTHES.find((c) => c.id === id); }

// ---------------- POLICE & WANTED LEVEL (phase 2) ----------------
// A few officers at fixed checkpoints (realistic Nigerian roadside checkpoints) + the police station. The server
// detects crimes from authoritative positions/speeds; wanted stars decay when no officer has seen you for a while.
export interface PoliceOfficer { x: number; z: number; rot: number; checkpoint: string }
export const POLICE_CHECKPOINTS: { id: string; name: string; x: number; z: number; car: { x: number; z: number; rot: number }; drums: Vec2[] }[] = [
  { id: 'east', name: 'Police Station checkpoint (East road)', x: 94, z: -7.5, car: { x: 104, z: -9.6, rot: Math.PI / 2 }, drums: [{ x: 88, z: -5 }, { x: 90.5, z: -3.2 }, { x: 99, z: -5 }] },
  { id: 'north', name: 'Airport road checkpoint', x: 7.5, z: -160, car: { x: 9.6, z: -168, rot: 0 }, drums: [{ x: 5, z: -154 }, { x: 3.2, z: -156.5 }] },
  { id: 'south', name: 'South road checkpoint', x: -7.5, z: 125, car: { x: -9.6, z: 132, rot: Math.PI }, drums: [{ x: -5, z: 119 }, { x: -3.2, z: 121.5 }] },
];
export const POLICE_OFFICERS: PoliceOfficer[] = [
  { x: 92.5, z: -6.6, rot: Math.PI, checkpoint: 'east' }, { x: 96.5, z: -8.6, rot: Math.PI * 0.9, checkpoint: 'east' },
  { x: 6.6, z: -160, rot: -Math.PI / 2, checkpoint: 'north' },
  { x: -6.6, z: 125, rot: Math.PI / 2, checkpoint: 'south' },
];
export const POLICE_STATION = { name: 'Benin Central Police Station', door: { x: 100, z: -12.4 } as Vec2, release: { x: 100, z: -10.5, rot: Math.PI }, radius: 4 };
export const SPEED_LIMIT = 70 / 3.6;      // 70 km/h in the city
export const POLICE_SIGHT = 40;           // metres an officer can clock you from
export const ARREST_RADIUS = 4.5;
export const WANTED_MAX = 5;
export const FINE_PER_STAR = 5000;        // ₦ fine on arrest
export const SURRENDER_PER_STAR = 3000;   // ₦ if you hand yourself in at the station
export const WANTED_DECAY_MS = 90_000;    // one star lost per 90 s unseen by police
export function nearestOfficer(p: Vec2): { o: PoliceOfficer; d: number } {
  let best = { o: POLICE_OFFICERS[0], d: Infinity };
  for (const o of POLICE_OFFICERS) { const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < best.d) best = { o, d }; }
  return best;
}

// ---------------- TRAVEL: Benin City <-> Lagos (Lekki-style "Ikate Waterside" district) ----------------
// The Lagos district sits far east in world space (x≈2000) so the two cities never render together.
export const LAGOS = { x: 2000, z: 0, half: 190, name: 'Ikate Waterside, Lagos' };
export type City = 'benin' | 'lagos';
export function inLagos(x: number, z: number): boolean { return Math.abs(x - LAGOS.x) <= LAGOS.half && Math.abs(z - LAGOS.z) <= LAGOS.half; }
export function cityAt(x: number, _z?: number): City { return x > 1000 ? 'lagos' : 'benin'; }
export const BENIN_MOTOR_PARK = { x: -34, z: 158, w: 36, d: 26 };
export const LAGOS_MOTOR_PARK = { x: LAGOS.x - 120, z: -16, w: 40, d: 28 };
export const LAGOS_AIRPORT = { x: LAGOS.x + 130, z: -112, w: 60, d: 22 };
export type TravelMode = 'bus' | 'flight';
export const TRAVEL: Record<TravelMode, { name: string; price: number; hours: string; cutsceneMs: number; desk: Record<City, Vec2>; arrive: Record<City, { x: number; z: number; rot: number }>; place: Record<City, string> }> = {
  bus: {
    name: 'Luxury bus (Edo Line Motors)', price: 18_000, hours: '≈5 h', cutsceneMs: 9000,
    desk: { benin: { x: -17.5, z: 152 }, lagos: { x: LAGOS_MOTOR_PARK.x + 19, z: LAGOS_MOTOR_PARK.z - 6 } },
    arrive: { benin: { x: -14.5, z: 158, rot: Math.PI / 2 }, lagos: { x: LAGOS_MOTOR_PARK.x + 22, z: LAGOS_MOTOR_PARK.z, rot: -Math.PI / 2 } },
    place: { benin: 'Benin Motor Park (South road)', lagos: 'Eko Motor Park, Ikate' },
  },
  flight: {
    name: 'Ivie Air domestic flight', price: 95_000, hours: '≈45 min', cutsceneMs: 9000,
    desk: { benin: { x: 27, z: -235.5 }, lagos: { x: LAGOS_AIRPORT.x - 14, z: LAGOS_AIRPORT.z + 14.5 } },
    arrive: { benin: { x: AIRPORT.arrival.x, z: AIRPORT.arrival.z, rot: AIRPORT.arrival.rot }, lagos: { x: LAGOS_AIRPORT.x - 6, z: LAGOS_AIRPORT.z + 17, rot: 0 } },
    place: { benin: 'Benin Airport check-in (Departures)', lagos: 'Lagos Domestic Airport (Ikate) check-in' },
  },
};
export const TRAVEL_DESK_RADIUS = 3;

/** Ring Road roundabout traffic lights (shared clock, so every player sees the same phase).
 *  Axis 0 = East/West arms, 1 = North/South. 26 s cycle: E/W green 0–11, amber 11–13, N/S green 13–24, amber 24–26. */
export const LIGHT_CYCLE = 26;
export function lightState(axis: 0 | 1, t: number): 'green' | 'amber' | 'red' {
  const p = ((t % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE, q = axis === 0 ? p : (p + 13) % LIGHT_CYCLE;
  return q < 11 ? 'green' : q < 13 ? 'amber' : 'red';
}
