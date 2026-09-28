import { createRoot } from 'react-dom/client';
import type { ValueType } from '../core/types';
import type { Evaluation } from '../host/engine';
import { App } from './App';
import '../style/panel.css';

export interface Session { uuid: string; dsl: string; macro: string }
export interface PanelDeps {
  evaluate(dsl: string, uuid: string): Promise<Evaluation>;
  save(uuid: string, oldMacro: string, dsl: string): Promise<string>;
  setType(key: string, type: ValueType): Promise<void>;
  jump(uuid: string): Promise<void>;
  close(): void;
  report(e: unknown): void;
}

export function mountPanel(el: HTMLElement, deps: PanelDeps) {
  const root = createRoot(el);
  let session: Session | null = null;
  let nonce = 0;
  let tick = 0;
  const draw = () => session && root.render(<App key={nonce} session={session} deps={deps} tick={tick} />);
  return {
    /** Show a fresh panel for one macro; the key remount drops any previous edits. */
    open(s: Session) {
      session = s;
      nonce++;
      draw();
    },
    /** Re-run the current query after the graph changed. */
    refresh() {
      tick++;
      draw();
    },
  };
}
