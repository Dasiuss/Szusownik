import { ROUTE_SNAP_RADIUS_M, type Position, type SkiLineFeature } from "./mapData.ts";

const METERS_PER_DEGREE = 111320;
const ELEVATION_TOLERANCE_M = 15;

interface RouteNode {
  id: string;
  coordinate: Position;
  featureUid?: string;
  feature?: SkiLineFeature;
  elevation: number | null;
}

interface RouteEdge {
  to: string;
  distance: number;
  kind: "piste" | "lift" | "connection";
  feature?: SkiLineFeature;
  downhillLiftCount: number;
  liftCount: number;
  warningDistance: number;
  difficultDistance: number;
  connectionDistance: number;
}

interface CandidatePoint {
  feature: SkiLineFeature;
  segmentIndex: number;
  coordinate: Position;
  distance: number;
  fraction: number;
}

interface Cost {
  values: [number, number, number, number, number, number];
}

export interface RouteSequenceItem {
  uid: string;
  label: string;
  kind: "piste" | "lift";
  color: string;
}

export interface RouteResult {
  distanceM: number;
  sequence: RouteSequenceItem[];
  segments: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      properties: { kind: "piste" | "lift" | "connection"; color: string };
      geometry: { type: "LineString"; coordinates: Position[] };
    }>;
  };
  start: Position;
  end: Position;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceM(a: Position, b: Position): number {
  const lat = toRadians((a[1] + b[1]) / 2);
  const x = (b[0] - a[0]) * METERS_PER_DEGREE * Math.cos(lat);
  const y = (b[1] - a[1]) * METERS_PER_DEGREE;
  return Math.sqrt(x * x + y * y);
}

function projectPoint(point: Position, start: Position, end: Position): { coordinate: Position; fraction: number; distance: number } {
  const lat = toRadians(point[1]);
  const scale = METERS_PER_DEGREE * Math.cos(lat);
  const px = point[0] * scale;
  const py = point[1] * METERS_PER_DEGREE;
  const ax = start[0] * scale;
  const ay = start[1] * METERS_PER_DEGREE;
  const bx = end[0] * scale;
  const by = end[1] * METERS_PER_DEGREE;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) : 0;
  const coordinate: Position = [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
  return { coordinate, fraction, distance: distanceM(point, coordinate) };
}

function nearestPoint(point: Position, features: SkiLineFeature[]): CandidatePoint | null {
  let closest: CandidatePoint | null = null;
  for (const feature of features) {
    const coordinates = feature.geometry.coordinates;
    for (let index = 0; index < coordinates.length - 1; index++) {
      const projected = projectPoint(point, coordinates[index], coordinates[index + 1]);
      if (!closest || projected.distance < closest.distance) {
        closest = { feature, segmentIndex: index, ...projected };
      }
    }
  }
  return closest;
}

function compareCost(a: Cost, b: Cost): number {
  for (let i = 0; i < a.values.length; i++) {
    if (a.values[i] !== b.values[i]) return a.values[i] - b.values[i];
  }
  return 0;
}

function plusCost(cost: Cost, edge: RouteEdge): Cost {
  const warning = edge.feature?.properties.warning ? edge.distance : 0;
  const difficult = edge.feature && ["advanced", "expert"].includes(edge.feature.properties.difficulty) ? edge.distance : 0;
  return {
    values: [
      cost.values[0] + edge.downhillLiftCount,
      cost.values[1] + edge.liftCount,
      cost.values[2] + warning,
      cost.values[3] + difficult,
      cost.values[4] + edge.connectionDistance,
      cost.values[5] + edge.distance,
    ],
  };
}

function addEdge(edges: Map<string, RouteEdge[]>, from: string, edge: RouteEdge): void {
  const list = edges.get(from) ?? [];
  list.push(edge);
  edges.set(from, list);
}

function elevationAllows(from: RouteNode, to: RouteNode, kind: "piste" | "lift" | "connection"): boolean {
  if (kind !== "piste" || from.elevation === null || to.elevation === null) return true;
  return to.elevation <= from.elevation + ELEVATION_TOLERANCE_M;
}

