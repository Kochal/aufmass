/**
 * Keyboard navigation for the quote review screen.
 *
 * Goal: clear a 200-line LV without touching the mouse.
 *
 *   j / ↓     move to next position
 *   k / ↑     move to previous position
 *   a / Enter accept the current match (sets match_status='confirmed')
 *   c         open the catalog picker to correct the match
 *   x         resolve the first unresolved soft flag on the position
 *
 * The handler skips when focus is inside an input, textarea, or select so
 * typing in the CatalogPicker search box or the DevLogin form doesn't fire
 * shortcuts.
 */
import { useEffect } from "react";

interface UsePositionKeyboardProps {
  count: number;
  activeIndex: number;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  onAccept: (index: number) => void;
  onOpenPicker: (index: number) => void;
  onResolveFlag: (index: number) => void;
  /** Disable shortcuts when a dialog/picker is open */
  disabled?: boolean;
}

export function usePositionKeyboard({
  count,
  activeIndex,
  setActiveIndex,
  onAccept,
  onOpenPicker,
  onResolveFlag,
  disabled = false,
}: UsePositionKeyboardProps) {
  useEffect(() => {
    if (disabled) return;

    const handler = (e: KeyboardEvent) => {
      // Skip when typing in a form element
      const tag = (e.target as HTMLElement).tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, count - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "a":
        case "Enter":
          e.preventDefault();
          onAccept(activeIndex);
          break;
        case "c":
          e.preventDefault();
          onOpenPicker(activeIndex);
          break;
        case "x":
          e.preventDefault();
          onResolveFlag(activeIndex);
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [disabled, count, activeIndex, setActiveIndex, onAccept, onOpenPicker, onResolveFlag]);
}
