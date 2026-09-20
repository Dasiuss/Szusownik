import { ROUTE_SNAP_RADIUS_M, type Position, type SkiLineFeature, type SkiProperties } from "./mapData.ts";

const METERS_PER_DEGREE = 111320;
const ROUTE_CONNECT_RADIUS_M = 100;
const ROUTE_ELEVATION_TOLERANCE_M = 15;

type RouteKind = "piste" | "lift";
type BBox = [number, number, number, number];
type XY = [number, number];
export type RouteCost = [number, number, number, number, number, number];

interface RouteSegment {
  start: Position;
  end: Position;
  location: number;
  length: number;
  bbox: BBox;
}

interface NormalizedRouteFeature {
  uid: string;
  kind: RouteKind;
  properties: SkiProperties;
  coordinates: Position[];
  segments: RouteSegment[];
  bbox: BBox;
  length: number;
}

interface RoutePoint {
  coordinate: Position;
  distance: number;
  location: number;
}

interface RoutePointRecord {
  coordinate: Position;
  location: number;
  featureUid: string;
  elevation: number | null;
  endpoint?: boolean;
}

interface ExtraPoint {
  id: string;
  uid: string;
  coordinate: Position;
  location: number;
}

interface ConnectionSpec {
  sourcePoint: RoutePointRecord;
  targetPoint: RoutePointRecord;
  distance: number;
}

interface RouteGraphNode {
  coordinate: Position;
  elevation: number | null;
}

interface RouteGraphEdge {
  to: string;
  featureUid: string | null;
  geometry: Position[];
  kind: "piste" | "lift" | "connection";
  distance: number;
  transferDistance: number;
  blackDistance: number;
  ungroomedDistance: number;
  liftCount: number;
  downhillLiftCount: number;
}

interface RouteGraph {
  nodes: Map<string, RouteGraphNode>;
  adjacency: Map<string, RouteGraphEdge[]>;
  extraNodeIds: Record<string, string | undefined>;
}

interface GraphRoute {
  featureUids: string[];
  steps: string[];
  edges: RouteGraphEdge[];
  cost: RouteCost;
}

export interface SnappedRoutePoint {
  uid: string;
  featureUid: string;
  coordinate: Position;
  distance: number;
  location: number;
}

export interface RouteSequenceItem {
  uid: string;
  label: string;
  kind: "piste" | "lift";
  color: string;
  aerialway: string;
}

export interface RouteResult {
  distanceM: number;
  cost: RouteCost;
  sequence: RouteSequenceItem[];
  segments: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: {
        kind: "piste" | "lift" | "connection";
        color: string;
        uid?: string;
        label?: string;
        aerialway?: string;
        liftCount?: number;
        downhillLiftCount?: number;
        ungroomedDistance?: number;
        blackDistance?: number;
        transferDistance?: number;
      };
      geometry: { type: "LineString"; coordinates: Position[] };
    }>;
  };
  start: Position;
  end: Position;
}

type ElevationProvider = ((coordinate: Position) => number | null | undefined) | undefined;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function longitudeScale(latitude: number): number {
  return METERS_PER_DEGREE * Math.max(Math.cos(toRadians(latitude)), 0.1);
}

function coordinateDistance(a: Position, b: Position): number {
  const latitude = (a[1] + b[1]) / 2;
  const x = (b[0] - a[0]) * longitudeScale(latitude);
  const y = (b[1] - a[1]) * METERS_PER_DEGREE;
  return Math.hypot(x, y);
}

function normalizeRouteFeatures(features: SkiLineFeature[]): NormalizedRouteFeature[] {
  return features
    .filter((feature) => feature.geometry.type === "LineString" && feature.geometry.coordinates.length >= 2)
    .map((feature) => {
      const coordinates = feature.geometry.coordinates;
      const segments: RouteSegment[] = [];
      let length = 0;
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;

      for (let index = 0; index < coordinates.length; index += 1) {
        const coordinate = coordinates[index];
        west = Math.min(west, coordinate[0]);
        south = Math.min(south, coordinate[1]);
        east = Math.max(east, coordinate[0]);
        north = Math.max(north, coordinate[1]);
        if (index === 0) continue;

        const start = coordinates[index - 1];
        const segmentLength = coordinateDistance(start, coordinate);
        segments.push({
          start,
          end: coordinate,
          location: length,
          length: segmentLength,
          bbox: [
            Math.min(start[0], coordinate[0]),
            Math.min(start[1], coordinate[1]),
            Math.max(start[0], coordinate[0]),
            Math.max(start[1], coordinate[1]),
          ],
        });
        length += segmentLength;
      }

      return {
        uid: feature.properties.uid,
        kind: feature.properties.routeKind,
        properties: feature.properties,
        coordinates,
        segments,
        bbox: [west, south, east, north],
        length,
      };
    })
    .filter((feature) => feature.length > 0);
}

