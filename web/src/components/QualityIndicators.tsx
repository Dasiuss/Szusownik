import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";
import type { PeakQuality } from "../lib/runs.ts";

type QualityKey = keyof PeakQuality;
type Glyph = "g" | "curve" | "satellite";

const TOOLTIP_MAX_WIDTH = 230;
const TOOLTIP_ESTIMATED_HEIGHT = 72;
const VIEWPORT_MARGIN = 8;

const CHECKS: { key: QualityKey; title: string; glyph: Glyph; description: string }[] = [
  {
    key: "accelerationOk",
    title: "Przyspieszenie",
    glyph: "g",
    description: "Kolejne wzrosty prędkości w oknie ±1 s wymagają nie więcej niż 1 g (9,81 m/s²) dodatniego przyspieszenia. Spadki prędkości są ignorowane.",
  },
  {
    key: "gnssOk",
    title: "Jakość fixa GNSS",
    glyph: "satellite",
    description: "Ważny fix, co najmniej 5 satelitów, HDOP ≤ 2,5 oraz świeżość pól GNSS (≤ min(500 ms, 2 × mediana odstępu próbek)).",
  },
  {
    key: "shapeOk",
    title: "Kształt piku",
    glyph: "curve",
    description: "Prędkość pasuje do odpornego łuku kwadratowego w oknie ±1 s (≥5 próbek, w tym ≥2 z każdej strony). Reszta kandydata ≤ max(1, 3 × 1,4826 × MAD).",
  },
];

function positionFor(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const centered = rect.left + rect.width / 2 - TOOLTIP_MAX_WIDTH / 2;
  const left = Math.min(
    Math.max(centered, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - TOOLTIP_MAX_WIDTH - VIEWPORT_MARGIN),
  );
  const above = rect.top >= TOOLTIP_ESTIMATED_HEIGHT + VIEWPORT_MARGIN * 2;
  return {
    left,
    top: above ? rect.top - VIEWPORT_MARGIN : rect.bottom + VIEWPORT_MARGIN,
    placement: above ? "above" : "below",
  } as const;
}

interface TooltipState {
  key: QualityKey;
  pinned: boolean;
  left: number;
  top: number;
  placement: "above" | "below";
}

export function QualityIndicators({ quality }: { quality: PeakQuality }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!tooltip) return;
    const close = () => setTooltip(null);
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [tooltip]);

  const show = (key: QualityKey, element: HTMLElement) => {
    setTooltip((current) => (current?.key === key ? current : { key, pinned: false, ...positionFor(element) }));
  };
  const hide = (key: QualityKey) => {
    setTooltip((current) => (current?.key === key && !current.pinned ? null : current));
  };
  const toggle = (key: QualityKey, element: HTMLElement) => {
    setTooltip((current) => (current?.key === key && current.pinned ? null : { key, pinned: true, ...positionFor(element) }));
  };

  return (
    <span className="quality-indicators" ref={containerRef} role="group" aria-label="Wskaźniki jakości prędkości">
      {CHECKS.map(({ key, title, glyph, description }) => {
        const passed = quality[key];
        const open = tooltip?.key === key;
        return (
          <span className="quality-indicator-wrap" key={key}>
            <span
              aria-label={`${title}: ${passed ? "spełnione" : "niespełnione"}`}
              className={`quality-indicator${passed ? " quality-indicator-passed" : " quality-indicator-failed"}`}
              onClick={(event) => toggle(key, event.currentTarget)}
              onMouseEnter={(event) => show(key, event.currentTarget)}
              onMouseLeave={() => hide(key)}
              role="img"
            >
              {glyph === "g" ? (
                <span className="quality-glyph quality-glyph-g">g</span>
              ) : (
                <span className={`quality-glyph quality-glyph-${glyph}`}><Icon name={glyph} size={13} /></span>
              )}
            </span>
            {open && (
              <span
                className={`quality-tooltip quality-tooltip-${tooltip.placement}`}
                role="tooltip"
                style={{ left: tooltip.left, top: tooltip.top }}
              >
                <strong className="quality-tooltip-title">{title}</strong>
                <span className="quality-tooltip-text">{description}</span>
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
