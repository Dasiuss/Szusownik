export type IconName = "activity" | "archive" | "bluetooth" | "chevron" | "download" | "gauge" | "map" | "mountain" | "play" | "route" | "settings" | "trash" | "edit" | "check" | "x" | "refresh";

const paths: Record<IconName, string> = {
  activity: "M3 12h4l2-7 4 14 2-7h6",
  archive: "M4 7h16v13H4z M3 4h18v3H3z M9 11h6",
  bluetooth: "M12 3v18l5-5-10-8 10-8-5-5 M7 8l10 8",
  chevron: "m9 18 6-6-6-6",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 21h16",
  gauge: "M4.9 19a9 9 0 1 1 14.2 0 M12 12l4-4",
  map: "m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Zm0-15v15m6-12v15",
  mountain: "m3 20 6-12 3 5 2-3 7 10H3Zm10-5 2-3 3 5",
  play: "m8 5 11 7-11 7V5Z",
  route: "M5 19c5 0 4-14 9-14h5M5 5h4m5 14h5",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.5V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.6-1H6v-2.5h.4A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2.5V5a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.6 1h.2v2.5H21a1.7 1.7 0 0 0-1.6 1.5Z",
  trash: "M5 7h14m-9 4v6m4-6v6M9 7V4h6v3m-9 0 1 13h10l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
  check: "m5 12 4 4L19 6",
  x: "m6 6 12 12M18 6 6 18",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 5v4h4m-4 2a8 8 0 0 0 14.9 3M20 19v-4h-4",
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={paths[name]} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