function elevationAt(getElevation: ElevationProvider, coordinate: Position): number | null {
  if (!getElevation) return null;
  try {
    const elevation = getElevation(coordinate);
    return typeof elevation === "number" && Number.isFinite(elevation) ? elevation : null;
  } catch {
    return null;
  }
}

function hasElevation(elevation: number | null): elevation is number {
  return elevation !== null && Number.isFinite(elevation);
}

function isWithinRouteBounds(coordinates: Position, feature: NormalizedRouteFeature, radius: number): boolean {
  const [longitude, latitude] = coordinates;
  const latitudeRadius = radius / METERS_PER_DEGREE;
  const longitudeRadius = radius / longitudeScale(latitude);
  return (
    longitude >= feature.bbox[0] - longitudeRadius &&
    longitude <= feature.bbox[2] + longitudeRadius &&
    latitude >= feature.bbox[1] - latitudeRadius &&
    latitude <= feature.bbox[3] + latitudeRadius
  );
}

function areBboxesWithinDistance(first: BBox, second: BBox, radius: number): boolean {
  const latitude = (first[1] + first[3] + second[1] + second[3]) / 4;
  const latitudeRadius = radius / METERS_PER_DEGREE;
  const longitudeRadius = radius / longitudeScale(latitude);
  return !(
    first[2] + longitudeRadius < second[0] ||
    second[2] + longitudeRadius < first[0] ||
    first[3] + latitudeRadius < second[1] ||
    second[3] + latitudeRadius < first[1]
  );
}

function nearestRoutePoint(feature: NormalizedRouteFeature, coordinates: Position): RoutePoint {
  const [queryLongitude, queryLatitude] = coordinates;
  const lngScale = longitudeScale(queryLatitude);
  let bestDistanceSquared = Infinity;
  let bestCoordinate: Position = feature.coordinates[0];
  let bestLocation = 0;

  for (const segment of feature.segments) {
    const ax = (segment.start[0] - queryLongitude) * lngScale;
    const ay = (segment.start[1] - queryLatitude) * METERS_PER_DEGREE;
    const bx = (segment.end[0] - queryLongitude) * lngScale;
    const by = (segment.end[1] - queryLatitude) * METERS_PER_DEGREE;
    const dx = bx - ax;
    const dy = by - ay;
    const segmentLengthSquared = dx * dx + dy * dy;
    const projection = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / segmentLengthSquared));
    const closestX = ax + dx * projection;
    const closestY = ay + dy * projection;
    const distanceSquared = closestX * closestX + closestY * closestY;

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestCoordinate = [
        segment.start[0] + (segment.end[0] - segment.start[0]) * projection,
        segment.start[1] + (segment.end[1] - segment.start[1]) * projection,
      ];
      bestLocation = segment.location + segment.length * projection;
    }
  }

  return {
    coordinate: bestCoordinate,
    distance: Math.sqrt(bestDistanceSquared),
    location: Math.min(bestLocation, feature.length),
  };
}

function nearestPiste(normalizedFeatures: NormalizedRouteFeature[], coordinates: Position): SnappedRoutePoint | null {
  let nearest: RoutePoint & { featureUid: string } | null = null;
  for (const feature of normalizedFeatures) {
    if (feature.kind !== "piste" || !isWithinRouteBounds(coordinates, feature, ROUTE_SNAP_RADIUS_M)) continue;
    const candidate = nearestRoutePoint(feature, coordinates);
    if (!nearest || candidate.distance < nearest.distance) {
      nearest = { ...candidate, featureUid: feature.uid };
    }
  }
  if (!nearest || nearest.distance > ROUTE_SNAP_RADIUS_M) return null;
  return { ...nearest, uid: nearest.featureUid };
}

export function snapToPiste(features: SkiLineFeature[], coordinate: Position, liftUid?: string): SnappedRoutePoint | null {
  const normalizedFeatures = normalizeRouteFeatures(features);
  let snap = nearestPiste(normalizedFeatures, coordinate);

  if (liftUid) {
    const lift = normalizedFeatures.find((feature) => feature.uid === liftUid && feature.kind === "lift");
    if (lift) {
      const liftPoint = nearestRoutePoint(lift, coordinate);
      const liftSnap = nearestPiste(normalizedFeatures, liftPoint.coordinate);
      if (liftSnap && (!snap || liftSnap.distance < snap.distance)) snap = liftSnap;
    }
  }

  return snap;
}

export interface SnappedRoutePosition {
  coordinate: Position;
  alongM: number;
  offsetM: number;
}

function routePolyline(route: RouteResult): { coordinates: Position[]; cumulative: number[] } {
  const coordinates: Position[] = [];
  const cumulative: number[] = [];
  let distance = 0;
  for (const feature of route.segments.features) {
    for (const point of feature.geometry.coordinates) {
      const previous = coordinates[coordinates.length - 1];
      if (previous && previous[0] === point[0] && previous[1] === point[1]) continue;
      if (previous) distance += coordinateDistance(previous, point);
      coordinates.push(point);
      cumulative.push(distance);
    }
  }
  return { coordinates, cumulative };
}

