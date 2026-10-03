import { useEffect, useRef, type ReactNode } from "react";
import { panDomain, zoomDomain, type DistanceDomain } from "../lib/chart.ts";

interface ChartZoomSurfaceProps {
  domain: DistanceDomain;
  dataMaxKm: number;
  onDomainChange: (next: DistanceDomain) => void;
  onReset: () => void;
  className?: string;
  children: ReactNode;
}

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface PinchState {
  startDistance: number;
  startDomain: DistanceDomain;
  anchor: number;
}

const WHEEL_ZOOM_SENSITIVITY = 0.002;
const PAN_AXIS_THRESHOLD_PX = 4;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP_PX = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Warstwa gestów na wykresie: Ctrl+kółko (oraz pinch na trackpadzie, który
 * przychodzi jako Ctrl+wheel) przybliża, przeciągnięcie poziome przesuwa,
 * dwa palce na dotyku przybliżają, podwójny tap/klik resetuje. Czyste kółko
 * i pionowy ruch palca zostają dla przewijania strony (touch-action: pan-y).
 */
export function ChartZoomSurface({
  domain,
  dataMaxKm,
  onDomainChange,
  onReset,
  className,
  children,
}: ChartZoomSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const domainRef = useRef(domain);
  const dataMaxRef = useRef(dataMaxKm);
  const onChangeRef = useRef(onDomainChange);
  const onResetRef = useRef(onReset);
  const pointersRef = useRef(new Map<number, PointerState>());
  const pinchRef = useRef<PinchState | null>(null);
  const suppressPanRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  domainRef.current = domain;
  dataMaxRef.current = dataMaxKm;
  onChangeRef.current = onDomainChange;
  onResetRef.current = onReset;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const widthOf = () => element.getBoundingClientRect().width;

    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return; // czyste kółko przewija stronę
      const width = widthOf();
      if (width <= 0) return;
      event.preventDefault();
      const anchor = clamp((event.clientX - element.getBoundingClientRect().left) / width, 0, 1);
      const factor = Math.exp(event.deltaY * WHEEL_ZOOM_SENSITIVITY);
      onChangeRef.current(zoomDomain(domainRef.current, dataMaxRef.current, factor, anchor));
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // setPointerCapture może rzucić, gdy wskaźnik zniknął — ignorujemy.
      }
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
      });
      if (pointersRef.current.size === 2) {
        const width = widthOf();
        const [a, b] = [...pointersRef.current.values()];
        if (width > 0) {
          pinchRef.current = {
            startDistance: Math.hypot(a.x - b.x, a.y - b.y),
            startDomain: domainRef.current,
            anchor: clamp(((a.x + b.x) / 2 - element.getBoundingClientRect().left) / width, 0, 1),
          };
        }
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const pointers = pointersRef.current;
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return;
      const width = widthOf();
      if (width <= 0) return;

      if (pointers.size >= 2) {
        const pinch = pinchRef.current;
        const [a, b] = [...pointers.values()];
        if (pinch) {
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > 0 && pinch.startDistance > 0) {
            const factor = pinch.startDistance / distance;
            onChangeRef.current(zoomDomain(pinch.startDomain, dataMaxRef.current, factor, pinch.anchor));
          }
        }
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        return;
      }

      if (suppressPanRef.current) {
        suppressPanRef.current = false;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.startX = event.clientX;
        pointer.startY = event.clientY;
        return;
      }

      const dx = event.clientX - pointer.x;
      const totalDx = event.clientX - pointer.startX;
      const totalDy = event.clientY - pointer.startY;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (Math.abs(totalDx) > Math.abs(totalDy) && Math.abs(totalDx) > PAN_AXIS_THRESHOLD_PX) {
        const span = domainRef.current[1] - domainRef.current[0];
        onChangeRef.current(panDomain(domainRef.current, dataMaxRef.current, -(dx / width) * span));
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        // już zwolniony
      }
      const wasPinch = pointersRef.current.size >= 2;
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) {
        pinchRef.current = null;
        if (wasPinch) suppressPanRef.current = true;
      }

      if (event.pointerType !== "mouse" && !wasPinch) {
        const now = Date.now();
        const last = lastTapRef.current;
        if (
          last &&
          now - last.time < DOUBLE_TAP_MS &&
          Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_TAP_SLOP_PX
        ) {
          lastTapRef.current = null;
          suppressPanRef.current = true;
          onResetRef.current();
        } else {
          lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
        }
      }
    };

    const handleDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      onResetRef.current();
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", handlePointerUp);
    element.addEventListener("pointercancel", handlePointerUp);
    element.addEventListener("dblclick", handleDoubleClick);

    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", handlePointerUp);
      element.removeEventListener("pointercancel", handlePointerUp);
      element.removeEventListener("dblclick", handleDoubleClick);
    };
  }, []);

  return (
    <div className={className} ref={ref}>
      {children}
    </div>
  );
}
