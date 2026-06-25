import { useMemo, useState } from 'react';

/** Click-to-sort for plain tables. Returns sorted rows + a <Th> that renders a sortable header. */
export function useSort<T extends Record<string, unknown>>(rows: T[], initialKey?: keyof T, initialDir: 'asc' | 'desc' = 'asc') {
  const [key, setKey] = useState<keyof T | undefined>(initialKey);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);

  const sorted = useMemo(() => {
    if (!key) return rows;
    const arr = [...rows].sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      return String(va).localeCompare(String(vb), 'it', { numeric: true });
    });
    return dir === 'desc' ? arr.reverse() : arr;
  }, [rows, key, dir]);

  function toggle(k: keyof T) {
    if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setKey(k); setDir('asc'); }
  }
  const arrow = (k: keyof T) => (key === k ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  return { sorted, toggle, arrow };
}
