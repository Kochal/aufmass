import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function SortHead({
  col,
  label,
  sortCol,
  sortDir,
  onSort,
  className,
  align = "start",
}: {
  col: string;
  label: string;
  sortCol: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  className?: string;
  align?: "start" | "end";
}) {
  const active = sortCol === col;
  return (
    <TableHead
      className={cn("cursor-pointer select-none", className)}
      onClick={() => onSort(col)}
    >
      <div className={cn("flex items-center gap-1 whitespace-nowrap", align === "end" && "justify-end")}>
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-30" />
        )}
      </div>
    </TableHead>
  );
}
