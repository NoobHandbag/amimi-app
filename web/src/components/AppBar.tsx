// Barra in alto di ogni schermata (tema A "Contrasto", 21-10): indietro come bottone tondo con l'icona,
// titolo piccolo al centro, azioni a destra. Prende il posto dei link "← Home" / "‹ Home" sparsi nelle pagine.
// backLabel dice DOVE si torna (Home, Catalogo, Tutti i fornitori...): diventa il nome accessibile del bottone.

import type { ReactNode } from 'react';
import Icon from './Icon';

export default function AppBar({ title, onBack, backLabel = 'Home', backAria, actions }: {
  title?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  backAria?: string;   // nome completo del bottone quando la destinazione non ha un nome (es. "Indietro")
  actions?: ReactNode;
}) {
  return (
    <header className="appbar">
      <div className="appbar-l">
        {onBack && (
          <button className="appbar-back" type="button" onClick={onBack} aria-label={backAria ?? `Torna a ${backLabel}`} title={backAria ?? `Torna a ${backLabel}`}>
            <Icon name="back" size={20} />
          </button>
        )}
      </div>
      {title != null && title !== '' ? <h1 className="appbar-title">{title}</h1> : <span />}
      <div className="appbar-r">{actions}</div>
    </header>
  );
}
