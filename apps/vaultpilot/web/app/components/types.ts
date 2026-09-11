/**
 * Every view type on this screen is derived from the agent's own `Snapshot`, so the UI cannot
 * invent a field or drift from the decision service. Types only: no agent code reaches the bundle.
 */
import type {LoadedState} from '../../lib/state';

export type Snap = NonNullable<LoadedState['snapshot']>;
export type VaultView = Snap['vaults'][number];
export type DecisionView = Snap['decision'];
export type Evidence = DecisionView['evidence'];
export type WindowEvidence = Evidence['observedWindow']['vaults'][number];
export type GrowthEvidence = NonNullable<Evidence['growthA']>;
export type GuardrailEvidence = Evidence['guardrail']['evaluated'][number];
export type LedgerRow = Snap['ledger']['recent'][number];
export type Refusal = DecisionView['refusals'][number];

export function iso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}
