// The workspace time zone. Undefined follows the viewer's browser.
let zone: string | undefined;

export function setWorkspaceTimeZone(value: string | null) {
  zone = value ?? undefined;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function activeTimeZone(): string {
  return zone ?? browserTimeZone();
}

const stampOptions: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

/** Formats a moment in the workspace time zone. Defaults to "11 Oct, 14:05". */
export function formatMoment(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = stampOptions,
): string {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone }).format(new Date(value));
}

/** The hour of day (0 to 23) in the workspace time zone. */
export function workspaceHour(value: Date = new Date()): number {
  return Number(formatMoment(value, { hour: "numeric", hourCycle: "h23" }));
}

/** Every IANA zone the browser knows, with UTC first. */
export function allTimeZones(): string[] {
  const zones = Intl.supportedValuesOf?.("timeZone") ?? [];
  return ["UTC", ...zones.filter((item) => item !== "UTC")];
}

/** "Europe/Stockholm" reads as "Europe / Stockholm (GMT+2)". */
export function timeZoneLabel(value: string): string {
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: value, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  const name = value.replaceAll("_", " ").replaceAll("/", " / ");
  return offset && offset !== value ? `${name} (${offset})` : name;
}
