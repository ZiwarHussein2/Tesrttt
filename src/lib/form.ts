// FormData extraction helpers for server actions.

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function strOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === "" ? null : v;
}

export function num(fd: FormData, key: string, fallback = 0): number {
  const v = str(fd, key).replace(/,/g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function numOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key).replace(/,/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function dateOrNull(fd: FormData, key: string): Date | null {
  const v = str(fd, key);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function date(fd: FormData, key: string): Date {
  return dateOrNull(fd, key) ?? new Date();
}

// Normalize a Date to midnight UTC of its calendar day (for day-keyed records).
export function dayKey(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function isValidTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
