/**
 * Vaultpilot decision service. Pure function, no I/O: everything it needs is in `DecisionInput`,
 * so the same code runs against ClickHouse, against fixtures and in tests.
 *
 * The rule (docs/PROJECT.md section 4.3, verbatim requirements):
 *   rotate to the other approved vault when observed-window share-value growth differs by more
 *   than a configured minimum (covering gas and friction), subject to
 *     - a cooldown,
 *     - an outflow guardrail on the destination,
 *     - a staleness refusal from `pipeline_status`,
 *     - a maxWithdraw and liquidity check,
 *     - exclusion of our own withdrawals from the guardrail,
 *     - and an idempotency key.
 *
 * Everything that cannot be evaluated is a refusal, and every refusal means `hold`: the service is
 * fail-closed in the same way the MCP server is. Refusals are accumulated (not short-circuited) so
 * the UI can show every reason the agent did not act.
 *
 * Vocabulary: "share value", "share-value growth", "observed window", "execution rate". The
 * observed window is measured on the data (first/last observation block and timestamp), never on
 * the clock, and observations are never interpolated.
 */
import {bpsOf, formatDecimal, parseDecimal} from './decimal.js';

export interface DecisionConfig {
  /** Both vaults must have an observed window at least this long before any rotation. */
  minObservationHours: number;
  /**
   * Minimum share-value growth differential over the observed window, in basis points, that
   * justifies moving. Gas for Earn actions is sponsored by the app (Privy "App pays"), so the
   * friction of a rotation is the time out of a vault plus the two extra actions: 2 bps of the
   * position (0.01 USDC on 50 USDC) is the default floor. Configure it with
   * VAULTPILOT_MIN_DIFFERENTIAL_BPS; it is never lowered to manufacture a rotation.
   */
  minDifferentialBps: number;
  /** Minimum hours between rotations. */
  cooldownHours: number;
  /** Destination is skipped when its 24h net outflow (ours excluded) exceeds this share of its observed total assets. */
  outflowGuardrailBps: number;
  /** Sink head may trail the chain head by at most this many blocks (same default as the MCP). */
  maxLagBlocks: number;
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  minObservationHours: 24,
  minDifferentialBps: 2,
  cooldownHours: 6,
  outflowGuardrailBps: 1000,
  maxLagBlocks: 300,
};

export interface VaultRef {
  /** Privy vault id (per-app, issued after the fee wrapper is deployed in the Dashboard). */
  vaultId: string;
  /** The observed ERC-4626 vault, lowercase 0x hex, as pinned in the Deployment Receipt. */
  vaultAddress: string;
  /** Privy fee-wrapper address (GET /v1/earn/ethereum/vaults/{id}.vault_address), lowercase. */
  wrapperAddress: string | null;
  label: string;
}

/** One row of the `share_value_growth` view (call_ok observations only, never interpolated). */
export interface GrowthObservation {
  vaultAddress: string;
  firstBlockNumber: number;
  firstBlockTimestamp: number;
  firstAssetsPerShareNormalized: string;
  lastBlockNumber: number;
  lastBlockTimestamp: number;
  lastAssetsPerShareNormalized: string;
  /** last / first - 1; null when the first observation was not computable. */
  growth: number | null;
  observedHours: number;
  observationCount: number;
}

/** One row of `vault_flows_24h`, plus the split of flows that are ours. */
export interface FlowWindow {
  vaultAddress: string;
  windowStartTimestamp: number;
  windowEndTimestamp: number;
  assetsInNormalized: string;
  assetsOutNormalized: string;
  netAssetsNormalized: string;
  /** deposits whose caller/owner/receiver is the business wallet or one of our fee wrappers */
  selfAssetsInNormalized: string;
  /** withdrawals whose caller/owner/receiver is the business wallet or one of our fee wrappers */
  selfAssetsOutNormalized: string;
  depositCount: number;
  withdrawCount: number;
  flowsWithoutMetadata: number;
}

/** Denominator for the guardrail: totalAssets at the newest call_ok observation. */
export interface ObservedSize {
  vaultAddress: string;
  totalAssetsNormalized: string;
  blockNumber: number;
}