export function snapToRoute(route: RouteResult, position: Position): SnappedRoutePosition | null {
  const { coordinates, cumulative } = routePolyline(route);
  if (coordinates.length < 2) return null;
  const lngScale = longitudeScale(position[1]);
  let bestDistanceSquared = Infinity;
  let bestCoordinate = coordinates[0];
  let bestAlong = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const ax = (start[0] - position[0]) * lngScale;
    const ay = (start[1] - position[1]) * METERS_PER_DEGREE;
    const bx = (end[0] - position[0]) * lngScale;
    const by = (end[1] - position[1]) * METERS_PER_DEGREE;
    const dx = bx - ax;
    const dy = by - ay;
    const segmentLengthSquared = dx * dx + dy * dy;
    const projection = segmentLengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / segmentLengthSquared));
    const closestX = ax + dx * projection;
    const closestY = ay + dy * projection;
    const distanceSquared = closestX * closestX + closestY * closestY;

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestCoordinate = [
        start[0] + (end[0] - start[0]) * projection,
        start[1] + (end[1] - start[1]) * projection,
      ];
      bestAlong = cumulative[index - 1] + (cumulative[index] - cumulative[index - 1]) * projection;
    }
  }

  return { coordinate: bestCoordinate, alongM: bestAlong, offsetM: Math.sqrt(bestDistanceSquared) };
}

function lineLength(coordinates: Position[]): number {
  let length = 0;
  for (let index = 1; index < coordinates.length; index += 1) length += coordinateDistance(coordinates[index - 1], coordinates[index]);
  return length;
}

function sliceLineFrom(coordinates: Position[], cutM: number): Position[] {
  if (cutM <= 0) return coordinates;
  let travelled = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const segmentLength = coordinateDistance(coordinates[index - 1], coordinates[index]);
    if (travelled + segmentLength < cutM) {
      travelled += segmentLength;
      continue;
    }
    const ratio = segmentLength === 0 ? 0 : (cutM - travelled) / segmentLength;
    const cut: Position = [
      coordinates[index - 1][0] + (coordinates[index][0] - coordinates[index - 1][0]) * ratio,
      coordinates[index - 1][1] + (coordinates[index][1] - coordinates[index - 1][1]) * ratio,
    ];
    return [cut, ...coordinates.slice(index)];
  }
  return [coordinates[coordinates.length - 1]];
}

export function trimRoute(route: RouteResult, alongM: number): RouteResult | null {
  const spans: Array<{ feature: RouteResult["segments"]["features"][number]; startM: number; endM: number }> = [];
  let cursor = 0;
  for (const feature of route.segments.features) {
    const length = lineLength(feature.geometry.coordinates);
    spans.push({ feature, startM: cursor, endM: cursor + length });
    cursor += length;
  }

  const features: RouteResult["segments"]["features"] = [];
  let distanceM = 0;
  let downhillLiftCount = 0;
  let liftCount = 0;
  let ungroomedDistance = 0;
  let blackDistance = 0;
  let transferDistance = 0;
  // Koszt per krawędź jest zapisany w properties, więc po przycięciu można go
  // przeliczyć od nowa. Dystanse skalujemy proporcjonalnie do pozostałej części
  // krawędzi, a licznik przejazdów wyciągiem zostaje, gdy z krawędzi coś zostało
  // (przycięcie w połowie wyciągu to nadal jeden przejazd).
  const addSpanCost = (properties: RouteResult["segments"]["features"][number]["properties"], remainingLength: number, fullLength: number): void => {
    const fraction = fullLength > 0 ? remainingLength / fullLength : 1;
    downhillLiftCount += properties.downhillLiftCount ?? 0;
    liftCount += properties.liftCount ?? 0;
    ungroomedDistance += (properties.ungroomedDistance ?? 0) * fraction;
    blackDistance += (properties.blackDistance ?? 0) * fraction;
    transferDistance += (properties.transferDistance ?? 0) * fraction;
  };
  for (const span of spans) {
    const fullLength = span.endM - span.startM;
    if (span.endM <= alongM) continue;
    if (span.startM >= alongM) {
      features.push(span.feature);
      distanceM += fullLength;
      addSpanCost(span.feature.properties, fullLength, fullLength);
      continue;
    }
    const coordinates = sliceLineFrom(span.feature.geometry.coordinates, alongM - span.startM);
    if (coordinates.length < 2) continue;
    const remainingLength = lineLength(coordinates);
    features.push({ ...span.feature, geometry: { type: "LineString", coordinates } });
    distanceM += remainingLength;
    addSpanCost(span.feature.properties, remainingLength, fullLength);
  }
  if (features.length === 0 || distanceM < 1) return null;

  const sequenceByUid = new Map(route.sequence.map((item) => [item.uid, item]));
  const sequence: RouteSequenceItem[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const uid = feature.properties.uid;
    if (!uid || seen.has(uid)) continue;
    const item = sequenceByUid.get(uid);
    if (!item) continue;
    seen.add(uid);
    sequence.push(item);
  }

  return {
    distanceM,
    cost: [downhillLiftCount, liftCount, ungroomedDistance, blackDistance, transferDistance, distanceM],
    sequence,
    segments: { type: "FeatureCollection", features },
    start: features[0].geometry.coordinates[0],
    end: route.end,
  };
}

