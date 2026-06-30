import { useState } from "react";
import { X } from "lucide-react";
import { formatMenge } from "@/lib/utils";
import { evaluateExpression, isExpression } from "@/lib/calc";
import { cn } from "@/lib/utils";

interface MengeInputProps {
  value: string;
  formula: string | null;
  onChange: (menge: string, formula: string | null) => void;
  id?: string;
  placeholder?: string;
  className?: string;
}

const TEXTAREA_BASE =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors " +
  "placeholder:text-muted-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "resize-y min-h-[5rem] pr-7 font-mono";

export function MengeInput({ value, formula, onChange, id, placeholder = "z. B.\n3,5 * 2,8\n+ 4,2 * 1,6", className }: MengeInputProps) {
  // Local display state — fully owned by this component.
  // The parent receives resolved values via onChange; it never pushes expr back in.
  // To reset on a new position, the parent must pass key={position.id}.
  const [expr, setExpr] = useState(() => formula ?? value);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
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
      onChange("", null);
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

  function handleClear() {
    setExpr("");
    setError(null);
    setPreview(null);
    onChange("", null);
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      <div className="relative">
        <textarea
          id={id}
          value={expr}
          onChange={handleChange}
          placeholder={placeholder}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          className={cn(TEXTAREA_BASE, error && "border-amber-500 focus-visible:ring-amber-500")}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClear}
          tabIndex={-1}
          aria-label="Leeren"
          className={cn(
            "absolute right-2 top-2 text-muted-foreground hover:text-foreground",
            !expr && "invisible",
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {preview && !error && (
        <p className="text-xs text-muted-foreground font-mono pl-1">= {preview}</p>
      )}
      {error && (
        <p className="text-xs text-amber-600 pl-1">{error}</p>
      )}
    </div>
  );
}