/** The subset of the MCP's `pipeline_status` the decision depends on. */
export interface PipelineHealth {
  refused: boolean;
  reason: string | null;
  detail: string | null;
  headBlock: number | null;
  chainHead: number | null;
  lagBlocks: number | null;
  chainId: number | null;
  checkedAt: string;
}

export interface PositionSnapshot {
  vaultId: string;
  /** Privy `assets_in_vault`, base units. */
  assetsInVaultRaw: string;
  /** the same amount as a decimal string of the asset (USDC: 6 dp) */
  assetsNormalized: string;
  assetDecimals: number;
  assetSymbol: string;
}

export interface CooldownState {
  /** ISO timestamp of the last executed rotation, from the ledger. */
  lastRotationAt: string | null;
  /** newest observation block the last rotation was decided on, from the ledger. */
  lastRotationBlock: number | null;
  /** idempotency keys the executor has already acted on (executed or partially executed). */
  executedKeys: string[];
}

export interface LiquidityFact {
  vaultId: string;
  /** vault details `available_liquidity_usd` (USDC vaults: 1 USD == 1 USDC), decimal string. */
  availableNormalized: string | null;
  /** the most we could withdraw right now, decimal string; null when unknown. */
  maxWithdrawNormalized: string | null;
}

export interface DecisionInput {
  /** unix seconds; injected so tests and the UI are deterministic. */
  now: number;
  vaults: [VaultRef, VaultRef];
  positions: PositionSnapshot[];
  growth: GrowthObservation[];
  flows: FlowWindow[];
  sizes: ObservedSize[];
  pipeline: PipelineHealth;
  cooldown: CooldownState;
  config: DecisionConfig;
  liquidity?: LiquidityFact[];
}

export interface Refusal {
  code: string;
  message: string;
  detail?: unknown;
}

export interface ObservedWindowEvidence {
  vaultId: string;
  vaultAddress: string;
  label: string;
  firstBlockNumber: number;
  lastBlockNumber: number;
  firstBlockTimestamp: number;
  lastBlockTimestamp: number;
  hours: number;
  observationCount: number;
  meetsMinimum: boolean;
}

export interface GrowthEvidence {
  vaultId: string;
  vaultAddress: string;
  label: string;
  growth: number | null;
  growthBps: number | null;
  firstAssetsPerShareNormalized: string;
  lastAssetsPerShareNormalized: string;
  observedHours: number;
  blocks: [number, number];
}

export interface GuardrailEvidence {
  vaultId: string;
  vaultAddress: string;
  label: string;
  windowStartTimestamp: number | null;
  windowEndTimestamp: number | null;
  assetsOutNormalized: string;
  assetsInNormalized: string;
  selfExcludedOutNormalized: string;
  selfExcludedInNormalized: string;
  /** (out - selfOut) - (in - selfIn), floored at zero */
  netOutflowExcludingSelfNormalized: string;
  observedTotalAssetsNormalized: string | null;
  outflowBps: number | null;
  exceedsLimit: boolean;
  computable: boolean;
}

export interface DecisionEvidence {
  observedWindow: {
    minHoursRequired: number;
    vaults: ObservedWindowEvidence[];
  };
  growthA: GrowthEvidence | null;
  growthB: GrowthEvidence | null;
  differentialBps: number | null;
  guardrail: {
    limitBps: number;
    evaluated: GuardrailEvidence[];
  };
  lag: {
    headBlock: number | null;
    chainHead: number | null;
    lagBlocks: number | null;
    maxLagBlocks: number;
    pipelineRefused: boolean;
    pipelineReason: string | null;
    checkedAt: string;
  };
  cooldown: {
    hours: number;
    lastRotationAt: string | null;
    lastRotationBlock: number | null;
    hoursSinceLastRotation: number | null;
    clear: boolean;
  };
  liquidity: {
    sourceMaxWithdrawNormalized: string | null;
    destinationAvailableNormalized: string | null;
    amountNormalized: string | null;
    sufficient: boolean | null;
  };
}