function pointOnSegment(point: XY, start: XY, end: XY): { ratio: number; point: XY } {
  const direction: XY = [end[0] - start[0], end[1] - start[1]];
  const lengthSquared = direction[0] * direction[0] + direction[1] * direction[1];
  const position: XY = [point[0] - start[0], point[1] - start[1]];
  const ratio = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (position[0] * direction[0] + position[1] * direction[1]) / lengthSquared));
  return {
    ratio,
    point: [start[0] + direction[0] * ratio, start[1] + direction[1] * ratio],
  };
}

function cross(first: XY, second: XY): number {
  return first[0] * second[1] - first[1] * second[0];
}

interface ClosestSegmentPoints {
  firstLocation: number;
  secondLocation: number;
  firstCoordinate: Position;
  secondCoordinate: Position;
  distance: number;
}

function closestSegmentPoints(firstSegment: RouteSegment, secondSegment: RouteSegment): ClosestSegmentPoints {
  const origin = firstSegment.start;
  const latitude = (firstSegment.start[1] + firstSegment.end[1] + secondSegment.start[1] + secondSegment.end[1]) / 4;
  const lngScale = longitudeScale(latitude);
  const toLocal = (coordinate: Position): XY => [
    (coordinate[0] - origin[0]) * lngScale,
    (coordinate[1] - origin[1]) * METERS_PER_DEGREE,
  ];
  const firstStart: XY = [0, 0];
  const firstEnd = toLocal(firstSegment.end);
  const secondStart = toLocal(secondSegment.start);
  const secondEnd = toLocal(secondSegment.end);
  const firstDirection: XY = [firstEnd[0] - firstStart[0], firstEnd[1] - firstStart[1]];
  const secondDirection: XY = [secondEnd[0] - secondStart[0], secondEnd[1] - secondStart[1]];

  const candidates: Array<{ firstRatio: number; secondRatio: number; distance: number }> = [];
  const addCandidate = (firstRatio: number, secondRatio: number): void => {
    const firstPoint: XY = [
      firstStart[0] + firstDirection[0] * firstRatio,
      firstStart[1] + firstDirection[1] * firstRatio,
    ];
    const secondPoint: XY = [
      secondStart[0] + secondDirection[0] * secondRatio,
      secondStart[1] + secondDirection[1] * secondRatio,
    ];
    candidates.push({
      firstRatio,
      secondRatio,
      distance: Math.hypot(firstPoint[0] - secondPoint[0], firstPoint[1] - secondPoint[1]),
    });
  };

  const offset: XY = [secondStart[0] - firstStart[0], secondStart[1] - firstStart[1]];
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) > 1e-9) {
    const firstRatio = cross(offset, secondDirection) / denominator;
    const secondRatio = cross(offset, firstDirection) / denominator;
    if (firstRatio >= 0 && firstRatio <= 1 && secondRatio >= 0 && secondRatio <= 1) {
      addCandidate(firstRatio, secondRatio);
    }
  }

  addCandidate(pointOnSegment(secondStart, firstStart, firstEnd).ratio, 0);
  addCandidate(pointOnSegment(secondEnd, firstStart, firstEnd).ratio, 1);
  addCandidate(0, pointOnSegment(firstStart, secondStart, secondEnd).ratio);
  addCandidate(1, pointOnSegment(firstEnd, secondStart, secondEnd).ratio);

  const closest = candidates.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best);
  const interpolate = (start: Position, end: Position, ratio: number): Position => [
    start[0] + (end[0] - start[0]) * ratio,
    start[1] + (end[1] - start[1]) * ratio,
  ];
  return {
    firstLocation: firstSegment.location + firstSegment.length * closest.firstRatio,
    secondLocation: secondSegment.location + secondSegment.length * closest.secondRatio,
    firstCoordinate: interpolate(firstSegment.start, firstSegment.end, closest.firstRatio),
    secondCoordinate: interpolate(secondSegment.start, secondSegment.end, closest.secondRatio),
    distance: closest.distance,
  };
}

