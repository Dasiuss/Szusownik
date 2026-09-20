import { AERIALWAY_LABELS } from "../lib/mapData.ts";
import cableCarUrl from "../assets/lift-icons/cable-car.png";
import chairLiftUrl from "../assets/lift-icons/chair-lift.png";
import gondolaUrl from "../assets/lift-icons/gondola.png";
import magicCarpetUrl from "../assets/lift-icons/magic-carpet.png";
import platterUrl from "../assets/lift-icons/platter.png";
import ropeTowUrl from "../assets/lift-icons/rope-tow.png";
import tBarUrl from "../assets/lift-icons/t-bar.png";

// Icons cut from docs/assets/ikonki.png (colorful icons on black background)
// into 64x64 transparent PNGs. They are bundled as data URLs, so the map and
// the React UI always work offline.
const LIFT_URL_BY_IMAGE_ID: Record<string, string> = {
  "lift-chair-lift": chairLiftUrl,
  "lift-gondola": gondolaUrl,
  "lift-cable-car": cableCarUrl,
  "lift-t-bar": tBarUrl,
  "lift-platter": platterUrl,
  "lift-magic-carpet": magicCarpetUrl,
  "lift-rope-tow": ropeTowUrl,
};

// aerialway -> shared map image id. Types missing from the source image reuse
// the closest icon: j-bar and drag_lift use the platter, mixed_lift uses the
// gondola. zip_line intentionally has no icon.
const LIFT_IMAGE_BY_AERIALWAY: Record<string, string> = {
  chair_lift: "lift-chair-lift",
  gondola: "lift-gondola",
  mixed_lift: "lift-gondola",
  cable_car: "lift-cable-car",
  "t-bar": "lift-t-bar",
  platter: "lift-platter",
  "j-bar": "lift-platter",
  drag_lift: "lift-platter",
  rope_tow: "lift-rope-tow",
  magic_carpet: "lift-magic-carpet",
};

export const LIFT_ICON_TYPES = Object.keys(LIFT_IMAGE_BY_AERIALWAY);
export const LIFT_EMPTY_IMAGE_ID = "lift-empty";

export const LIFT_MAP_IMAGES: ReadonlyArray<{ imageId: string; url: string }> = Object.entries(LIFT_URL_BY_IMAGE_ID).map(
  ([imageId, url]) => ({ imageId, url }),
);

function imageIdFor(aerialway: string): string | null {
  return LIFT_IMAGE_BY_AERIALWAY[aerialway] ?? null;
}

export function liftIconId(aerialway: string): string | null {
  return imageIdFor(aerialway);
}

export function liftIconUrl(aerialway: string): string | null {
  const imageId = imageIdFor(aerialway);
  return imageId ? (LIFT_URL_BY_IMAGE_ID[imageId] ?? null) : null;
}

export const LIFT_ICON_IMAGE_EXPRESSION: unknown[] = [
  "match",
  ["get", "aerialway"],
  ...Object.entries(LIFT_IMAGE_BY_AERIALWAY).flatMap(([aerialway, imageId]) => [aerialway, ["image", imageId]]),
  ["image", LIFT_EMPTY_IMAGE_ID],
];

export function LiftIcon({ aerialway, size = 16, className }: { aerialway: string; size?: number; className?: string }) {
  const url = liftIconUrl(aerialway);
  if (!url) return null;
  const label = AERIALWAY_LABELS[aerialway] ?? aerialway;

  return (
    <img
      alt={label}
      className={className}
      draggable={false}
      height={size}
      src={url}
      title={label}
      width={size}
    />
  );
}
