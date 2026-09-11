/**
 * Every rule in docs/PROJECT.md section 4.3 gets a test. The shape is always the same: start from
 * the clean rotate input, break exactly one fact, assert `hold` and the refusal code that names it.
 */
import {describe, expect, it} from 'vitest';
import {decide} from '../src/decision.js';
import {
  BUSINESS_WALLET,
  GAUNTLET_ADDRESS,
  GAUNTLET_ID,
  NOW,
  STEAKHOUSE_ADDRESS,
  STEAKHOUSE_ID,
  codes,
  flow,
  growth,
  health,
  position,
  rotateInput,
  size,
} from './helpers.js';

describe('decide: the happy path', () => {
  it('rotates into the vault with the higher observed share-value growth', () => {
    const d = decide(rotateInput());
    expect(d.action).toBe('rotate');
    expect(d.refusals).toEqual([]);
    expect(d.from).toBe(GAUNTLET_ID);
    expect(d.to).toBe(STEAKHOUSE_ID);
    expect(d.amountNormalized).toBe('50');
    expect(d.evidence.differentialBps).toBeGreaterThan(2);
  });

  it('builds the idempotency key from the source, the destination and the last observation block', () => {
    const d = decide(rotateInput());
    expect(d.idempotencyKey).toBe(`${GAUNTLET_ID}:${STEAKHOUSE_ID}:51093000`);
    expect(d.lastObservationBlock).toBe(51093000);
  });

  it('carries the observed window, both growth rows, the guardrail and the lag as evidence', () => {
    const d = decide(rotateInput());
    expect(d.evidence.observedWindow.vaults).toHaveLength(2);
    expect(d.evidence.observedWindow.vaults.every((v) => v.meetsMinimum)).toBe(true);
    expect(d.evidence.growthA?.blocks).toEqual([51046200, 51093000]);
    expect(d.evidence.growthB?.blocks).toEqual([51046200, 51093000]);
    expect(d.evidence.lag.lagBlocks).toBe(10);
    expect(d.evidence.guardrail.evaluated).toHaveLength(2);
    expect(d.evidence.cooldown.clear).toBe(true);
  });
});