function coordinateAtRouteLocation(feature: NormalizedRouteFeature, location: number): Position {
  if (location <= 0) return feature.coordinates[0];
  if (location >= feature.length) return feature.coordinates[feature.coordinates.length - 1];

  for (const segment of feature.segments) {
    const segmentEnd = segment.location + segment.length;
    if (location > segmentEnd) continue;
    const portion = segment.length === 0 ? 0 : (location - segment.location) / segment.length;
    return [
      segment.start[0] + (segment.end[0] - segment.start[0]) * portion,
      segment.start[1] + (segment.end[1] - segment.start[1]) * portion,
    ];
  }
  return feature.coordinates[feature.coordinates.length - 1];
}

function routeFeatureSlice(feature: NormalizedRouteFeature, startLocation: number, endLocation: number): Position[] {
  const forward = endLocation >= startLocation;
  const low = Math.min(startLocation, endLocation);
  const high = Math.max(startLocation, endLocation);
  const coordinates: Position[] = [coordinateAtRouteLocation(feature, low)];

  for (const segment of feature.segments) {
    const vertexLocation = segment.location + segment.length;
    if (vertexLocation > low && vertexLocation < high) coordinates.push(segment.end);
  }
  coordinates.push(coordinateAtRouteLocation(feature, high));
  return forward ? coordinates : coordinates.reverse();
}

function addGraphEdge(adjacency: Map<string, RouteGraphEdge[]>, from: string, edge: RouteGraphEdge): void {
  const edges = adjacency.get(from) ?? [];
  edges.push(edge);
  adjacency.set(from, edges);
}

