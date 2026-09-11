/**
 * Test fixtures for the decision service. One builder produces a "clean rotate" input; every test
 * mutates exactly the fact it is about, so a failure names the rule that broke.
 */
import {
  DEFAULT_DECISION_CONFIG,
  type DecisionInput,
  type FlowWindow,
  type GrowthObservation,
  type ObservedSize,
  type PipelineHealth,
  type PositionSnapshot,
  type VaultRef,
} from '../src/decision.js';

export const GAUNTLET_ADDRESS = '0x050ce30b927da55177a4914ec73480238bad56f0';
export const STEAKHOUSE_ADDRESS = '0xbeef0e0834849acc03f0089f01f4f1eeb06873c9';
export const GAUNTLET_WRAPPER = '0x3cb932ceaaaf42485d20ab4be6d7ec8cad291af2';
export const STEAKHOUSE_WRAPPER = '0xfc956fb0ca009e0ab4f1e1964bdaa0c389f72028';
export const BUSINESS_WALLET = '0xcdc8b69799bcb135c04a1052b918787125571fdc';
export const GAUNTLET_ID = 'qwxu3riq3bvt5inw65jknkqf';
export const STEAKHOUSE_ID = 'd5d6zyaety43rqx513osyexr';

/** 2026-09-09T17:06:40Z, the last observation timestamp used below. */
export const NOW = 1788973600;

export const VAULTS: [VaultRef, VaultRef] = [
  {vaultId: GAUNTLET_ID, vaultAddress: GAUNTLET_ADDRESS, wrapperAddress: GAUNTLET_WRAPPER, label: 'Gauntlet USDC Prime'},
  {vaultId: STEAKHOUSE_ID, vaultAddress: STEAKHOUSE_ADDRESS, wrapperAddress: STEAKHOUSE_WRAPPER, label: 'Steakhouse Prime USDC'},
];

export function growth(vaultAddress: string, over: Partial<GrowthObservation> = {}): GrowthObservation {
  return {
    vaultAddress,
    firstBlockNumber: 51046200,
    firstBlockTimestamp: NOW - 26 * 3600,
    firstAssetsPerShareNormalized: '1.040000000000000000',
    lastBlockNumber: 51093000,
    lastBlockTimestamp: NOW,
    lastAssetsPerShareNormalized: '1.040100000000000000',
    growth: 0.0000961538,
    observedHours: 26,
    observationCount: 27,
    ...over,
  };
}

export function flow(vaultAddress: string, over: Partial<FlowWindow> = {}): FlowWindow {
  return {
    vaultAddress,
    windowStartTimestamp: NOW - 86400,
    windowEndTimestamp: NOW,
    assetsInNormalized: '1000',
    assetsOutNormalized: '1000',
    netAssetsNormalized: '0',
    selfAssetsInNormalized: '0',
    selfAssetsOutNormalized: '0',
    depositCount: 3,
    withdrawCount: 3,
    flowsWithoutMetadata: 0,
    ...over,
  };
}

export function size(vaultAddress: string, totalAssetsNormalized = '1000000'): ObservedSize {
  return {vaultAddress, totalAssetsNormalized, blockNumber: 51093000};
}

export function health(over: Partial<PipelineHealth> = {}): PipelineHealth {
  return {
    refused: false,
    reason: null,
    detail: null,
    headBlock: 51093000,
    chainHead: 51093010,
    lagBlocks: 10,
    chainId: 8453,
    checkedAt: '2026-09-09T17:06:40.000Z',
    ...over,
  };
}

export function position(vaultId: string, assetsNormalized: string, raw: string): PositionSnapshot {
  return {vaultId, assetsInVaultRaw: raw, assetsNormalized, assetDecimals: 6, assetSymbol: 'USDC'};
}

/**
 * The clean case: 26 h of observations on both vaults, Steakhouse ahead by 9.6 bps, guardrails
 * clear, no cooldown, position in Gauntlet. `decide` must answer `rotate` on exactly this input,
 * so every other test can flip one fact and assert `hold`.
 */
export function rotateInput(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    now: NOW,
    vaults: VAULTS,
    positions: [position(GAUNTLET_ID, '50', '50000000'), position(STEAKHOUSE_ID, '0', '0')],
    growth: [
      growth(GAUNTLET_ADDRESS),
      growth(STEAKHOUSE_ADDRESS, {
        firstAssetsPerShareNormalized: '1.039000000000000000',
        lastAssetsPerShareNormalized: '1.040000000000000000',
        growth: 0.000962464,
      }),
    ],
    flows: [flow(GAUNTLET_ADDRESS), flow(STEAKHOUSE_ADDRESS)],
    sizes: [size(GAUNTLET_ADDRESS), size(STEAKHOUSE_ADDRESS)],
    pipeline: health(),
    cooldown: {lastRotationAt: null, lastRotationBlock: null, executedKeys: []},
    config: {...DEFAULT_DECISION_CONFIG},
    liquidity: [
      {vaultId: GAUNTLET_ID, availableNormalized: '900000', maxWithdrawNormalized: '50'},
      {vaultId: STEAKHOUSE_ID, availableNormalized: '900000', maxWithdrawNormalized: '0'},
    ],
    ...over,
  };
}

export function codes(refusals: {code: string}[]): string[] {
  return refusals.map((r) => r.code);
}