describe('decide: pipeline provenance', () => {
  it('holds when pipeline_status refuses', () => {
    const d = decide(rotateInput({pipeline: health({refused: true, reason: 'schema_mismatch', detail: 'column set hash differs'})}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('pipeline_refused');
  });

  it('holds when the sink head is further behind the chain than maxLagBlocks', () => {
    const d = decide(rotateInput({pipeline: health({headBlock: 51000000, chainHead: 51093000, lagBlocks: 93000})}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('stale_pipeline');
    expect(d.reason).toContain('93000 blocks behind');
  });

  it('holds when the lag cannot be measured at all', () => {
    const d = decide(rotateInput({pipeline: health({headBlock: null, chainHead: null, lagBlocks: null})}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('lag_unknown');
  });

  it('acts when the lag is exactly at the limit', () => {
    const d = decide(rotateInput({pipeline: health({lagBlocks: 300})}));
    expect(d.action).toBe('rotate');
  });
});

describe('decide: minimum observed window', () => {
  it('holds when either vault has fewer than minObservationHours of observations', () => {
    const input = rotateInput();
    input.growth = [
      growth(GAUNTLET_ADDRESS, {observedHours: 26}),
      growth(STEAKHOUSE_ADDRESS, {
        observedHours: 3.5,
        firstAssetsPerShareNormalized: '1.039000000000000000',
        lastAssetsPerShareNormalized: '1.040000000000000000',
        growth: 0.000962464,
      }),
    ];
    const d = decide(input);
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('observed_window_too_short');
    expect(d.evidence.observedWindow.vaults.find((v) => v.vaultId === STEAKHOUSE_ID)?.meetsMinimum).toBe(false);
  });

  it('holds when a vault has no call_ok observations at all', () => {
    const d = decide(rotateInput({growth: [growth(GAUNTLET_ADDRESS)]}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('no_observations');
  });

  it('holds when growth is not computable (first observation was zero)', () => {
    const input = rotateInput();
    input.growth = [
      growth(GAUNTLET_ADDRESS),
      growth(STEAKHOUSE_ADDRESS, {growth: null, firstAssetsPerShareNormalized: '0'}),
    ];
    const d = decide(input);
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('growth_not_computable');
  });

  it('accepts a window exactly at the minimum', () => {
    const input = rotateInput();
    input.growth = [
      growth(GAUNTLET_ADDRESS, {observedHours: 24}),
      growth(STEAKHOUSE_ADDRESS, {
        observedHours: 24,
        firstAssetsPerShareNormalized: '1.039000000000000000',
        lastAssetsPerShareNormalized: '1.040000000000000000',
        growth: 0.000962464,
      }),
    ];
    expect(decide(input).action).toBe('rotate');
  });
});

describe('decide: the differential', () => {
  it('holds when the destination leads by less than minDifferentialBps', () => {
    const input = rotateInput();
    // 1.0 bps of difference against a 2 bps minimum.
    input.growth = [growth(GAUNTLET_ADDRESS, {growth: 0.0001}), growth(STEAKHOUSE_ADDRESS, {growth: 0.0002})];
    const d = decide(input);
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('differential_below_minimum');
    expect(d.evidence.differentialBps).toBe(1);
  });

  it('holds when the current vault is the one that is ahead', () => {
    const input = rotateInput();
    input.growth = [growth(GAUNTLET_ADDRESS, {growth: 0.001}), growth(STEAKHOUSE_ADDRESS, {growth: 0.0001})];
    const d = decide(input);
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('differential_below_minimum');
    expect(d.evidence.differentialBps).toBeLessThan(0);
  });

  it('holds when the differential is exactly the minimum (strictly greater is required)', () => {
    const input = rotateInput();
    input.growth = [growth(GAUNTLET_ADDRESS, {growth: 0}), growth(STEAKHOUSE_ADDRESS, {growth: 0.0002})];
    const d = decide(input);
    expect(d.evidence.differentialBps).toBe(2);
    expect(d.action).toBe('hold');
  });

  it('is not manufactured by lowering the configured minimum inside the service', () => {
    const input = rotateInput();
    input.growth = [growth(GAUNTLET_ADDRESS, {growth: 0.0001}), growth(STEAKHOUSE_ADDRESS, {growth: 0.0002})];
    input.config = {...input.config, minDifferentialBps: 0.5};
    // The caller changed the config explicitly; the service honours it and does not second-guess.
    expect(decide(input).action).toBe('rotate');
  });
});

describe('decide: the destination outflow guardrail', () => {
  it('holds when the destination lost more than outflowGuardrailBps of its observed assets in 24 h', () => {
    const input = rotateInput();
    // 150000 out, 0 in, against 1000000 observed assets = 1500 bps > the 1000 bps limit.
    input.flows = [flow(GAUNTLET_ADDRESS), flow(STEAKHOUSE_ADDRESS, {assetsInNormalized: '0', assetsOutNormalized: '150000'})];
    const d = decide(input);
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('destination_outflow_guardrail');
    const g = d.evidence.guardrail.evaluated.find((x) => x.vaultId === STEAKHOUSE_ID)!;
    expect(g.outflowBps).toBe(1500);
    expect(g.exceedsLimit).toBe(true);
  });

  it('ignores an outflow on the vault we are leaving', () => {
    const input = rotateInput();
    input.flows = [flow(GAUNTLET_ADDRESS, {assetsInNormalized: '0', assetsOutNormalized: '900000'}), flow(STEAKHOUSE_ADDRESS)];
    const d = decide(input);
    expect(d.action).toBe('rotate');
    expect(d.evidence.guardrail.evaluated.find((x) => x.vaultId === GAUNTLET_ID)?.exceedsLimit).toBe(true);
  });

  it('excludes our own flows: the same withdrawal passes once it is attributed to us', () => {
    const heavy = {assetsInNormalized: '0', assetsOutNormalized: '150000'};
    const blocked = decide(rotateInput({flows: [flow(GAUNTLET_ADDRESS), flow(STEAKHOUSE_ADDRESS, heavy)]}));
    expect(blocked.action).toBe('hold');

    const ours = decide(
      rotateInput({
        flows: [flow(GAUNTLET_ADDRESS), flow(STEAKHOUSE_ADDRESS, {...heavy, selfAssetsOutNormalized: '150000'})],
      }),
    );
    expect(ours.action).toBe('rotate');
    const g = ours.evidence.guardrail.evaluated.find((x) => x.vaultId === STEAKHOUSE_ID)!;
    expect(g.selfExcludedOutNormalized).toBe('150000');
    expect(g.netOutflowExcludingSelfNormalized).toBe('0');
    expect(g.outflowBps).toBe(0);
  });

  it('floors the net third-party outflow at zero when more came in than went out', () => {
    const d = decide(
      rotateInput({
        flows: [flow(GAUNTLET_ADDRESS), flow(STEAKHOUSE_ADDRESS, {assetsInNormalized: '9000', assetsOutNormalized: '10'})],
      }),
    );
    const g = d.evidence.guardrail.evaluated.find((x) => x.vaultId === STEAKHOUSE_ID)!;
    expect(g.netOutflowExcludingSelfNormalized).toBe('0');
    expect(d.action).toBe('rotate');
  });

  it('holds when the guardrail has no denominator (no observed total assets)', () => {
    const d = decide(rotateInput({sizes: [size(GAUNTLET_ADDRESS)]}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('guardrail_not_computable');
  });
});

describe('decide: cooldown', () => {
  it('holds while the cooldown is still running', () => {
    const d = decide(
      rotateInput({
        cooldown: {
          lastRotationAt: new Date((NOW - 3600) * 1000).toISOString(),
          lastRotationBlock: 51090000,
          executedKeys: [],
        },
      }),
    );
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('cooldown_active');
    expect(d.evidence.cooldown.hoursSinceLastRotation).toBe(1);
  });

  it('acts once the cooldown has elapsed', () => {
    const d = decide(
      rotateInput({
        cooldown: {
          lastRotationAt: new Date((NOW - 7 * 3600) * 1000).toISOString(),
          lastRotationBlock: 51090000,
          executedKeys: [],
        },
      }),
    );
    expect(d.action).toBe('rotate');
    expect(d.evidence.cooldown.clear).toBe(true);
  });
});

describe('decide: idempotency', () => {
  it('never rotates twice on the same observation block', () => {
    const key = `${GAUNTLET_ID}:${STEAKHOUSE_ID}:51093000`;
    const d = decide(rotateInput({cooldown: {lastRotationAt: null, lastRotationBlock: null, executedKeys: [key]}}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('already_executed');
  });

  it('acts again once a newer observation block arrives', () => {
    const key = `${GAUNTLET_ID}:${STEAKHOUSE_ID}:51093000`;
    const input = rotateInput({cooldown: {lastRotationAt: null, lastRotationBlock: null, executedKeys: [key]}});
    input.growth = input.growth.map((g) => ({...g, lastBlockNumber: 51094800}));
    const d = decide(input);
    expect(d.idempotencyKey).toBe(`${GAUNTLET_ID}:${STEAKHOUSE_ID}:51094800`);
    expect(d.action).toBe('rotate');
  });
});

describe('decide: the position', () => {
  it('holds when there is no position to rotate', () => {
    const d = decide(rotateInput({positions: [position(GAUNTLET_ID, '0', '0'), position(STEAKHOUSE_ID, '0', '0')]}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('no_position');
    expect(d.idempotencyKey).toBeNull();
  });

  it('holds when the wallet is split across both approved vaults', () => {
    const d = decide(rotateInput({positions: [position(GAUNTLET_ID, '30', '30000000'), position(STEAKHOUSE_ID, '20', '20000000')]}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('position_split');
  });

  it('holds when the position is in a vault outside the allowlist', () => {
    const d = decide(rotateInput({positions: [position('some-other-vault-id', '50', '50000000')]}));
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('position_outside_allowlist');
  });

  it('rotates out of whichever approved vault holds the position', () => {
    const input = rotateInput({
      positions: [position(GAUNTLET_ID, '0', '0'), position(STEAKHOUSE_ID, '50', '50000000')],
      liquidity: [
        {vaultId: GAUNTLET_ID, availableNormalized: '900000', maxWithdrawNormalized: '0'},
        {vaultId: STEAKHOUSE_ID, availableNormalized: '900000', maxWithdrawNormalized: '50'},
      ],
    });
    // Steakhouse holds the money, so Gauntlet must be the one that is ahead for a rotation.
    input.growth = [growth(GAUNTLET_ADDRESS, {growth: 0.001}), growth(STEAKHOUSE_ADDRESS, {growth: 0.0001})];
    const d = decide(input);
    expect(d.action).toBe('rotate');
    expect(d.from).toBe(STEAKHOUSE_ID);
    expect(d.to).toBe(GAUNTLET_ID);
  });
});

describe('decide: maxWithdraw and destination liquidity', () => {
  it('holds when the source cannot return the whole position right now', () => {
    const d = decide(
      rotateInput({
        liquidity: [
          {vaultId: GAUNTLET_ID, availableNormalized: '900000', maxWithdrawNormalized: '10'},
          {vaultId: STEAKHOUSE_ID, availableNormalized: '900000', maxWithdrawNormalized: '0'},
        ],
      }),
    );
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('source_withdraw_limited');
  });

  it('holds when the destination has less available liquidity than the amount', () => {
    const d = decide(
      rotateInput({
        liquidity: [
          {vaultId: GAUNTLET_ID, availableNormalized: '900000', maxWithdrawNormalized: '50'},
          {vaultId: STEAKHOUSE_ID, availableNormalized: '5', maxWithdrawNormalized: '0'},
        ],
      }),
    );
    expect(d.action).toBe('hold');
    expect(codes(d.refusals)).toContain('destination_liquidity');
  });

  it('acts when liquidity is unknown rather than inventing a number', () => {
    const d = decide(rotateInput({liquidity: []}));
    expect(d.action).toBe('rotate');
    expect(d.evidence.liquidity.sufficient).toBeNull();
  });
});

describe('decide: fail-closed accumulation', () => {
  it('reports every reason it is holding, not just the first', () => {
    const d = decide(
      rotateInput({
        pipeline: health({lagBlocks: 5000}),
        positions: [],
        growth: [],
      }),
    );
    expect(d.action).toBe('hold');
    expect(d.refusals.length).toBeGreaterThan(2);
    expect(d.reason).toContain('more');
  });

  it('is a pure function: the same input decides the same way twice', () => {
    const input = rotateInput();
    expect(JSON.stringify(decide(input))).toBe(JSON.stringify(decide(input)));
  });

  it('never puts a self address in the third-party outflow it reports', () => {
    const d = decide(
      rotateInput({
        flows: [
          flow(GAUNTLET_ADDRESS),
          flow(STEAKHOUSE_ADDRESS, {assetsOutNormalized: '150000', selfAssetsOutNormalized: '150000'}),
        ],
      }),
    );
    expect(JSON.stringify(d)).not.toContain(BUSINESS_WALLET);
  });
});
