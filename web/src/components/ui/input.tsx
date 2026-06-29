import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InputProps extends React.ComponentProps<"input"> {
  onClear?: () => void;
}

const BASE =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors " +
  "file:border-0 file:bg-transparent file:text-sm file:font-medium " +
  "placeholder:text-muted-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

function Input({ className, type, onClear, value, onChange, ...props }: InputProps) {
  // Clearable when type and props allow it — determined once, never changes per render.
  // Do NOT derive from value: switching the wrapper div on/off based on value causes
  // the <input> element to unmount/remount on the first keystroke, dropping focus.
  const canClear =
    type !== "file" &&
    type !== "date" &&
    type !== "time" &&
    type !== "datetime-local" &&
    type !== "number" &&
    (onClear !== undefined || onChange !== undefined);

  const hasValue = typeof value === "string" && value !== "";

  function handleClear() {
    if (onClear) {
      onClear();
    } else {
      onChange?.({ target: { value: "" } } as React.ChangeEvent<HTMLInputElement>);
    }
  }

  if (!canClear) {
    return (
      <input
        type={type}
        value={value}
        onChange={onChange}
        className={cn(BASE, className)}
        {...props}
      />
    );
  }

  // Wrapper div is always rendered (stable DOM). X button is always in the DOM too
  // but invisible when empty — avoids re-mount on first keystroke.
  return (
    <div className={cn("relative w-full", className)}>
      <input
        type={type}
        value={value}
        onChange={onChange}
        className={cn(BASE, "pr-7")}
        {...props}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleClear}
        tabIndex={-1}
        aria-label="Leeren"
        className={cn(
          "absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground",
          !hasValue && "invisible",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export { Input };
