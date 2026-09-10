-- ClickHouse views over the from-proto tables of erc4626-flows (public contract: specs/vaultflows.proto).
-- Streamsmith creates them after the sink has created the base tables (specs/streamsmith.yaml sink.views);
-- the views are never part of the sink schema hash.
--
-- Rules
-- - Table and column names are exactly the proto's `schema.table` names and field names.
-- - `direction` is a String column holding exactly 'deposit' or 'withdraw' (the contract has no enum fields:
--   substreams-sink-sql 4.13.1 from-proto panics on a populated proto3 enum), so it is compared to a quoted
--   literal, never to 1 / 2.
-- - Each statement below must be applied on its own: ClickHouse over HTTP rejects a multi-statement body with
--   "Multi-statements are not allowed" (code 62). mcpgen's views parser returns one `ddl` per view for that reason.
-- - Every read of a base table filters `_deleted_ = 0` (ReplacingMergeTree tombstones on reorgs,
--   docs/build/substreams-facts.md (d) 7). Views are not materialized, so they see merged and unmerged parts alike.
-- - Numeric strings are never empty; "0" with meta_valid = false / call_ok = false means "not computable" and is
--   excluded through the flag, never by comparing the value to zero (contract-notes.md section 4).
-- - Windows are trailing from the newest row the sink has written (max(block_timestamp)), not from now(): the
--   view answers "what the pipeline has observed", and the MCP reports lag separately.
-- - Vocabulary: "share value", "share-value growth", "observed window", "execution rate", "share migration".
--
-- Annotations (plain comments to ClickHouse; read by packages/mcpgen to type the generated MCP tools)
--   -- @view <name>                              must equal the CREATE VIEW name
--   -- @description <text>                       tool description (one line)
--   -- @column <name> <ClickHouse type> <text>   one per output column, in SELECT order
--   -- @window column=<col> table=<base table> where=<live-row predicate>
--                                                optional. The body carries a /*@window*/ marker at the end of
--                                                the WHERE clause; mcpgen replaces it with
--                                                `AND <col> >= (SELECT max(<col>) FROM <table> WHERE <where>) - toUInt64({windowHours:UInt32}) * 3600`
--                                                for the windowed form of the tool, and reports the observed
--                                                window from min/max(<col>) of the same rows. In the DDL it stays a comment.

-- @view vault_flows_24h
-- @description Per configured vault: deposit and withdraw counts and normalized asset amounts in and out over the trailing 24 hours of the observed window (window end = newest vault_flows row).
-- @column vault String vault address, lowercase 0x hex
-- @column window_end_timestamp UInt64 unix seconds of the newest vault_flows row (end of the trailing window)
-- @column window_start_timestamp UInt64 window_end_timestamp - 86400
-- @column deposit_count UInt64 Deposit logs in the window
-- @column withdraw_count UInt64 Withdraw logs in the window
-- @column assets_in_normalized Decimal(38, 18) sum of deposit assets_normalized (meta_valid rows only), asset units
-- @column assets_out_normalized Decimal(38, 18) sum of withdraw assets_normalized (meta_valid rows only), asset units
-- @column net_assets_normalized Decimal(38, 18) assets_in_normalized - assets_out_normalized
-- @column flows_without_metadata UInt64 rows with meta_valid = false, excluded from the sums
CREATE OR REPLACE VIEW vault_flows_24h AS
WITH (SELECT max(block_timestamp) FROM vault_flows WHERE _deleted_ = 0) AS window_end
SELECT
  vault,
  toUInt64(window_end) AS window_end_timestamp,
  toUInt64(window_end - 86400) AS window_start_timestamp,
  countIf(direction = 'deposit') AS deposit_count,
  countIf(direction = 'withdraw') AS withdraw_count,
  sumIf(assets_normalized, direction = 'deposit' AND meta_valid = true) AS assets_in_normalized,
  sumIf(assets_normalized, direction = 'withdraw' AND meta_valid = true) AS assets_out_normalized,
  assets_in_normalized - assets_out_normalized AS net_assets_normalized,
  countIf(meta_valid = false) AS flows_without_metadata
FROM vault_flows
WHERE _deleted_ = 0 AND block_timestamp > window_end - 86400
GROUP BY vault;

-- @view share_value_growth
-- @description Per configured vault: first and last share-value observation in the observed window (block numbers, timestamps, assets per share) and growth = last / first - 1. Only observations with call_ok = true; never interpolated.
-- @column vault String vault address, lowercase 0x hex
-- @column first_block_number UInt64 block of the first observation in the window
-- @column first_block_timestamp UInt64 unix seconds of the first observation
-- @column first_assets_per_share_normalized Decimal(38, 18) convertToAssets(10^share_decimals) / 10^asset_decimals at the first observation
-- @column last_block_number UInt64 block of the last observation in the window
-- @column last_block_timestamp UInt64 unix seconds of the last observation
-- @column last_assets_per_share_normalized Decimal(38, 18) assets per share at the last observation
-- @column growth Nullable(Float64) last_assets_per_share_normalized / first_assets_per_share_normalized - 1; NULL when the first value is zero
-- @column observed_hours Float64 (last_block_timestamp - first_block_timestamp) / 3600
-- @column observation_count UInt64 call_ok observations in the window
-- @window column=block_timestamp table=share_value_observations where=_deleted_ = 0 AND call_ok = true
CREATE OR REPLACE VIEW share_value_growth AS
SELECT
  vault,
  min(block_number) AS first_block_number,
  argMin(block_timestamp, block_number) AS first_block_timestamp,
  argMin(assets_per_share_normalized, block_number) AS first_assets_per_share_normalized,
  max(block_number) AS last_block_number,
  argMax(block_timestamp, block_number) AS last_block_timestamp,
  argMax(assets_per_share_normalized, block_number) AS last_assets_per_share_normalized,
  if(first_assets_per_share_normalized = 0, NULL,
     toFloat64(last_assets_per_share_normalized) / toFloat64(first_assets_per_share_normalized) - 1) AS growth,
  (last_block_timestamp - first_block_timestamp) / 3600 AS observed_hours,
  count() AS observation_count
FROM share_value_observations
WHERE _deleted_ = 0 AND call_ok = true /*@window*/
GROUP BY vault;