function addDirectionalEdges(edges: Map<string, RouteEdge[]>, from: RouteNode, to: RouteNode, kind: "piste" | "lift" | "connection", feature?: SkiLineFeature): void {
  const length = distanceM(from.coordinate, to.coordinate);
  const makeEdge = (target: RouteNode): RouteEdge => ({
    to: target.id,
    distance: length,
    kind,
    feature,
    downhillLiftCount: kind === "lift" && from.elevation !== null && target.elevation !== null && target.elevation < from.elevation ? 1 : 0,
    liftCount: kind === "lift" ? 1 : 0,
    warningDistance: kind === "piste" && feature?.properties.warning ? length : 0,
    difficultDistance: kind === "piste" && feature && ["advanced", "expert"].includes(feature.properties.difficulty) ? length : 0,
    connectionDistance: kind === "connection" ? length : 0,
  });
  if (elevationAllows(from, to, kind)) addEdge(edges, from.id, makeEdge(to));
  if (elevationAllows(to, from, kind)) addEdge(edges, to.id, { ...makeEdge(from), to: from.id, downhillLiftCount: kind === "lift" && to.elevation !== null && from.elevation !== null && from.elevation < to.elevation ? 1 : 0 });
}

class MinHeap {
  private items: Array<{ id: string; cost: Cost }> = [];

  push(item: { id: string; cost: Cost }): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareCost(this.items[parent].cost, this.items[index].cost) <= 0) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  pop(): { id: string; cost: Cost } | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (last && this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && compareCost(this.items[left].cost, this.items[smallest].cost) < 0) smallest = left;
        if (right < this.items.length && compareCost(this.items[right].cost, this.items[smallest].cost) < 0) smallest = right;
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
        index = smallest;
      }
    }
    return first;
  }
}

