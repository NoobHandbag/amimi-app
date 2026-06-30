import { exportCSV } from '../lib/csv';

// Clean download icon (like the master dashboard's export), not a text chip.
export default function ExportBtn({ name, rows }: { name: string; rows: () => Record<string, unknown>[] }) {
  return (
    <button className="exp" type="button" title="Esporta CSV" aria-label="Esporta CSV" onClick={() => exportCSV(name, rows())}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span className="explbl">CSV</span>
    </button>
  );
}
