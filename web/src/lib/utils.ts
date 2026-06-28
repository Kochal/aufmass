import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes safely (shadcn convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a Decimal string (as returned by the API) as a Euro amount.
 * The API serialises Python Decimal as a JSON string to avoid float rounding.
 */
export function formatEuro(value: string | null | undefined): string {
  if (value == null) return "—";
  const num = parseFloat(value);
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format a Decimal quantity string with up to 3 decimal places (German locale).
 */
export function formatMenge(
  value: string | null | undefined,
  einheit?: string | null,
): string {
  if (value == null) return "—";
  const num = parseFloat(value);
  if (isNaN(num)) return "—";
  const formatted = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(num);
  return einheit ? `${formatted} ${einheit}` : formatted;
}

/**
 * Parse a Decimal string to a number for comparison (e.g. confidence thresholds).
 * Returns null if the value is missing or not parseable.
 */
export function parseDecimal(value: string | null | undefined): number | null {
  if (value == null) return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

/**
 * Derive the confidence tier from a confidence score string.
 * Used to select the correct confidence-* CSS token.
 */
export type ConfidenceTier = "high" | "mid" | "low";

export function confidenceTier(
  confidence: string | null | undefined,
  matchStatus?: string,
): ConfidenceTier {
  if (matchStatus === "confirmed") return "high";
  const num = parseDecimal(confidence);
  if (num === null) return "low";
  if (num >= 0.85) return "high";
  if (num >= 0.6) return "mid";
  return "low";
}