export async function findRoute(
  features: SkiLineFeature[],
  start: Position,
  end: Position,
  getElevation?: (coordinate: Position) => number | null,
): Promise<RouteResult> {
  const snapFeatures = features.filter((feature) => feature.properties.routeKind === "piste");
  const startCandidate = nearestPoint(start, snapFeatures.length > 0 ? snapFeatures : features);
  const endCandidate = nearestPoint(end, snapFeatures.length > 0 ? snapFeatures : features);
  if (!startCandidate || startCandidate.distance > ROUTE_SNAP_RADIUS_M) throw new Error("Punkt startowy jest dalej niż 100 m od trasy.");
  if (!endCandidate || endCandidate.distance > ROUTE_SNAP_RADIUS_M) throw new Error("Punkt docelowy jest dalej niż 100 m od trasy.");

  const nodes = new Map<string, RouteNode>();
  const edges = new Map<string, RouteEdge[]>();
  const featureNodes = new Map<string, string[]>();

  for (const feature of features) {
    if (feature.geometry.coordinates.length < 2) continue;
    const ids: string[] = [];
    for (let index = 0; index < feature.geometry.coordinates.length; index++) {
      const coordinate = feature.geometry.coordinates[index];
      const id = `${feature.id}:${index}`;
      nodes.set(id, { id, coordinate, featureUid: feature.id, feature, elevation: getElevation?.(coordinate) ?? null });
      ids.push(id);
    }
    featureNodes.set(feature.id, ids);
    for (let index = 0; index < ids.length - 1; index++) {
      const from = nodes.get(ids[index]);
      const to = nodes.get(ids[index + 1]);
      if (from && to) addDirectionalEdges(edges, from, to, feature.properties.routeKind, feature);
    }
  }

  const cellSize = ROUTE_SNAP_RADIUS_M;
  const grid = new Map<string, string[]>();
  const gridKey = (coordinate: Position): string => `${Math.floor(coordinate[0] * METERS_PER_DEGREE / cellSize)}:${Math.floor(coordinate[1] * METERS_PER_DEGREE / cellSize)}`;
  for (const node of nodes.values()) {
    const key = gridKey(node.coordinate);
    grid.set(key, [...(grid.get(key) ?? []), node.id]);
  }
  for (const node of nodes.values()) {
    const x = Math.floor(node.coordinate[0] * METERS_PER_DEGREE / cellSize);
    const y = Math.floor(node.coordinate[1] * METERS_PER_DEGREE / cellSize);
    const nearby = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of grid.get(`${x + dx}:${y + dy}`) ?? []) nearby.add(id);
      }
    }
    for (const otherId of nearby) {
      const other = nodes.get(otherId);
      if (!other || other.featureUid === node.featureUid || node.id >= other.id) continue;
      if (distanceM(node.coordinate, other.coordinate) <= ROUTE_SNAP_RADIUS_M) addDirectionalEdges(edges, node, other, "connection");
    }
  }

  const virtualNode = (id: string, candidate: CandidatePoint): RouteNode => ({
    id,
    coordinate: candidate.coordinate,
    featureUid: candidate.feature.id,
    feature: candidate.feature,
    elevation: getElevation?.(candidate.coordinate) ?? null,
  });
  const startNode = virtualNode("__start", startCandidate);
  const endNode = virtualNode("__end", endCandidate);
  nodes.set(startNode.id, startNode);
  nodes.set(endNode.id, endNode);

  const connectVirtual = (virtual: RouteNode, candidate: CandidatePoint): void => {
    const ids = featureNodes.get(candidate.feature.id) ?? [];
    const first = nodes.get(ids[candidate.segmentIndex]);
    const second = nodes.get(ids[candidate.segmentIndex + 1]);
    if (first) addDirectionalEdges(edges, virtual, first, candidate.feature.properties.routeKind, candidate.feature);
    if (second) addDirectionalEdges(edges, virtual, second, candidate.feature.properties.routeKind, candidate.feature);
  };
  connectVirtual(startNode, startCandidate);
  connectVirtual(endNode, endCandidate);

  const initial: Cost = { values: [0, 0, 0, 0, 0, 0] };
  const distances = new Map<string, Cost>([[startNode.id, initial]]);
  const previous = new Map<string, { from: string; edge: RouteEdge }>();
  const queue = new MinHeap();
  queue.push({ id: startNode.id, cost: initial });
  while (true) {
    const current = queue.pop();
    if (!current) break;
    const known = distances.get(current.id);
    if (!known || compareCost(current.cost, known) !== 0) continue;
    if (current.id === endNode.id) break;
    for (const edge of edges.get(current.id) ?? []) {
      const nextCost = plusCost(current.cost, edge);
      const oldCost = distances.get(edge.to);
      if (!oldCost || compareCost(nextCost, oldCost) < 0) {
        distances.set(edge.to, nextCost);
        previous.set(edge.to, { from: current.id, edge });
        queue.push({ id: edge.to, cost: nextCost });
      }
    }
  }

  if (!distances.has(endNode.id)) throw new Error("Nie znalazłem połączenia między tymi punktami.");
  const path: Array<{ from: RouteNode; to: RouteNode; edge: RouteEdge }> = [];
  let currentId = endNode.id;
  while (currentId !== startNode.id) {
    const step = previous.get(currentId);
    if (!step) throw new Error("Nie udało się odtworzyć wyznaczonej trasy.");
    const from = nodes.get(step.from);
    const to = nodes.get(currentId);
    if (!from || !to) throw new Error("Nieprawidłowy graf trasy.");
    path.unshift({ from, to, edge: step.edge });
    currentId = step.from;
  }

  const sequence: RouteSequenceItem[] = [];
  const segments = path.map(({ from, to, edge }) => {
    if (edge.feature && edge.kind !== "connection") {
      const last = sequence[sequence.length - 1];
      if (!last || last.uid !== edge.feature.id) {
        sequence.push({ uid: edge.feature.id, label: edge.feature.properties.label, kind: edge.kind, color: edge.feature.properties.difficultyColor });
      }
    }
    return {
      type: "Feature" as const,
      properties: { kind: edge.kind, color: edge.kind === "lift" ? "#7c3aed" : edge.kind === "piste" ? edge.feature?.properties.difficultyColor ?? "#1557b0" : "#1557b0" },
      geometry: { type: "LineString" as const, coordinates: [from.coordinate, to.coordinate] },
    };
  });

  return {
    distanceM: path.reduce((total, step) => total + step.edge.distance, 0),
    sequence,
    segments: { type: "FeatureCollection", features: segments },
    start: startCandidate.coordinate,
    end: endCandidate.coordinate,
  };
}
