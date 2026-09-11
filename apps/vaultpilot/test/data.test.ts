/**
 * Data source tests. `fetch` is always injected, so nothing here touches ClickHouse or an RPC:
 * the assertions are about the request the source builds (read-only, parameterized, no identifier
 * ever interpolated from a caller) and about the rows it maps back.
 */
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  ClickHouseHttpSource,
  ClickHouseQueryError,
  FixtureSource,
  isProfileReadonlyError,
  type VaultflowsFixture,
} from '../src/data.js';
import {APP_DIR} from '../src/env.js';
import {BUSINESS_WALLET, GAUNTLET_ADDRESS, GAUNTLET_WRAPPER, STEAKHOUSE_ADDRESS} from './helpers.js';

interface Captured {
  url: URL;
  body: string;
  headers: Record<string, string>;
}

/** A fetch that answers each POST from a queue of JSON row sets and records the request. */
function fakeFetch(responses: unknown[][], captured: Captured[] = [], errors: (string | null)[] = []): typeof fetch {
  let i = 0;
  return (async (input: URL | string, init?: RequestInit) => {
    const n = i++;
    captured.push({
      url: new URL(String(input)),
      body: String(init?.body ?? ''),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const error = errors[n];
    if (error) {
      return new Response(error, {status: 500});
    }
    return new Response(JSON.stringify({data: responses[n] ?? []}), {status: 200, headers: {'content-type': 'application/json'}});
  }) as unknown as typeof fetch;
}

function source(fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof ClickHouseHttpSource>[0]> = {}) {
  return new ClickHouseHttpSource({
    url: 'https://example.clickhouse.cloud:8443',
    user: 'ro',
    password: 'secret',
    database: 'vaultflows',
    rpcUrl: 'https://rpc.example/base',
    fetchImpl,
    ...over,
  });
}

describe('ClickHouseHttpSource: the request it builds', () => {
  it('asks for readonly=1 and a server-side execution limit', async () => {
    const captured: Captured[] = [];
    await source(fakeFetch([[]], captured)).shareValueGrowth();
    expect(captured[0]!.url.searchParams.get('readonly')).toBe('1');
    expect(captured[0]!.url.searchParams.get('database')).toBe('vaultflows');
    expect(captured[0]!.url.searchParams.get('max_execution_time')).toBe('10');
  });

  it('sends the credential in headers, never in the URL', async () => {
    const captured: Captured[] = [];
    await source(fakeFetch([[]], captured)).shareValueGrowth();
    expect(captured[0]!.headers['x-clickhouse-user']).toBe('ro');
    expect(captured[0]!.headers['x-clickhouse-key']).toBe('secret');
    expect(captured[0]!.url.toString()).not.toContain('secret');
  });

  it('binds self addresses as parameters and never interpolates them into the SQL', async () => {
    const captured: Captured[] = [];
    await source(fakeFetch([[]], captured)).flowWindow24h([BUSINESS_WALLET, GAUNTLET_WRAPPER]);
    const {url, body} = captured[0]!;
    expect(url.searchParams.get('param_self0')).toBe(BUSINESS_WALLET);
    expect(url.searchParams.get('param_self1')).toBe(GAUNTLET_WRAPPER);
    expect(body).toContain('{self0:String}');
    expect(body).not.toContain(BUSINESS_WALLET);
  });

  it('deduplicates and lowercases the self addresses', async () => {
    const captured: Captured[] = [];
    await source(fakeFetch([[]], captured)).flowWindow24h([BUSINESS_WALLET, BUSINESS_WALLET.toUpperCase()]);
    expect(captured[0]!.url.searchParams.get('param_self1')).toBeNull();
  });

  it('matches owner, receiver and caller against the self set', async () => {
    const captured: Captured[] = [];
    await source(fakeFetch([[]], captured)).flowWindow24h([BUSINESS_WALLET]);
    const body = captured[0]!.body;
    expect(body).toContain('lower(owner) IN');
    expect(body).toContain('lower(receiver) IN');
    expect(body).toContain('lower(caller) IN');
  });

  it('reads only call_ok observations, and only live rows', async () => {
    const captured: Captured[] = [];
    await source(fakeFetch([[]], captured)).shareValueGrowth();
    expect(captured[0]!.body).toContain('_deleted_ = 0');
    expect(captured[0]!.body).toContain('call_ok = true');
  });

  it('retries once without settings when the credential is read-only server-side', async () => {
    const captured: Captured[] = [];
    const readonlyError =
      "Code: 164. DB::Exception: Cannot modify 'max_execution_time' setting in readonly mode. (READONLY)";
    const s = source(fakeFetch([[], [{vault: GAUNTLET_ADDRESS}]], captured, [readonlyError, null]));
    const rows = await s.shareValueGrowth();
    expect(captured).toHaveLength(2);
    expect(captured[0]!.url.searchParams.get('readonly')).toBe('1');
    expect(captured[1]!.url.searchParams.get('readonly')).toBeNull();
    expect(rows).toHaveLength(1);
    expect(s.readOnlyMode).toBe('profile-readonly');
    expect(s.describe().note).toContain('read-only server-side');
  });

  it('does not retry an unrelated error', async () => {
    const captured: Captured[] = [];
    const s = source(fakeFetch([[]], captured, ['Code: 60. DB::Exception: Table does not exist']));
    await expect(s.shareValueGrowth()).rejects.toBeInstanceOf(ClickHouseQueryError);
    expect(captured).toHaveLength(1);
  });

  it('recognises only the readonly-profile refusal', () => {
    expect(isProfileReadonlyError(new Error("Code: 164 ... in readonly mode."))).toBe(true);
    expect(isProfileReadonlyError(new Error('Code: 164 ... something else'))).toBe(false);
    expect(isProfileReadonlyError(new Error('Code: 60 ... in readonly mode.'))).toBe(false);
  });
});

describe('ClickHouseHttpSource: the rows it maps', () => {
  it('maps a share_value_growth row', async () => {
    const rows = await source(
      fakeFetch([
        [
          {
            vault: GAUNTLET_ADDRESS.toUpperCase(),
            first_block_number: '51046200',
            first_block_timestamp: '1788880000',
            first_assets_per_share_normalized: '1.040742',
            last_block_number: '51093000',
            last_block_timestamp: '1788973600',
            last_assets_per_share_normalized: '1.040800',
            growth: 0.0000557,
            observed_hours: 26,
            observation_count: 27,
          },
        ],
      ]),
    ).shareValueGrowth();
    expect(rows[0]).toEqual({
      vaultAddress: GAUNTLET_ADDRESS,
      firstBlockNumber: 51046200,
      firstBlockTimestamp: 1788880000,
      firstAssetsPerShareNormalized: '1.040742',
      lastBlockNumber: 51093000,
      lastBlockTimestamp: 1788973600,
      lastAssetsPerShareNormalized: '1.040800',
      growth: 0.0000557,
      observedHours: 26,
      observationCount: 27,
    });
  });

  it('keeps a null growth null instead of turning it into zero', async () => {
    const rows = await source(fakeFetch([[{vault: GAUNTLET_ADDRESS, growth: null}]])).shareValueGrowth();
    expect(rows[0]!.growth).toBeNull();
  });

  it('normalizes observed sizes with the decimals the pipeline reported', async () => {
    const sizes = await source(
      fakeFetch([
        [{vault: GAUNTLET_ADDRESS, total_assets_raw: '95882759323355', observed_block: '51012000'}],
        [{vault: GAUNTLET_ADDRESS, asset_decimals: 6}],
      ]),
    ).observedSizes();
    expect(sizes).toEqual([
      {vaultAddress: GAUNTLET_ADDRESS, totalAssetsNormalized: '95882759.323355', blockNumber: 51012000},
    ]);
  });

  it('drops a vault whose asset decimals the pipeline never reported, rather than guessing', async () => {
    const sizes = await source(
      fakeFetch([[{vault: GAUNTLET_ADDRESS, total_assets_raw: '1', observed_block: '1'}], []]),
    ).observedSizes();
    expect(sizes).toEqual([]);
  });
});

describe('ClickHouseHttpSource: pipelineStatus', () => {
  const rpcOk = (blockHex: string) =>
    new Response(JSON.stringify({jsonrpc: '2.0', id: 1, result: blockHex}), {status: 200});

  function statusFetch(head: number | null, chainHead: number, chainId = 8453): typeof fetch {
    return (async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://rpc.example')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {method: string};
        return rpcOk(body.method === 'eth_chainId' ? `0x${chainId.toString(16)}` : `0x${chainHead.toString(16)}`);
      }
      return new Response(JSON.stringify({data: head === null ? [] : [{head_block: head}]}), {status: 200});
    }) as unknown as typeof fetch;
  }

  it('reports the lag between the sink head and the chain head', async () => {
    const health = await source(statusFetch(51_092_900, 51_093_000)).pipelineStatus({maxLagBlocks: 300, expectedChainId: 8453});
    expect(health.refused).toBe(false);
    expect(health.lagBlocks).toBe(100);
    expect(health.headBlock).toBe(51_092_900);
  });

  it('refuses when the sink is further behind than the limit', async () => {
    const health = await source(statusFetch(51_000_000, 51_093_000)).pipelineStatus({maxLagBlocks: 300, expectedChainId: 8453});
    expect(health.refused).toBe(true);
    expect(health.reason).toBe('stale_data');
  });

  it('refuses when the RPC answers for a different chain than the receipt pins', async () => {
    const health = await source(statusFetch(51_092_900, 51_093_000, 1)).pipelineStatus({maxLagBlocks: 300, expectedChainId: 8453});
    expect(health.refused).toBe(true);
    expect(health.reason).toBe('chain_mismatch');
  });

  it('refuses (never guesses) when the head cannot be read at all', async () => {
    const health = await source(statusFetch(null, 51_093_000)).pipelineStatus({maxLagBlocks: 300, expectedChainId: 8453});
    expect(health.refused).toBe(true);
    expect(health.reason).toBe('check_unavailable');
    expect(health.lagBlocks).toBeNull();
  });

  it('refuses when no RPC URL is configured, because the lag is then unknowable', async () => {
    const noRpc = new ClickHouseHttpSource({
      url: 'https://example.clickhouse.cloud:8443',
      database: 'vaultflows',
      fetchImpl: statusFetch(51_092_900, 51_093_000),
    });
    const health = await noRpc.pipelineStatus({maxLagBlocks: 300, expectedChainId: 8453});
    expect(health.refused).toBe(true);
    expect(health.detail).toContain('BASE_RPC_URL');
  });
});

