import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InputProps extends React.ComponentProps<"input"> {
  onClear?: () => void;
}

function Input({ className, type, onClear, value, onChange, ...props }: InputProps) {
  const showClear =
    type !== "file" &&
    type !== "date" &&
    type !== "time" &&
    type !== "datetime-local" &&
    type !== "number" &&
    typeof value === "string" &&
    value !== "" &&
    (onClear !== undefined || onChange !== undefined);

  function handleClear() {
    if (onClear) {
      onClear();
    } else {
      onChange?.({ target: { value: "" } } as React.ChangeEvent<HTMLInputElement>);
    }
  }

  const inputEl = (
    <input
      type={type}
      value={value}
      onChange={onChange}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        showClear ? "pr-7" : className,
      )}
      {...props}
    />
  );

  if (!showClear) return inputEl;

  return (
    <div className={cn("relative w-full", className)}>
      {inputEl}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleClear}
        tabIndex={-1}
        aria-label="Leeren"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export { Input };
