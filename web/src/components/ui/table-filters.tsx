export function ColFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Filter…"
      className="w-full h-6 text-xs px-2 rounded border border-input bg-background placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

export function ColSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-6 text-xs px-1 rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <option value="">Alle</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
