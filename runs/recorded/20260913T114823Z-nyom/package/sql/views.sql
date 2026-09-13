-- Views over the from-proto base tables. The sink owns the four base tables (created from the
-- (schema.table) annotations in proto/vaultflows.proto); nothing here creates or alters them.
--
-- Every read filters `_deleted_ = 0`: the ClickHouse from-proto sink handles reorgs by inserting
-- tombstone rows into a ReplacingMergeTree, so unfiltered reads can still see undone blocks.
--
-- The annotation comments below are the generator contract for @ethonline26/mcpgen: one names the
-- view, one types each output column, and one declares the trailing-window predicate that the
-- generated tool may splice in at the /*@window*/ marker.

-- @view vault_flows_24h
-- @description Per-vault deposit and withdrawal totals over the last 24 hours of observed data (the window ends at the newest vault_flows row, not at wall-clock now). Counts are of rows; assets are normalized underlying units. flows_without_metadata counts rows whose metadata probe had not settled, whose normalized amounts are therefore "0" and are excluded from the sums.
-- @column vault String Vault address, lowercase 0x hex.
-- @column window_end_timestamp UInt64 Unix seconds of the newest observed vault_flows row (upper bound of the window).
-- @column window_start_timestamp UInt64 Unix seconds 24 hours before window_end_timestamp (lower bound of the window).
-- @column deposit_count UInt64 Deposit rows in the window.
-- @column withdraw_count UInt64 Withdraw rows in the window.
-- @column assets_in_normalized Decimal(38, 18) Sum of assets_normalized over deposits in the window.
-- @column assets_out_normalized Decimal(38, 18) Sum of assets_normalized over withdrawals in the window.
-- @column net_assets_normalized Decimal(38, 18) assets_in_normalized minus assets_out_normalized.
-- @column flows_without_metadata UInt64 Rows in the window with meta_valid = false (their amounts are not included in the sums).
CREATE OR REPLACE VIEW vault_flows_24h AS
WITH (SELECT max(block_timestamp) FROM vault_flows WHERE _deleted_ = 0) AS observed_end
SELECT
    vault,
    toUInt64(ifNull(observed_end, 0)) AS window_end_timestamp,
    toUInt64(ifNull(observed_end, 0) - 86400) AS window_start_timestamp,
    countIf(direction = 'deposit') AS deposit_count,
    countIf(direction = 'withdraw') AS withdraw_count,
    sumIf(assets_normalized, direction = 'deposit') AS assets_in_normalized,
    sumIf(assets_normalized, direction = 'withdraw') AS assets_out_normalized,
    sumIf(assets_normalized, direction = 'deposit') - sumIf(assets_normalized, direction = 'withdraw') AS net_assets_normalized,
    countIf(meta_valid = false) AS flows_without_metadata
FROM vault_flows
WHERE _deleted_ = 0
  AND block_timestamp >= observed_end - 86400
GROUP BY vault;

-- @view share_value_growth
-- @description Change in observed share value per vault: the first and last convertToAssets observation in the window, and the relative change between them. Reads only observations with call_ok = true; nothing is interpolated between samples, so growth is the change between two actual observations, not a rate.
-- @window column=block_timestamp table=share_value_observations where=_deleted_ = 0 AND call_ok = true
-- @column vault String Vault address, lowercase 0x hex.
-- @column first_block_number UInt64 Block of the earliest observation in the window.
-- @column first_block_timestamp UInt64 Unix seconds of that observation.
-- @column first_assets_per_share_normalized Decimal(38, 18) Assets per whole share at the earliest observation.
-- @column last_block_number UInt64 Block of the latest observation in the window.
-- @column last_block_timestamp UInt64 Unix seconds of that observation.
-- @column last_assets_per_share_normalized Decimal(38, 18) Assets per whole share at the latest observation.
-- @column growth Nullable(Float64) last / first - 1, as a fraction. NULL when the first observation is zero.
-- @column observed_hours Float64 Hours between the first and last observation in the window.
-- @column observation_count UInt64 Observations counted in the window.
CREATE OR REPLACE VIEW share_value_growth AS
SELECT
    vault,
    min(block_number) AS first_block_number,
    argMin(block_timestamp, block_number) AS first_block_timestamp,
    argMin(assets_per_share_normalized, block_number) AS first_assets_per_share_normalized,
    max(block_number) AS last_block_number,
    argMax(block_timestamp, block_number) AS last_block_timestamp,
    argMax(assets_per_share_normalized, block_number) AS last_assets_per_share_normalized,
    if(
        argMin(assets_per_share_normalized, block_number) > 0,
        toFloat64(argMax(assets_per_share_normalized, block_number)) / toFloat64(argMin(assets_per_share_normalized, block_number)) - 1,
        NULL
    ) AS growth,
    toFloat64(argMax(block_timestamp, block_number) - argMin(block_timestamp, block_number)) / 3600 AS observed_hours,
    count() AS observation_count
FROM share_value_observations
WHERE _deleted_ = 0
  AND call_ok = true /*@window*/
GROUP BY vault;