function buildRouteGraph(features: NormalizedRouteFeature[], getElevation: ElevationProvider, extraPoints: ExtraPoint[]): RouteGraph {
  const featureByUid = new Map(features.map((feature) => [feature.uid, feature]));
  const pointsByFeature = new Map<string, RoutePointRecord[]>();
  const pointNodeIds = new Map<RoutePointRecord, string>();
  const extraRecords = new Map<string, RoutePointRecord>();
  const connectionSpecs: ConnectionSpec[] = [];

  const addPoint = (feature: NormalizedRouteFeature, data: Omit<RoutePointRecord, "featureUid">): RoutePointRecord => {
    const points = pointsByFeature.get(feature.uid);
    if (!points) throw new Error("Nieprawidłowy graf trasy.");
    const existing = points.find((candidate) => Math.abs(candidate.location - data.location) <= 1);
    if (existing) return existing;
    const pointRecord = { ...data, featureUid: feature.uid };
    points.push(pointRecord);
    return pointRecord;
  };

  for (const feature of features) {
    pointsByFeature.set(feature.uid, [
      {
        featureUid: feature.uid,
        coordinate: feature.coordinates[0],
        location: 0,
        elevation: elevationAt(getElevation, feature.coordinates[0]),
        endpoint: true,
      },
      {
        featureUid: feature.uid,
        coordinate: feature.coordinates[feature.coordinates.length - 1],
        location: feature.length,
        elevation: elevationAt(getElevation, feature.coordinates[feature.coordinates.length - 1]),
        endpoint: true,
      },
    ]);
  }

  for (const extra of extraPoints) {
    const feature = featureByUid.get(extra.uid);
    if (!feature) continue;
    const points = pointsByFeature.get(feature.uid);
    const startPoint = points?.find((candidate) => candidate.location === 0);
    const endPoint = points?.find((candidate) => candidate.location === feature.length);
    const interpolatedElevation = startPoint && endPoint && hasElevation(startPoint.elevation) && hasElevation(endPoint.elevation)
      ? startPoint.elevation + (endPoint.elevation - startPoint.elevation) * (extra.location / feature.length)
      : elevationAt(getElevation, extra.coordinate);
    const pointRecord = addPoint(feature, {
      coordinate: extra.coordinate,
      location: extra.location,
      elevation: interpolatedElevation,
    });
    extraRecords.set(extra.id, pointRecord);
  }

  const endpoints: RoutePointRecord[] = [];
  for (const feature of features) {
    endpoints.push(...(pointsByFeature.get(feature.uid) ?? []).filter((point) => point.endpoint));
  }

  for (const sourcePoint of endpoints) {
    const sourceFeature = featureByUid.get(sourcePoint.featureUid);
    if (!sourceFeature) continue;
    for (const targetFeature of features) {
      if (targetFeature.uid === sourceFeature.uid) continue;
      if (sourceFeature.kind !== "lift" && targetFeature.kind !== "lift") continue;
      if (!isWithinRouteBounds(sourcePoint.coordinate, targetFeature, ROUTE_CONNECT_RADIUS_M)) continue;

      let targetPoint: RoutePointRecord | null = null;
      let connectionDistance = Infinity;
      const targetPoints = pointsByFeature.get(targetFeature.uid) ?? [];
      if (targetFeature.kind === "lift") {
        for (const candidate of targetPoints) {
          if (!candidate.endpoint) continue;
          const distance = coordinateDistance(sourcePoint.coordinate, candidate.coordinate);
          if (distance < connectionDistance) {
            targetPoint = candidate;
            connectionDistance = distance;
          }
        }
      } else {
        const nearest = nearestRoutePoint(targetFeature, sourcePoint.coordinate);
        if (nearest.distance <= ROUTE_CONNECT_RADIUS_M) {
          targetPoint = addPoint(targetFeature, {
            coordinate: nearest.coordinate,
            location: nearest.location,
            elevation: elevationAt(getElevation, nearest.coordinate),
          });
          connectionDistance = nearest.distance;
        }
      }

      if (targetPoint && connectionDistance <= ROUTE_CONNECT_RADIUS_M) {
        connectionSpecs.push({ sourcePoint, targetPoint, distance: connectionDistance });
      }
    }
  }

  const pisteFeatures = features.filter((feature) => feature.kind === "piste");
  for (let firstIndex = 0; firstIndex < pisteFeatures.length; firstIndex += 1) {
    const firstFeature = pisteFeatures[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < pisteFeatures.length; secondIndex += 1) {
      const secondFeature = pisteFeatures[secondIndex];
      if (!areBboxesWithinDistance(firstFeature.bbox, secondFeature.bbox, ROUTE_CONNECT_RADIUS_M)) continue;

      const contacts = pistePairContacts(firstFeature, secondFeature);
      for (const contact of contacts) {
        const firstPoint = addPoint(firstFeature, {
          coordinate: contact.firstCoordinate,
          location: contact.firstLocation,
          elevation: elevationAt(getElevation, contact.firstCoordinate),
        });
        const secondPoint = addPoint(secondFeature, {
          coordinate: contact.secondCoordinate,
          location: contact.secondLocation,
          elevation: elevationAt(getElevation, contact.secondCoordinate),
        });
        connectionSpecs.push(
          { sourcePoint: firstPoint, targetPoint: secondPoint, distance: contact.distance },
          { sourcePoint: secondPoint, targetPoint: firstPoint, distance: contact.distance },
        );
      }
    }
  }

  const nodes = new Map<string, RouteGraphNode>();
  const adjacency = new Map<string, RouteGraphEdge[]>();

  for (const feature of features) {
    const rawPoints = pointsByFeature.get(feature.uid) ?? [];
    const sortedPoints = [...rawPoints].sort((first, second) => first.location - second.location);
    const mergedGroups: RoutePointRecord[][] = [];
    for (const point of sortedPoints) {
      const lastGroup = mergedGroups[mergedGroups.length - 1];
      if (lastGroup && Math.abs(lastGroup[0].location - point.location) <= 1) lastGroup.push(point);
      else mergedGroups.push([point]);
    }

    for (let index = 0; index < mergedGroups.length; index += 1) {
      const group = mergedGroups[index];
      const representative = group[0];
      const nodeId = `${feature.uid}:${index}`;
      for (const point of group) pointNodeIds.set(point, nodeId);
      nodes.set(nodeId, { coordinate: representative.coordinate, elevation: representative.elevation });
    }

    const firstGroup = mergedGroups[0];
    const lastGroup = mergedGroups[mergedGroups.length - 1];
    if (!firstGroup || !lastGroup) continue;
    const startElevation = firstGroup[0].elevation;
    const endElevation = lastGroup[0].elevation;
    let forward = true;
    if (hasElevation(startElevation) && hasElevation(endElevation)) {
      forward = feature.kind === "lift" ? startElevation <= endElevation : startElevation >= endElevation;
    }

    const orderedGroups = forward ? mergedGroups : [...mergedGroups].reverse();
    for (let index = 1; index < orderedGroups.length; index += 1) {
      const fromPoint = orderedGroups[index - 1][0];
      const toPoint = orderedGroups[index][0];
      const from = pointNodeIds.get(fromPoint);
      const to = pointNodeIds.get(toPoint);
      const segmentDistance = Math.abs(toPoint.location - fromPoint.location);
      if (!from || !to || segmentDistance <= 0) continue;

      const isBlackPiste = feature.kind === "piste" && (feature.properties.difficulty === "advanced" || feature.properties.difficulty === "expert");
      const isUngroomedPiste = feature.kind === "piste" && feature.properties.warning;
      const featureEdge: RouteGraphEdge = {
        to,
        featureUid: feature.uid,
        geometry: routeFeatureSlice(feature, fromPoint.location, toPoint.location),
        kind: feature.kind,
        distance: segmentDistance,
        transferDistance: 0,
        blackDistance: isBlackPiste ? segmentDistance : 0,
        ungroomedDistance: isUngroomedPiste ? segmentDistance : 0,
        liftCount: feature.kind === "lift" ? 1 : 0,
        downhillLiftCount: 0,
      };
      addGraphEdge(adjacency, from, featureEdge);
      if (feature.kind === "lift") {
        addGraphEdge(adjacency, to, {
          ...featureEdge,
          to: from,
          geometry: routeFeatureSlice(feature, toPoint.location, fromPoint.location),
          downhillLiftCount: 1,
        });
      }
    }
  }

  for (const connection of connectionSpecs) {
    const from = pointNodeIds.get(connection.sourcePoint);
    const to = pointNodeIds.get(connection.targetPoint);
    if (!from || !to || from === to) continue;
    if (hasElevation(connection.sourcePoint.elevation) && hasElevation(connection.targetPoint.elevation) && connection.targetPoint.elevation > connection.sourcePoint.elevation + ROUTE_ELEVATION_TOLERANCE_M) continue;
    addGraphEdge(adjacency, from, {
      to,
      featureUid: null,
      kind: "connection",
      geometry: [connection.sourcePoint.coordinate, connection.targetPoint.coordinate],
      distance: connection.distance,
      transferDistance: connection.distance,
      blackDistance: 0,
      ungroomedDistance: 0,
      liftCount: 0,
      downhillLiftCount: 0,
    });
  }

  const extraNodeIds: Record<string, string | undefined> = {};
  for (const [id, point] of extraRecords) extraNodeIds[id] = pointNodeIds.get(point);
  return { nodes, adjacency, extraNodeIds };
}

