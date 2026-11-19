import { describe, expect, it } from "vitest";
import { addRecent, EMPTY, isSaved, MAX_RECENTS, MAX_SAVED, readPlaces, rememberable, toggleSaved, toStored, writePlaces } from "./savedPlaces";

const p = (name: string, lat = 43.07, lon = -89.4) => ({ name, lat, lon });

describe("saved places", () => {
  it("saves and un-saves a place", () => {
    const a = toggleSaved(EMPTY, p("Home"));
    expect(isSaved(a, p("Home"))).toBe(true);
    expect(toggleSaved(a, p("Home")).saved).toEqual([]);
  });
  it("treats the same name or a spot within 40 m as one place", () => {
    const a = toggleSaved(EMPTY, p("Home"));
    expect(isSaved(a, p("home", 50, 50))).toBe(true);
    expect(isSaved(a, p("Elsewhere", 43.0702, -89.4))).toBe(true);
    expect(isSaved(a, p("Far", 43.08, -89.4))).toBe(false);
  });
  it("caps the saved list, newest first", () => {
    let st = EMPTY;
    for (let i = 0; i < MAX_SAVED + 3; i++) st = toggleSaved(st, p(`P${i}`, 40 + i, -80));
    expect(st.saved).toHaveLength(MAX_SAVED);
    expect(st.saved[0].name).toBe(`P${MAX_SAVED + 2}`);
  });
  it("saving a recent moves it out of the recents", () => {
    let st = addRecent(EMPTY, p("Cafe"));
    st = toggleSaved(st, p("Cafe"));
    expect(st.recents).toEqual([]);
    expect(st.saved.map((s) => s.name)).toEqual(["Cafe"]);
  });
});

describe("recents", () => {
  it("puts the latest first, without duplicates", () => {
    let st = addRecent(EMPTY, p("A", 41, -80));
    st = addRecent(st, p("B", 42, -80));
    st = addRecent(st, p("a", 41, -80));
    expect(st.recents.map((r) => r.name)).toEqual(["a", "B"]);
  });
  it("caps the list and skips saved places", () => {
    let st = EMPTY;
    for (let i = 0; i < MAX_RECENTS + 4; i++) st = addRecent(st, p(`R${i}`, 40 + i, -80));
    expect(st.recents).toHaveLength(MAX_RECENTS);
    const saved = toggleSaved(EMPTY, p("Home"));
    expect(addRecent(saved, p("Home"))).toBe(saved);
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
    const st = toggleSaved(addRecent(EMPTY, p("R", 41, -80)), p("S", 42, -80));
    writePlaces(st, store);
    expect(readPlaces(store)).toEqual(st);
    mem["badgergo.places"] = "{nope";
    expect(readPlaces(store)).toEqual(EMPTY);
    mem["badgergo.places"] = JSON.stringify({ saved: [{ name: 1 }, p("ok")], recents: "x" });
    expect(readPlaces(store).saved.map((s) => s.name)).toEqual(["ok"]);
  });
});
