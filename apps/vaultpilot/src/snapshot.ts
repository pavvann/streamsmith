/**
 * One read of the whole world: pipeline health and provenance, both vaults' observed windows and
 * share-value growth, the wallet's positions, the policy in force, the ledger, and the decision
 * those facts produce. The text summary (loop.ts), the JSON service (serve.ts) and the UI route
 * handler all render this one object, so the screen can never disagree with the agent.
 */
import {existsSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  DEFAULT_DECISION_CONFIG,
  decide,
  type Decision,
  type DecisionConfig,
  type DecisionInput,
  type FlowWindow,
  type GrowthObservation,
  type LiquidityFact,
  type ObservedSize,
  type PipelineHealth,
  type PositionSnapshot,
  type VaultRef,
} from './decision.js';
import {createSource, FixtureSource, type SourceDescription, type VaultflowsSource} from './data.js';
import {APP_DIR, envNumber, envOptional, missingEnv} from './env.js';
import {fromBaseUnits} from './decimal.js';
import {
  cooldownState,
  dailyCapRemainingUsd,
  dailySpentUsd,
  openAlerts,
  readLedger,
  recentOutcomes,
  type LedgerEntry,
  LEDGER_PATH,
} from './ledger.js';
import {pipelineStatusView, readProvenance, type PipelineProvenance} from './provenance.js';
import {
  APPROVED_VAULTS,
  BUSINESS_WALLET_ADDRESS,
  BUSINESS_WALLET_ID,
  WRAPPER_FEE_PERCENT,
  vaultRefs,
} from './vaults.js';

export const SNAPSHOT_PATH = resolve(APP_DIR, '.vaultpilot-snapshot.json');
const STATE_PATH = resolve(APP_DIR, '.vaultpilot-state.json');

export interface VaultView {
  vaultId: string;
  label: string;
  /** underlying ERC-4626 vault the pipeline observes */
  vaultAddress: string;
  /** Privy fee wrapper our transactions touch */
  wrapperAddress: string | null;
  /** the wrapper's fee on generated returns, in percent (disclosure, not a computed number) */
  wrapperFeePercent: number;
  position: PositionSnapshot | null;
  liquidity: LiquidityFact | null;
  growth: GrowthObservation | null;
  flows: FlowWindow | null
  size: ObservedSize | null;
}

export interface WalletView {
  walletId: string | null;
  address: string | null;
  /** owner key quorum: the treasurer's authorization key */
  treasurerKeyId: string | null;
  ownerKeyQuorumId: string | null;
  agentKeyQuorumId: string | null;
  policyId: string | null;
  control: string;
  revocationCommand: string;
}

export interface PolicyView {
  methods: string[];
  allowedVaultIds: string[];
  perActionCapUsd: number;
  defaultDeny: true;
  dailyCapUsd: number;
  dailySpentUsd: number;
  dailyRemainingUsd: number;
  dailyCapDisclosure: string;
  wrapperFeeDisclosure: string;
}

export interface Snapshot {
  generatedAt: string;
  mode: {
    dryRun: boolean;
    source: SourceDescription;
    privy: 'live' | 'fixture' | 'unavailable';
    missingEnv: string[];
  };
  config: DecisionConfig;
  wallet: WalletView;
  policy: PolicyView;
  vaults: VaultView[];
  decision: Decision;
  pipeline: Record<string, unknown>;
  pipelineHealth: PipelineHealth;
  provenance: PipelineProvenance;
  ledger: {
    path: string;
    recent: LedgerEntry[];
    alerts: LedgerEntry[];
    lastRotationAt: string | null;
    entryCount: number;
  };
  errors: string[];
}

export interface BuildSnapshotOptions {
  source?: VaultflowsSource;
  ledgerPath?: string;
  now?: number;
  dryRun?: boolean;
  config?: Partial<DecisionConfig>;
  /** skip every Privy call (tests, offline demos) */
  offline?: boolean;
}

export function decisionConfigFromEnv(overrides: Partial<DecisionConfig> = {}): DecisionConfig {
  return {
    minObservationHours: envNumber('VAULTPILOT_MIN_OBSERVATION_HOURS', DEFAULT_DECISION_CONFIG.minObservationHours),
    minDifferentialBps: envNumber('VAULTPILOT_MIN_DIFFERENTIAL_BPS', DEFAULT_DECISION_CONFIG.minDifferentialBps),
    cooldownHours: envNumber('VAULTPILOT_COOLDOWN_HOURS', DEFAULT_DECISION_CONFIG.cooldownHours),
    outflowGuardrailBps: envNumber('VAULTPILOT_OUTFLOW_GUARDRAIL_BPS', DEFAULT_DECISION_CONFIG.outflowGuardrailBps),
    maxLagBlocks: envNumber('VAULTPILOT_MAX_LAG_BLOCKS', DEFAULT_DECISION_CONFIG.maxLagBlocks),
    ...overrides,
  };
}