function compareRouteCost(first: RouteCost, second: RouteCost): number {
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return first[index] - second[index];
  }
  return 0;
}

function nextRouteCost(cost: RouteCost, edge: RouteGraphEdge): RouteCost {
  return [
    cost[0] + edge.downhillLiftCount,
    cost[1] + edge.liftCount,
    cost[2] + edge.ungroomedDistance,
    cost[3] + edge.blackDistance,
    cost[4] + edge.transferDistance,
    cost[5] + edge.distance,
  ];
}

function findGraphRoute(graph: RouteGraph): GraphRoute | null {
  const start = graph.extraNodeIds.start;
  const end = graph.extraNodeIds.end;
  if (!start || !end) return null;

  const initial: RouteCost = [0, 0, 0, 0, 0, 0];
  const distances = new Map<string, RouteCost>([[start, initial]]);
  const previous = new Map<string, { node: string; edge: RouteGraphEdge }>();
  const queue: Array<{ node: string; cost: RouteCost }> = [{ node: start, cost: initial }];

  while (queue.length > 0) {
    queue.sort((first, second) => compareRouteCost(first.cost, second.cost));
    const current = queue.shift();
    if (!current) break;
    const knownCost = distances.get(current.node);
    if (!knownCost || compareRouteCost(current.cost, knownCost) !== 0) continue;
    if (current.node === end) break;

    for (const edge of graph.adjacency.get(current.node) ?? []) {
      const nextCost = nextRouteCost(current.cost, edge);
      const previousCost = distances.get(edge.to);
      if (!previousCost || compareRouteCost(nextCost, previousCost) < 0) {
        distances.set(edge.to, nextCost);
        previous.set(edge.to, { node: current.node, edge });
        queue.push({ node: edge.to, cost: nextCost });
      }
    }
  }

  const finalCost = distances.get(end);
  if (!finalCost) return null;

  const edges: RouteGraphEdge[] = [];
  let node = end;
  while (node !== start) {
    const step = previous.get(node);
    if (!step) return null;
    edges.push(step.edge);
    node = step.node;
  }
  edges.reverse();

  const steps: string[] = [];
  for (const edge of edges) {
    if (edge.featureUid && steps[steps.length - 1] !== edge.featureUid) steps.push(edge.featureUid);
  }
  if (steps.length === 0) return null;
  return { featureUids: [...new Set(steps)], steps, edges, cost: finalCost };
}

const CONTACT_CLUSTER_M = 10;
const JUNCTION_DISTANCE_M = 5;

function isSameContactCluster(first: ClosestSegmentPoints, second: ClosestSegmentPoints): boolean {
  return (
    Math.abs(first.firstLocation - second.firstLocation) <= CONTACT_CLUSTER_M &&
    Math.abs(first.secondLocation - second.secondLocation) <= CONTACT_CLUSTER_M
  );
}

