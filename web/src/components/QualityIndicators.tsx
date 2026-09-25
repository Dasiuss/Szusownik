import { Icon } from "./Icon.tsx";
import type { PeakQuality } from "../lib/runs.ts";

const LABELS = [
  ["Przyspieszenie", "accelerationOk"],
  ["GNSS", "gnssOk"],
  ["Kształt piku", "shapeOk"],
] as const;

export function QualityIndicators({ quality }: { quality: PeakQuality }) {
  return (
    <span className="quality-indicators" role="group" aria-label="Wskaźniki jakości prędkości">
      {LABELS.map(([label, key]) => {
        const passed = quality[key];
        return (
          <span
            aria-label={`${label}: ${passed ? "spełnione" : "niespełnione"}`}
            className={`quality-indicator${passed ? " quality-indicator-passed" : " quality-indicator-failed"}`}
            key={key}
            role="img"
          >
            <Icon name={passed ? "check" : "x"} size={13} />
          </span>
        );
      })}
    </span>
  );
}
