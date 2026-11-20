import { describe, expect, it } from "vitest";
import { addRecent, EMPTY, MAX_RECENTS, readPlaces, rememberable, toStored, writePlaces } from "./savedPlaces";

const p = (name: string, lat = 43.07, lon = -89.4) => ({ name, lat, lon });

describe("recents", () => {
  it("puts the latest first, without duplicates", () => {
    let st = addRecent(EMPTY, p("A", 41, -80));
    st = addRecent(st, p("B", 42, -80));
    st = addRecent(st, p("a", 41, -80));
    expect(st.recents.map((r) => r.name)).toEqual(["a", "B"]);
  });
  it("caps the list", () => {
    let st = EMPTY;
    for (let i = 0; i < MAX_RECENTS + 4; i++) st = addRecent(st, p(`R${i}`, 40 + i, -80));
    expect(st.recents).toHaveLength(MAX_RECENTS);
  });
});

describe("helpers and storage", () => {
  it("never remembers My location or blank labels", () => {
    expect(rememberable({ lat: 1, lon: 1, label: "My location" })).toBe(false);
    expect(rememberable({ lat: 1, lon: 1, label: " " })).toBe(false);
    expect(rememberable({ lat: 1, lon: 1, label: "Union South" })).toBe(true);
  });
  it("shortens long geocoder labels", () => {
    expect(toStored({ lat: 1, lon: 2, label: "Rosa Rd, Madison, Dane County, Wisconsin" }).name).toBe("Rosa Rd, Madison");
  });
  it("round-trips through storage and survives junk", () => {
    const mem: Record<string, string> = {};
    const store = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
    const st = addRecent(EMPTY, p("R", 41, -80));
    writePlaces(st, store);
    expect(readPlaces(store)).toEqual(st);
    mem["badgergo.places"] = "{nope";
    expect(readPlaces(store)).toEqual(EMPTY);
    mem["badgergo.places"] = JSON.stringify({ recents: [{ name: 1 }, p("ok")] });
    expect(readPlaces(store).recents.map((s) => s.name)).toEqual(["ok"]);
  });
  it("ignores starred places an older version stored", () => {
    const mem: Record<string, string> = { "badgergo.places": JSON.stringify({ saved: [p("Home")], recents: [p("Cafe")] }) };
    expect(readPlaces({ getItem: (k) => mem[k] ?? null })).toEqual({ recents: [p("Cafe")] });
  });
});