function pistePairContacts(
  firstFeature: NormalizedRouteFeature,
  secondFeature: NormalizedRouteFeature,
): ClosestSegmentPoints[] {
  let best: ClosestSegmentPoints | null = null;
  const junctionCandidates: ClosestSegmentPoints[] = [];
  for (const firstSegment of firstFeature.segments) {
    for (const secondSegment of secondFeature.segments) {
      if (!areBboxesWithinDistance(firstSegment.bbox, secondSegment.bbox, ROUTE_CONNECT_RADIUS_M)) continue;
      const candidate = closestSegmentPoints(firstSegment, secondSegment);
      if (candidate.distance > ROUTE_CONNECT_RADIUS_M) continue;
      if (!best || candidate.distance < best.distance) best = candidate;
      if (candidate.distance <= JUNCTION_DISTANCE_M) junctionCandidates.push(candidate);
    }
  }
  if (!best) return [];

  // Najpierw sortujemy po dystansie, żeby reprezentantem klastra był
  // najbliższy kontakt, a nie pierwszy w kolejności segmentów OSM.
  junctionCandidates.sort((first, second) => first.distance - second.distance);

  // Klastrowanie z domknięciem przechodnim (single linkage, union-find):
  // kontakty łączone łańcuchowo należą do jednego klastra.
  const parent = junctionCandidates.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    parent[index] = root;
    return root;
  };
  for (let firstIndex = 0; firstIndex < junctionCandidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < junctionCandidates.length; secondIndex += 1) {
      if (isSameContactCluster(junctionCandidates[firstIndex], junctionCandidates[secondIndex])) {
        parent[findRoot(firstIndex)] = findRoot(secondIndex);
      }
    }
  }
  const bestPerCluster = new Map<number, ClosestSegmentPoints>();
  for (let index = 0; index < junctionCandidates.length; index += 1) {
    const root = findRoot(index);
    const current = bestPerCluster.get(root);
    if (!current || junctionCandidates[index].distance < current.distance) {
      bestPerCluster.set(root, junctionCandidates[index]);
    }
  }
  const contacts = [...bestPerCluster.values()];

  // Fallback odziedziczony po poprzednim algorytmie: pary tras stykające się
  // tylko na większą odległość (do 100 m) nadal dostają jedno połączenie.
  if (!contacts.some((other) => isSameContactCluster(other, best))) contacts.push(best);
  contacts.sort((first, second) => first.distance - second.distance);
  return contacts;
}

export async function findRoute(
  features: SkiLineFeature[],
  start: Position,
  end: Position,
  getElevation?: (coordinate: Position) => number | null,
): Promise<RouteResult> {
  const normalizedFeatures = normalizeRouteFeatures(features);
  const startCandidate = nearestPiste(normalizedFeatures, start);
  const endCandidate = nearestPiste(normalizedFeatures, end);
  if (!startCandidate || startCandidate.distance > ROUTE_SNAP_RADIUS_M) throw new Error("Punkt startowy jest dalej niż 100 m od trasy.");
  if (!endCandidate || endCandidate.distance > ROUTE_SNAP_RADIUS_M) throw new Error("Punkt docelowy jest dalej niż 100 m od trasy.");

  const graph = buildRouteGraph(normalizedFeatures, getElevation, [
    { id: "start", uid: startCandidate.uid, coordinate: startCandidate.coordinate, location: startCandidate.location },
    { id: "end", uid: endCandidate.uid, coordinate: endCandidate.coordinate, location: endCandidate.location },
  ]);
  const result = findGraphRoute(graph);
  if (!result) throw new Error("Nie znalazłem połączenia między tymi punktami.");

  const featureByUid = new Map(normalizedFeatures.map((feature) => [feature.uid, feature]));
  const sequence: RouteSequenceItem[] = [];
  for (const uid of result.steps) {
    const feature = featureByUid.get(uid);
    if (!feature) continue;
    const previous = sequence[sequence.length - 1];
    if (previous?.uid === uid) continue;
    sequence.push({
      uid,
      label: feature.properties.label || feature.properties.name || (feature.kind === "lift" ? "Wyciąg" : "Trasa"),
      kind: feature.kind,
      color: feature.kind === "lift" ? "#7c3aed" : feature.properties.difficultyColor,
      aerialway: feature.kind === "lift" ? feature.properties.aerialway : "",
    });
  }

  const segmentFeatures = result.edges
    .filter((edge) => edge.geometry.length >= 2)
    .map((edge) => {
      const feature = edge.featureUid ? featureByUid.get(edge.featureUid) : undefined;
      return {
        type: "Feature" as const,
        properties: {
          kind: edge.kind,
          color: edge.kind === "lift" ? "#7c3aed" : edge.kind === "piste" ? feature?.properties.difficultyColor ?? "#1557b0" : "#1557b0",
          ...(feature ? { uid: feature.properties.uid } : {}),
          ...(feature && edge.kind !== "connection" ? { label: feature.properties.name || feature.properties.ref || undefined } : {}),
          ...(feature?.kind === "lift" ? { aerialway: feature.properties.aerialway } : {}),
          liftCount: edge.liftCount,
          downhillLiftCount: edge.downhillLiftCount,
          ungroomedDistance: edge.ungroomedDistance,
          blackDistance: edge.blackDistance,
          transferDistance: edge.transferDistance,
        },
        geometry: { type: "LineString" as const, coordinates: edge.geometry },
      };
    });

  return {
    distanceM: result.cost[5],
    cost: result.cost,
    sequence,
    segments: { type: "FeatureCollection", features: segmentFeatures },
    start: startCandidate.coordinate,
    end: endCandidate.coordinate,
  };
}
