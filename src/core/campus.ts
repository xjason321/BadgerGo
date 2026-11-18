import data from "../data/uw-places.json";

/** A UW–Madison place from map.wisc.edu (buildings, lots, gardens, departments...). */
export interface CampusPlace {
  name: string;
  lat: number;
  lon: number;
  address: string;
  kind: "b" | "n" | "r" | "p" | "i";
  /** Set when matched through a department/office that lives in this building. */
  via?: string;
}

type Raw = { places: [string, number, number, CampusPlace["kind"], string][]; depts: [string, number][] };
const raw = data as unknown as Raw;

export const norm = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

const PLACES = raw.places.map(([name, lat, lon, kind, address]) => ({ name, lat, lon, kind, address }) as CampusPlace);
const PLACE_KEYS = PLACES.map((p) => norm(p.name));
const ADDR_KEYS = PLACES.map((p) => norm(p.address));
const DEPT_KEYS = raw.depts.map(([n, i]) => ({ n, key: norm(n), i }));

/** Common short names students type. */
const ALIASES: Record<string, string> = {
  "the union": "Memorial Union", "mem union": "Memorial Union", "terrace": "Memorial Union",
  "the nick": "Nicholas Recreation Center", "nick": "Nicholas Recreation Center",
  "the kohl": "The Kohl Center", "kohl": "The Kohl Center",
  "the red gym": "Armory and Gymnasium (Red Gym)", "red gym": "Armory and Gymnasium (Red Gym)",
  "the sett": "Union South", "bakke": "Bakke Recreation & Wellbeing Center",
  "the chaz": "Chazen Museum of Art", "chazen": "Chazen Museum of Art",
  "college library": "Helen C. White Hall", "h c white": "Helen C. White Hall",
  "wid": "Discovery Building", "camp randall": "Camp Randall Stadium",
  "engineering": "Engineering Hall", "the hill": "Bascom Hall", "bascom": "Bascom Hall",
};

const byName = (n: string) => PLACES.find((p) => p.name === n);

/** Rank campus places for a typed query. Empty when the query is too short to mean anything. */
export function searchCampus(query: string, limit = 5): CampusPlace[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const toks = q.split(" ");
  const scored: { p: CampusPlace; s: number }[] = [];
  const seen = new Set<string>();
  const add = (p: CampusPlace, s: number) => {
    if (seen.has(p.name)) return;
    seen.add(p.name);
    scored.push({ p, s });
  };
  const alias = ALIASES[q];
  if (alias && byName(alias)) add(byName(alias)!, 0);
  PLACES.forEach((p, i) => {
    const k = PLACE_KEYS[i];
    // Parking lots rank below buildings so "union south" finds the building first.
    const pen = p.kind === "p" ? 5 : 0;
    if (k === q) add(p, 1 + pen);
    else if (k.startsWith(q)) add(p, 2 + pen);
    else if (toks.every((t) => k.split(" ").some((w) => w.startsWith(t)))) add(p, 3 + pen + k.length / 100);
    else if (k.includes(q)) add(p, 4 + pen);
    else if (q.length >= 3 && ADDR_KEYS[i].startsWith(q)) add(p, 6 + pen);
  });
  DEPT_KEYS.forEach((d) => {
    if (d.key.startsWith(q) || (q.length >= 3 && d.key.includes(q))) {
      const b = PLACES[d.i];
      if (b) add({ ...b, via: d.n }, 8 + (d.key.startsWith(q) ? 0 : 1));
    }
  });
  return scored.sort((a, b) => a.s - b.s).slice(0, limit).map((x) => x.p);
}
