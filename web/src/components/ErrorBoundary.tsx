import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import AppBar from './AppBar';

// Rete per le pagine pesanti caricate a parte (il Villaggio con three.js, 16-10): se il pezzo non si scarica (dopo un
// deploy il file vecchio non c'e' piu') o la pagina lancia, si vede un messaggio con "Ricarica" invece di #root bianco.
export default class ErrorBoundary extends Component<{ children: ReactNode; titolo: string; onBack?: () => void }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error(`[${this.props.titolo}]`, err, info.componentStack); }
  render() {
    if (!this.state.err) return this.props.children;
    const ricarica = () => { const base = location.href.split('?')[0].split('#')[0]; location.replace(`${base}?v=${Date.now()}${location.hash}`); };
    return (
      <div className="screen">
        <AppBar title={this.props.titolo} onBack={this.props.onBack} backLabel="Home" />
        <div className="card muted center">
          <p>{this.props.titolo} non si è aperto: {this.state.err.message}</p>
          <button className="chip on" type="button" onClick={ricarica}>Ricarica</button>
        </div>
      </div>
    );
  }
}