export interface Decision {
  action: 'hold' | 'rotate';
  /** Privy vault id we would withdraw from (the vault currently holding the position). */
  from: string | null;
  /** Privy vault id we would deposit into. */
  to: string | null;
  /** one sentence, safe to put on screen */
  reason: string;
  evidence: DecisionEvidence;
  refusals: Refusal[];
  /** `${fromVault}:${toVault}:${lastObservationBlock}` — null when from/to are unknown. */
  idempotencyKey: string | null;
  /** the amount a rotation would move, decimal string of the asset. */
  amountNormalized: string | null;
  /** newest observation block both sides were decided on. */
  lastObservationBlock: number | null;
  decidedAt: string;
  config: DecisionConfig;
}

function lower(a: string): string {
  return a.toLowerCase();
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function growthEvidence(v: VaultRef, g: GrowthObservation | undefined): GrowthEvidence | null {
  if (!g) return null;
  return {
    vaultId: v.vaultId,
    vaultAddress: v.vaultAddress,
    label: v.label,
    growth: g.growth,
    growthBps: g.growth === null ? null : round(g.growth * 10000, 4),
    firstAssetsPerShareNormalized: g.firstAssetsPerShareNormalized,
    lastAssetsPerShareNormalized: g.lastAssetsPerShareNormalized,
    observedHours: round(g.observedHours, 3),
    blocks: [g.firstBlockNumber, g.lastBlockNumber],
  };
}

function guardrailEvidence(
  v: VaultRef,
  flow: FlowWindow | undefined,
  size: ObservedSize | undefined,
  limitBps: number,
): GuardrailEvidence {
  const out = parseDecimal(flow?.assetsOutNormalized ?? '0');
  const inn = parseDecimal(flow?.assetsInNormalized ?? '0');
  const selfOut = parseDecimal(flow?.selfAssetsOutNormalized ?? '0');
  const selfIn = parseDecimal(flow?.selfAssetsInNormalized ?? '0');
  const thirdPartyOut = out - selfOut;
  const thirdPartyIn = inn - selfIn;
  const net = thirdPartyOut - thirdPartyIn;
  const netFloored = net > 0n ? net : 0n;
  const base = size ? parseDecimal(size.totalAssetsNormalized) : 0n;
  const computable = base > 0n;
  const outflowBps = computable ? bpsOf(netFloored, base) : null;
  return {
    vaultId: v.vaultId,
    vaultAddress: v.vaultAddress,
    label: v.label,
    windowStartTimestamp: flow?.windowStartTimestamp ?? null,
    windowEndTimestamp: flow?.windowEndTimestamp ?? null,
    assetsOutNormalized: formatDecimal(out),
    assetsInNormalized: formatDecimal(inn),
    selfExcludedOutNormalized: formatDecimal(selfOut),
    selfExcludedInNormalized: formatDecimal(selfIn),
    netOutflowExcludingSelfNormalized: formatDecimal(netFloored),
    observedTotalAssetsNormalized: size ? size.totalAssetsNormalized : null,
    outflowBps: outflowBps === null ? null : round(outflowBps, 2),
    exceedsLimit: outflowBps !== null && outflowBps > limitBps,
    computable,
  };
}

/**
 * Decide whether to hold or rotate. Never throws on missing data: absent facts become refusals.
 */
export function decide(input: DecisionInput): Decision {
  const cfg = input.config;
  const [vaultA, vaultB] = input.vaults;
  const refusals: Refusal[] = [];

  const growthByAddress = new Map(input.growth.map((g) => [lower(g.vaultAddress), g]));
  const flowByAddress = new Map(input.flows.map((f) => [lower(f.vaultAddress), f]));
  const sizeByAddress = new Map(input.sizes.map((s) => [lower(s.vaultAddress), s]));
  const liquidityByVaultId = new Map((input.liquidity ?? []).map((l) => [l.vaultId, l]));

  const gA = growthByAddress.get(lower(vaultA.vaultAddress));
  const gB = growthByAddress.get(lower(vaultB.vaultAddress));

  // ---- (1) pipeline provenance: refuse to act on a stale or refused pipeline -------------------
  if (input.pipeline.refused) {
    refusals.push({
      code: 'pipeline_refused',
      message: `pipeline_status refuses to answer (${input.pipeline.reason ?? 'unknown'}); the agent does not act on unverified data`,
      detail: {reason: input.pipeline.reason, detail: input.pipeline.detail},
    });
  }
  if (input.pipeline.lagBlocks === null) {
    refusals.push({
      code: 'lag_unknown',
      message: 'sink lag could not be measured (ClickHouse head or chain head unavailable)',
    });
  } else if (input.pipeline.lagBlocks > cfg.maxLagBlocks) {
    refusals.push({
      code: 'stale_pipeline',
      message: `sink head is ${input.pipeline.lagBlocks} blocks behind the chain head (limit ${cfg.maxLagBlocks})`,
      detail: {headBlock: input.pipeline.headBlock, chainHead: input.pipeline.chainHead},
    });
  }

  // ---- (2) both vaults need a long enough observed window -------------------------------------
  const windowEvidence: ObservedWindowEvidence[] = [];
  for (const [v, g] of [[vaultA, gA], [vaultB, gB]] as const) {
    if (!g) {
      refusals.push({
        code: 'no_observations',
        message: `no call_ok share-value observations for ${v.label} (${v.vaultAddress})`,
        detail: {vaultAddress: v.vaultAddress},
      });
      continue;
    }
    const meets = g.observedHours >= cfg.minObservationHours;
    windowEvidence.push({
      vaultId: v.vaultId,
      vaultAddress: v.vaultAddress,
      label: v.label,
      firstBlockNumber: g.firstBlockNumber,
      lastBlockNumber: g.lastBlockNumber,
      firstBlockTimestamp: g.firstBlockTimestamp,
      lastBlockTimestamp: g.lastBlockTimestamp,
      hours: round(g.observedHours, 3),
      observationCount: g.observationCount,
      meetsMinimum: meets,
    });
    if (!meets) {
      refusals.push({
        code: 'observed_window_too_short',
        message: `${v.label} has ${round(g.observedHours, 2)} h of observations, the rule needs at least ${cfg.minObservationHours} h`,
        detail: {vaultAddress: v.vaultAddress, observedHours: g.observedHours, observationCount: g.observationCount},
      });
    }
    if (g.growth === null) {
      refusals.push({
        code: 'growth_not_computable',
        message: `${v.label} share-value growth is not computable (first observation was zero or not call_ok)`,
        detail: {vaultAddress: v.vaultAddress},
      });
    }
  }

  // ---- (3) where is the money now --------------------------------------------------------------
  const funded = input.positions
    .filter((p) => parseDecimal(p.assetsNormalized) > 0n)
    .sort((a, b) => (parseDecimal(b.assetsNormalized) > parseDecimal(a.assetsNormalized) ? 1 : -1));
  let from: VaultRef | null = null;
  let to: VaultRef | null = null;
  let amountNormalized: string | null = null;

  if (funded.length === 0) {
    refusals.push({
      code: 'no_position',
      message: 'the business wallet holds no position in either approved vault, so there is nothing to rotate',
    });
  } else {
    const largest = funded[0]!;
    from = largest.vaultId === vaultA.vaultId ? vaultA : largest.vaultId === vaultB.vaultId ? vaultB : null;
    if (!from) {
      refusals.push({
        code: 'position_outside_allowlist',
        message: `the wallet holds a position in vault ${largest.vaultId}, which is not one of the two approved vaults`,
        detail: {vaultId: largest.vaultId},
      });
    } else {
      to = from.vaultId === vaultA.vaultId ? vaultB : vaultA;
      amountNormalized = largest.assetsNormalized;
      if (funded.length > 1) {
        refusals.push({
          code: 'position_split',
          message: 'the wallet holds a position in both approved vaults; a rotation assumes a single position, so the treasurer decides',
          detail: funded.map((p) => ({vaultId: p.vaultId, assets: p.assetsNormalized})),
        });
      }
    }
  }

  // ---- (4) differential ------------------------------------------------------------------------
  const gFrom = from ? growthByAddress.get(lower(from.vaultAddress)) : undefined;
  const gTo = to ? growthByAddress.get(lower(to.vaultAddress)) : undefined;
  let differentialBps: number | null = null;
  if (gFrom?.growth !== undefined && gFrom.growth !== null && gTo?.growth !== undefined && gTo.growth !== null) {
    differentialBps = round((gTo.growth - gFrom.growth) * 10000, 4);
    if (!(differentialBps > cfg.minDifferentialBps)) {
      refusals.push({
        code: 'differential_below_minimum',
        message: `destination share-value growth leads the current vault by ${differentialBps} bps over the observed window, below the ${cfg.minDifferentialBps} bps minimum that covers gas and friction`,
        detail: {differentialBps, minDifferentialBps: cfg.minDifferentialBps},
      });
    }
  } else if (from && to) {
    refusals.push({
      code: 'differential_not_computable',
      message: 'share-value growth is missing for at least one of the two approved vaults, so the differential cannot be computed',
    });
  }

  // ---- (5) outflow guardrail on the destination, our own flows excluded ------------------------
  const guardrails = [vaultA, vaultB].map((v) =>
    guardrailEvidence(v, flowByAddress.get(lower(v.vaultAddress)), sizeByAddress.get(lower(v.vaultAddress)), cfg.outflowGuardrailBps),
  );
  if (to) {
    const g = guardrails.find((x) => x.vaultId === to!.vaultId)!;
    if (!g.computable) {
      refusals.push({
        code: 'guardrail_not_computable',
        message: `the 24 h outflow guardrail cannot be evaluated for ${to.label}: no observed total assets to measure it against`,
        detail: {vaultAddress: to.vaultAddress},
      });
    } else if (g.exceedsLimit) {
      refusals.push({
        code: 'destination_outflow_guardrail',
        message: `${to.label} saw ${g.netOutflowExcludingSelfNormalized} in net third-party outflow over the trailing 24 h of the observed window (${g.outflowBps} bps, limit ${cfg.outflowGuardrailBps} bps)`,
        detail: g,
      });
    }
  }

  // ---- (6) cooldown ----------------------------------------------------------------------------
  const lastRotationSeconds = input.cooldown.lastRotationAt ? Math.floor(Date.parse(input.cooldown.lastRotationAt) / 1000) : null;
  const hoursSince = lastRotationSeconds === null || Number.isNaN(lastRotationSeconds)
    ? null
    : round((input.now - lastRotationSeconds) / 3600, 3);
  const cooldownClear = hoursSince === null || hoursSince >= cfg.cooldownHours;
  if (!cooldownClear) {
    refusals.push({
      code: 'cooldown_active',
      message: `the last rotation was ${hoursSince} h ago; the cooldown is ${cfg.cooldownHours} h`,
      detail: {lastRotationAt: input.cooldown.lastRotationAt, lastRotationBlock: input.cooldown.lastRotationBlock},
    });
  }

  // ---- (7) idempotency -------------------------------------------------------------------------
  const lastObservationBlock = gFrom && gTo ? Math.max(gFrom.lastBlockNumber, gTo.lastBlockNumber) : null;
  const idempotencyKey = from && to && lastObservationBlock !== null
    ? `${from.vaultId}:${to.vaultId}:${lastObservationBlock}`
    : null;
  if (idempotencyKey && input.cooldown.executedKeys.includes(idempotencyKey)) {
    refusals.push({
      code: 'already_executed',
      message: `a rotation with idempotency key ${idempotencyKey} is already in the ledger; the same observation block never triggers a second rotation`,
      detail: {idempotencyKey},
    });
  }

  // ---- (8) maxWithdraw and destination liquidity -----------------------------------------------
  const fromLiquidity = from ? liquidityByVaultId.get(from.vaultId) : undefined;
  const toLiquidity = to ? liquidityByVaultId.get(to.vaultId) : undefined;
  let liquiditySufficient: boolean | null = null;
  if (amountNormalized !== null) {
    const amount = parseDecimal(amountNormalized);
    const checks: boolean[] = [];
    if (fromLiquidity?.maxWithdrawNormalized) {
      const maxW = parseDecimal(fromLiquidity.maxWithdrawNormalized);
      const ok = maxW >= amount;
      checks.push(ok);
      if (!ok) {
        refusals.push({
          code: 'source_withdraw_limited',
          message: `${from?.label ?? 'source vault'} can return at most ${fromLiquidity.maxWithdrawNormalized} right now, less than the ${amountNormalized} position`,
          detail: fromLiquidity,
        });
      }
    }
    if (toLiquidity?.availableNormalized) {
      const avail = parseDecimal(toLiquidity.availableNormalized);
      const ok = avail >= amount;
      checks.push(ok);
      if (!ok) {
        refusals.push({
          code: 'destination_liquidity',
          message: `${to?.label ?? 'destination vault'} reports ${toLiquidity.availableNormalized} available liquidity, less than the ${amountNormalized} we would move`,
          detail: toLiquidity,
        });
      }
    }
    if (checks.length > 0) liquiditySufficient = checks.every(Boolean);
  }

  const evidence: DecisionEvidence = {
    observedWindow: {minHoursRequired: cfg.minObservationHours, vaults: windowEvidence},
    growthA: growthEvidence(vaultA, gA),
    growthB: growthEvidence(vaultB, gB),
    differentialBps,
    guardrail: {limitBps: cfg.outflowGuardrailBps, evaluated: guardrails},
    lag: {
      headBlock: input.pipeline.headBlock,
      chainHead: input.pipeline.chainHead,
      lagBlocks: input.pipeline.lagBlocks,
      maxLagBlocks: cfg.maxLagBlocks,
      pipelineRefused: input.pipeline.refused,
      pipelineReason: input.pipeline.reason,
      checkedAt: input.pipeline.checkedAt,
    },
    cooldown: {
      hours: cfg.cooldownHours,
      lastRotationAt: input.cooldown.lastRotationAt,
      lastRotationBlock: input.cooldown.lastRotationBlock,
      hoursSinceLastRotation: hoursSince,
      clear: cooldownClear,
    },
    liquidity: {
      sourceMaxWithdrawNormalized: fromLiquidity?.maxWithdrawNormalized ?? null,
      destinationAvailableNormalized: toLiquidity?.availableNormalized ?? null,
      amountNormalized,
      sufficient: liquiditySufficient,
    },
  };

  const action: Decision['action'] = refusals.length === 0 ? 'rotate' : 'hold';
  const reason = action === 'rotate'
    ? rotateReason(from!, to!, differentialBps!, evidence)
    : `hold: ${refusals[0]!.message}${refusals.length > 1 ? ` (+${refusals.length - 1} more)` : ''}`;

  return {
    action,
    from: from?.vaultId ?? null,
    to: to?.vaultId ?? null,
    reason,
    evidence,
    refusals,
    idempotencyKey,
    amountNormalized,
    lastObservationBlock,
    decidedAt: new Date(input.now * 1000).toISOString(),
    config: cfg,
  };
}

function rotateReason(from: VaultRef, to: VaultRef, differentialBps: number, e: DecisionEvidence): string {
  const w = e.observedWindow.vaults.find((v) => v.vaultId === to.vaultId) ?? e.observedWindow.vaults[0];
  const g = e.guardrail.evaluated.find((x) => x.vaultId === to.vaultId);
  const window = w ? `${w.hours} h observed window, blocks ${w.firstBlockNumber}-${w.lastBlockNumber}` : 'observed window';
  const guard = g && g.outflowBps !== null
    ? `destination 24 h net third-party outflow ${g.outflowBps} bps is inside the ${e.guardrail.limitBps} bps guardrail`
    : 'destination guardrail clear';
  return `rotate ${from.label} -> ${to.label}: share-value growth differs by ${differentialBps} bps over the ${window}; ${guard}; cooldown clear; sink lag ${e.lag.lagBlocks} blocks`;
}
