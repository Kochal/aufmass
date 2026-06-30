/**
 * MengeInput — controlled Menge field with a live arithmetic calculator.
 *
 * The user types a free-text expression like "2 * (8+9) / 3".  The component
 * evaluates it client-side (no API call), shows a live preview `= 11,333`, and
 * calls onChange with the resolved decimal string + the original formula so both
 * can be persisted (non-negotiable #6: every value traceable to its source).
 *
 * Behaviour:
 *   - empty input        → onChange("", null)
 *   - plain number       → onChange(number_str, null)  — no formula to store
 *   - valid expression   → onChange(result_str, expr)  + preview shown
 *   - invalid expression → onChange("", null)  + amber error shown
 *   - German comma (3,5) → normalised to 3.5 by the parser
 *
 * The component is seeded once on mount via the `formula` prop (if set) or the
 * `value` prop.  The caller should add key={position.id} when reusing for
 * different positions so the seed resets.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatMenge } from "@/lib/utils";
import { evaluateExpression, isExpression } from "@/lib/calc";
import { cn } from "@/lib/utils";

interface MengeInputProps {
  /** Current resolved decimal value (from DB / form state). */
  value: string;
  /** Persisted formula, if any (from DB / form state). */
  formula: string | null;
  /** Called whenever the user changes the field.
   *  menge = resolved decimal string ("" when invalid or empty).
   *  formula = raw expression string, or null for plain numbers / empty. */
  onChange: (menge: string, formula: string | null) => void;
  id?: string;
  placeholder?: string;
  className?: string;
}

export function MengeInput({ value, formula, onChange, id, placeholder = "z. B. 2*(8+9)", className }: MengeInputProps) {
  // Local display state — fully owned by this component.
  // The parent receives resolved values via onChange; it never pushes expr back in.
  // To reset on a new position, the parent must pass key={position.id}.
  const [expr, setExpr] = useState(() => formula ?? value);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setExpr(raw);

    if (!raw.trim()) {
      setError(null);
      setPreview(null);
      onChange("", null);
      return;
    }

    const { value: result, error: err } = evaluateExpression(raw);

    if (err) {
      setError(err);
      setPreview(null);
      onChange("", null); // don't persist a stale number from the previous valid state
      return;
    }

    setError(null);

    if (result === null) {
      setPreview(null);
      onChange("", null);
      return;
    }

    const resultStr = String(result);

    if (isExpression(raw)) {
      setPreview(formatMenge(resultStr, undefined));
      onChange(resultStr, raw.trim());
    } else {
      setPreview(null);
      onChange(resultStr, null);
    }
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      <Input
        id={id}
        value={expr}
        onChange={handleChange}
        placeholder={placeholder}
        className={cn(error && "border-amber-500 focus-visible:ring-amber-500")}
        autoComplete="off"
        inputMode="decimal"
      />
      {preview && !error && (
        <p className="text-xs text-muted-foreground font-mono pl-1">= {preview}</p>
      )}
      {error && (
        <p className="text-xs text-amber-600 pl-1">{error}</p>
      )}
    </div>
  );
}
