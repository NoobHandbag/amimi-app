// Number input with visible −/+ steppers (native spinners are hidden on mobile).
export default function NumberStepper({ value, onChange, step = 1, min = 0, decimal = false, placeholder }: {
  value: string; onChange: (v: string) => void; step?: number; min?: number; decimal?: boolean; placeholder?: string;
}) {
  const adj = (dir: number) => {
    const n = (Number(value) || 0) + dir * step;
    const clamped = Math.max(min, n);
    onChange(String(decimal ? Math.round(clamped * 100) / 100 : Math.round(clamped)));
  };
  return (
    <div className="stepper">
      <button type="button" className="stepbtn" onClick={() => adj(-1)} aria-label="meno">−</button>
      <input className="num" type="number" inputMode={decimal ? 'decimal' : 'numeric'} value={value}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <button type="button" className="stepbtn" onClick={() => adj(1)} aria-label="più">+</button>
    </div>
  );
}