interface StateFile {
  walletId?: string;
  policyId?: string;
  agentKeyQuorumId?: string;
}

function readState(): StateFile {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as StateFile;
  } catch {
    return {};
  }
}

export async function buildSnapshot(opts: BuildSnapshotOptions = {}): Promise<Snapshot> {
  const errors: string[] = [];
  const config = decisionConfigFromEnv(opts.config ?? {});
  const perActionCapUsd = envNumber('VAULTPILOT_PER_ACTION_CAP_USD', 60);
  const dailyCapUsd = envNumber('VAULTPILOT_DAILY_CAP_USD', 120);
  const nowSeconds = opts.now ?? Math.floor(Date.now() / 1000);
  const source = opts.source ?? createSource();
  const provenance = readProvenance();
  if (provenance.error) errors.push(provenance.error);
  const refs = vaultRefs();
  const state = readState();
  const missing = missingEnv();
  const offline = opts.offline ?? missing.length > 0;

  // ---- pipeline health -------------------------------------------------------------------------
  let health: PipelineHealth;
  try {
    health = await source.pipelineStatus({maxLagBlocks: config.maxLagBlocks, expectedChainId: provenance.chainId});
  } catch (e) {
    health = {
      refused: true, reason: 'check_unavailable', detail: (e as Error).message,
      headBlock: null, chainHead: null, lagBlocks: null, chainId: null, checkedAt: new Date().toISOString(),
    };
    errors.push(`pipeline_status: ${(e as Error).message}`);
  }

  // ---- pipeline data ---------------------------------------------------------------------------
  let growth: GrowthObservation[] = [];
  let flows: FlowWindow[] = [];
  let sizes: ObservedSize[] = [];
  const selfAddressSet = [BUSINESS_WALLET_ADDRESS, ...APPROVED_VAULTS.map((v) => v.wrapperAddress)];
  try {
    growth = await source.shareValueGrowth();
  } catch (e) {
    errors.push(`share_value_growth: ${(e as Error).message}`);
  }
  try {
    flows = await source.flowWindow24h(selfAddressSet);
  } catch (e) {
    errors.push(`vault_flows_24h: ${(e as Error).message}`);
  }
  try {
    sizes = await source.observedSizes();
  } catch (e) {
    errors.push(`observed sizes: ${(e as Error).message}`);
  }

  // ---- Privy side: positions, wrapper addresses, liquidity ------------------------------------
  let positions: PositionSnapshot[] = [];
  let liquidity: LiquidityFact[] = [];
  let privyMode: Snapshot['mode']['privy'] = 'unavailable';
  const walletId = state.walletId ?? BUSINESS_WALLET_ID;
  const vaultRefsResolved: VaultRef[] = refs.map((r) => ({...r}));

  if (offline) {
    if (source instanceof FixtureSource) {
      privyMode = 'fixture';
      positions = source.data.positions ?? [];
      liquidity = source.data.liquidity ?? [];
    } else if (missing.length > 0) {
      errors.push(`Privy credentials missing (${missing.join(', ')}); positions and liquidity are unavailable`);
    }
  } else {
    try {
      const {readVaultFacts} = await import('./earnclient.js');
      const {position} = await import('./earn.js');
      for (const ref of vaultRefsResolved) {
        try {
          const facts = await readVaultFacts(ref.vaultId);
          if (facts.wrapperAddress) ref.wrapperAddress = facts.wrapperAddress;
          liquidity.push({
            vaultId: ref.vaultId,
            availableNormalized: facts.availableLiquidityUsd,
            maxWithdrawNormalized: null,
          });
        } catch (e) {
          errors.push(`vault details ${ref.label}: ${(e as Error).message}`);
        }
        try {
          const p = await position(walletId, ref.vaultId);
          positions.push({
            vaultId: ref.vaultId,
            assetsInVaultRaw: p.assets_in_vault,
            assetsNormalized: fromBaseUnits(p.assets_in_vault, p.asset.decimals),
            assetDecimals: p.asset.decimals,
            assetSymbol: p.asset.symbol,
          });
        } catch (e) {
          errors.push(`position ${ref.label}: ${(e as Error).message}`);
        }
      }
      privyMode = 'live';
    } catch (e) {
      errors.push(`Privy client unavailable: ${(e as Error).message}`);
    }
  }
  // The source vault's maxWithdraw is bounded by our own position (Privy: "withdraw any amount up
  // to the wallet's current assets_in_vault"), so the position doubles as the maxWithdraw fact.
  liquidity = liquidity.map((l) => {
    const p = positions.find((x) => x.vaultId === l.vaultId);
    return p ? {...l, maxWithdrawNormalized: l.maxWithdrawNormalized ?? p.assetsNormalized} : l;
  });

  // ---- decision --------------------------------------------------------------------------------
  const ledgerPath = opts.ledgerPath ?? LEDGER_PATH;
  const ledger = readLedger(ledgerPath);
  const input: DecisionInput = {
    now: nowSeconds,
    vaults: [vaultRefsResolved[0]!, vaultRefsResolved[1]!],
    positions,
    growth,
    flows,
    sizes,
    pipeline: health,
    cooldown: cooldownState(ledger),
    config,
    liquidity,
  };
  const decision = decide(input);

  const byAddress = (list: {vaultAddress: string}[], address: string) =>
    list.find((x) => x.vaultAddress.toLowerCase() === address.toLowerCase());

  const vaults: VaultView[] = vaultRefsResolved.map((ref) => ({
    vaultId: ref.vaultId,
    label: ref.label,
    vaultAddress: ref.vaultAddress,
    wrapperAddress: ref.wrapperAddress,
    wrapperFeePercent: WRAPPER_FEE_PERCENT,
    position: positions.find((p) => p.vaultId === ref.vaultId) ?? null,
    liquidity: liquidity.find((l) => l.vaultId === ref.vaultId) ?? null,
    growth: byAddress(growth, ref.vaultAddress) as GrowthObservation | undefined ?? null,
    flows: byAddress(flows, ref.vaultAddress) as FlowWindow | undefined ?? null,
    size: byAddress(sizes, ref.vaultAddress) as ObservedSize | undefined ?? null,
  }));

  const agentKeyQuorumId = state.agentKeyQuorumId ?? envOptional('PRIVY_AGENT_KEY_ID') ?? null;
  const wallet: WalletView = {
    walletId,
    address: BUSINESS_WALLET_ADDRESS,
    treasurerKeyId: envOptional('PRIVY_TREASURER_KEY_ID') ?? null,
    ownerKeyQuorumId: envOptional('PRIVY_TREASURER_KEY_ID') ?? null,
    agentKeyQuorumId,
    policyId: state.policyId ?? null,
    control:
      'The business wallet is owned by the treasurer authorization key. The agent is only an ' +
      'additional signer with one override policy: it can call earn_deposit and earn_withdraw on ' +
      'the two approved vault ids under the per-action cap, and nothing else. Only the treasurer ' +
      'key can change the policy, add signers, or export the wallet.',
    revocationCommand: agentKeyQuorumId
      ? `detachAgentSigner('${walletId}', '${agentKeyQuorumId}')  # apps/vaultpilot/src/signer.ts, signed by PRIVY_AUTH_KEY`
      : "detachAgentSigner(walletId, agentKeyQuorumId)  # apps/vaultpilot/src/signer.ts, signed by PRIVY_AUTH_KEY",
  };

  const policy: PolicyView = {
    methods: ['earn_deposit', 'earn_withdraw'],
    allowedVaultIds: vaultRefsResolved.map((r) => r.vaultId),
    perActionCapUsd,
    defaultDeny: true,
    dailyCapUsd,
    dailySpentUsd: dailySpentUsd(ledger, nowSeconds * 1000),
    dailyRemainingUsd: dailyCapRemainingUsd(ledger, dailyCapUsd, nowSeconds * 1000),
    dailyCapDisclosure:
      'The rolling daily cap is enforced by this app, not by Privy: Privy aggregations cover only ' +
      'eth_signTransaction and eth_signUserOperation, never earn_deposit or earn_withdraw. It sums ' +
      'the amount of every Earn action signed in the trailing 24 h, from the local ledger.',
    wrapperFeeDisclosure:
      `Both Privy Earn vaults are fee wrappers around the Morpho vaults, and each wrapper takes a ` +
      `${WRAPPER_FEE_PERCENT}% fee on generated returns. The share-value growth shown here is measured on the ` +
      'underlying vault by the pipeline, so it is before that fee.',
  };

  const {at: lastRotationAt} = {at: cooldownState(ledger).lastRotationAt};

  return {
    generatedAt: new Date(nowSeconds * 1000).toISOString(),
    mode: {
      dryRun: opts.dryRun ?? true,
      source: source.describe(),
      privy: privyMode,
      missingEnv: missing,
    },
    config,
    wallet,
    policy,
    vaults,
    decision,
    pipeline: pipelineStatusView(provenance, health, config.maxLagBlocks),
    pipelineHealth: health,
    provenance,
    ledger: {
      path: ledgerPath,
      recent: recentOutcomes(ledger),
      alerts: openAlerts(ledger),
      lastRotationAt,
      entryCount: ledger.entries.length,
    },
    errors,
  };
}

export function writeSnapshot(snapshot: Snapshot, path: string = SNAPSHOT_PATH): string {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + '\n');
  renameSync(tmp, path);
  return path;
}

export function readSnapshot(path: string = SNAPSHOT_PATH): Snapshot | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  } catch {
    return null;
  }
}