describe('FixtureSource', () => {
  const fixture: VaultflowsFixture = JSON.parse(
    JSON.stringify({
      name: 'test',
      growth: [],
      flows: [],
      sizes: [],
      pipeline: {
        refused: false, reason: null, detail: null, headBlock: 100, chainHead: 4000,
        lagBlocks: 3900, chainId: 8453, checkedAt: '2026-09-10T00:00:00.000Z',
      },
    }),
  ) as VaultflowsFixture;

  it('applies the caller lag limit to fixture data too, so a stale fixture still refuses', async () => {
    const health = await new FixtureSource(fixture).pipelineStatus({maxLagBlocks: 300, expectedChainId: 8453});
    expect(health.refused).toBe(true);
    expect(health.reason).toBe('stale_data');
  });

  it('describes itself as a fixture so the UI can never claim it is live data', () => {
    expect(new FixtureSource(fixture).describe().kind).toBe('fixture');
  });

  it('loads the committed rotate fixture and answers every method', async () => {
    const s = FixtureSource.fromFile(resolve(APP_DIR, 'fixtures', 'rotate.json'));
    const growth = await s.shareValueGrowth();
    expect(growth.map((g) => g.vaultAddress).sort()).toEqual([GAUNTLET_ADDRESS, STEAKHOUSE_ADDRESS]);
    expect(await s.flowWindow24h([BUSINESS_WALLET])).toHaveLength(2);
    expect(await s.observedSizes()).toHaveLength(2);
    expect((await s.pipelineStatus({maxLagBlocks: 300, expectedChainId: 8453})).refused).toBe(false);
  });
});
