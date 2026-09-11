'use client';

/**
 * The one screen. Everything on it is a fact the agent recorded: position, the two observed
 * windows with their exact block ranges, share-value growth and the differential, the decision and
 * the rule that produced it, the policy and the latest allow/deny outcomes, the pipeline
 * provenance from the generated MCP's `pipeline_status` shape, transaction links, and who controls
 * the wallet plus the command that revokes the agent.
 *
 * It re-reads /api/state every 20 seconds and holds no signing key of any kind. The layout is a
 * treasurer's instrument panel: masthead, decision, position, observed window, guardrail, three
 * quiet columns, ledger — separated by space rather than by boxes, one dominant reading each.
 */
import {useCallback, useEffect, useState} from 'react';
import type {LoadedState} from '../lib/state';
import {Masthead} from './components/Masthead';
import {DecisionBand, PositionPanel} from './components/DecisionBand';
import {GuardrailStrip, ObservedWindow} from './components/ObservedWindow';
import {ControlColumn, PipelineColumn, PolicyColumn} from './components/Columns';
import {Ledger} from './components/Ledger';

export default function Dashboard({initial}: {initial: LoadedState}) {
  const [state, setState] = useState<LoadedState>(initial);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/state', {cache: 'no-store'});
      if (res.ok) setState((await res.json()) as LoadedState);
    } catch {
      // keep the last good screen rather than blanking it
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const snap = state.snapshot;

  if (!snap) {
    return (
      <main className="wrap">
        <header className="masthead seq">
          <div>
            <h1>Vaultpilot</h1>
            <p className="tagline">Idle USDC, moved only inside the treasurer&apos;s policy.</p>
          </div>
          <div className="masthead-status">
            <span className="stamp warn">No state yet</span>
            <p className="stampline crossfade" key={state.readAt}>
              read {state.readAt} · via {state.origin}
            </p>
            <button type="button" className="textbtn" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? 'Reading…' : 'Refresh'}
            </button>
          </div>
        </header>
        <section className="seq" style={{animationDelay: '60ms'}}>
          <h2 className="title">Nothing has been decided yet</h2>
          <p className="prose lead" style={{marginTop: 10}}>
            {state.error ?? 'The agent has not written a cycle, and the read-only state service is not answering.'}
          </p>
          <pre className="cmd">cd apps/vaultpilot &amp;&amp; pnpm agent:once</pre>
        </section>
      </main>
    );
  }

  return (
    <main className="wrap">
      <Masthead
        snap={snap}
        origin={state.origin}
        readAt={state.readAt}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
      />

      <div className="grid">
        <div className="c8">
          <DecisionBand snap={snap} />
        </div>
        <div className="c4">
          <PositionPanel snap={snap} />
        </div>
      </div>

      <ObservedWindow snap={snap} />

      <GuardrailStrip snap={snap} />

      <div className="grid">
        <PolicyColumn snap={snap} />
        <PipelineColumn snap={snap} />
        <ControlColumn snap={snap} />
      </div>

      <Ledger snap={snap} readAt={state.readAt} origin={state.origin} originDetail={state.originDetail} />
    </main>
  );
}
