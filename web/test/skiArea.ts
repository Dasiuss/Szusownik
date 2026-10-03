// Fixture małego ośrodka narciarskiego dla testów mapy i routingu.
// Współrzędne to [lon, lat] (kolejność GeoJSON/MapLibre).

import type { Position, SkiLineFeature, SkiProperties } from "../src/lib/mapData.ts";

/** Płaszczyzna wysokości: maleje na południe i wschód (zjazd w dół). */
export function planeElevation([longitude, latitude]: Position): number {
  return 1000 - (latitude - 46.96) * 1000 - (longitude - 10.98) * 3000;
}

export function lineFeature(
  uid: string,
  coordinates: Position[],
  overrides: Partial<SkiProperties> = {},
): SkiLineFeature {
  const routeKind = overrides.routeKind ?? "piste";
  const difficulty = overrides.difficulty ?? "easy";
  const properties: SkiProperties = {
    uid,
    label: overrides.label ?? uid,
    name: overrides.name ?? uid,
    ref: overrides.ref ?? "",
    difficulty,
    difficultyColor: overrides.difficultyColor ?? "#22c55e",
    pisteType: overrides.pisteType ?? "downhill",
    grooming: overrides.grooming ?? "classic",
    warning: overrides.warning ?? false,
    site: overrides.site ?? null,
    aerialway: overrides.aerialway ?? "",
    openingHours: overrides.openingHours ?? "",
    routeKind,
  };
  return { type: "Feature", id: uid, properties, geometry: { type: "LineString", coordinates } };
}

/** Prosta trasa z dwóch punktów o danej długości (stopnie ~ metry/111320). */
export function straightPiste(uid: string, start: Position, end: Position, overrides?: Partial<SkiProperties>) {
  return lineFeature(uid, [start, end], overrides);
}

export function midPoint(first: Position, second: Position): Position {
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
}

/** Surowa odpowiedź Overpass (elementy) do testów normalizeSkiData. */
export function overpassElements() {
  return [
    {
      type: "way" as const,
      id: 1,
      tags: { "piste:type": "downhill", "piste:difficulty": "easy", name: "Łatwa", ref: "1", "piste:grooming": "classic" },
      geometry: [
        { lon: 10.98, lat: 46.97 },
        { lon: 10.982, lat: 46.968 },
        { lon: 10.984, lat: 46.966 },
      ],
    },
    {
      type: "way" as const,
      id: 2,
      tags: { "piste:type": "downhill", "piste:difficulty": "expert", name: "Czarna" },
      geometry: [
        { lon: 10.984, lat: 46.966 },
        { lon: 10.986, lat: 46.963 },
      ],
    },
    {
      type: "way" as const,
      id: 3,
      tags: { "piste:type": "downhill", "piste:grooming": "no", name: "Zamknięta" },
      geometry: [
        { lon: 10.98, lat: 46.97 },
        { lon: 10.981, lat: 46.969 },
      ],
    },
    {
      type: "way" as const,
      id: 4,
      tags: { "piste:type": "downhill", "piste:difficulty": "freeride", name: "Freeride" },
      geometry: [
        { lon: 10.98, lat: 46.97 },
        { lon: 10.9805, lat: 46.9695 },
      ],
    },
    {
      type: "way" as const,
      id: 5,
      tags: { aerialway: "chair_lift", name: "Krzesełko", ref: "A" },
      geometry: [
        { lon: 10.984, lat: 46.966 },
        { lon: 10.98, lat: 46.97 },
      ],
    },
    {
      // Zamknięty way piste -> polygon.
      type: "way" as const,
      id: 6,
      tags: { "piste:type": "downhill", "piste:difficulty": "intermediate", name: "Pętla" },
      geometry: [
        { lon: 10.99, lat: 46.965 },
        { lon: 10.991, lat: 46.965 },
        { lon: 10.991, lat: 46.964 },
        { lon: 10.99, lat: 46.965 },
      ],
    },
    {
      type: "relation" as const,
      id: 100,
      tags: { site: "piste", name: "Ośrodek Testowy" },
      members: [
        { type: "way", ref: 1, role: "" },
        { type: "way", ref: 5, role: "" },
      ],
    },
    {
      // Way bez geometrii / nieistotny (droga) — pomijany.
      type: "way" as const,
      id: 7,
      tags: { highway: "track" },
    },
  ];
}
