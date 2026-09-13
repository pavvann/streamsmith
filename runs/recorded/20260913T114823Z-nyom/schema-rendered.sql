-- vaultflows_rec.vault_flows
CREATE TABLE vaultflows_rec.vault_flows
(
    `_block_number_` UInt64,
    `_block_timestamp_` DateTime,
    `_version_` Int64,
    `_deleted_` Bool,
    `id` String,
    `chain_id` UInt32,
    `block_number` UInt64,
    `block_hash` String,
    `block_timestamp` UInt64,
    `tx_hash` String,
    `log_index` UInt32,
    `vault` String,
    `caller` String,
    `owner` String,
    `receiver` String,
    `direction` String,
    `assets_raw` UInt256,
    `shares_raw` UInt256,
    `assets_normalized` Decimal(38, 18),
    `shares_normalized` Decimal(38, 18),
    `asset_decimals` UInt32,
    `share_decimals` UInt32,
    `execution_rate` Decimal(38, 18),
    `meta_valid` Bool,
    `call_ok` Bool,
    `call_error` String
)
ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _version_, _deleted_)
PARTITION BY toYYYYMM(_block_timestamp_)
PRIMARY KEY id
ORDER BY (id, vault, block_number)
SETTINGS allow_experimental_replacing_merge_with_cleanup = 1, index_granularity = 8192;

-- vaultflows_rec.share_value_observations
CREATE TABLE vaultflows_rec.share_value_observations
(
    `_block_number_` UInt64,
    `_block_timestamp_` DateTime,
    `_version_` Int64,
    `_deleted_` Bool,
    `id` String,
    `chain_id` UInt32,
    `block_number` UInt64,
    `block_hash` String,
    `block_timestamp` UInt64,
    `vault` String,
    `sample_interval_blocks` UInt32,
    `assets_per_share_raw` UInt256,
    `assets_per_share_normalized` Decimal(38, 18),
    `total_assets_raw` UInt256,
    `total_supply_raw` UInt256,
    `call_ok` Bool,
    `call_error` String
)
ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _version_, _deleted_)
PARTITION BY toYYYYMM(_block_timestamp_)
PRIMARY KEY id
ORDER BY (id, vault, block_number)
SETTINGS allow_experimental_replacing_merge_with_cleanup = 1, index_granularity = 8192;

-- vaultflows_rec.vaults
CREATE TABLE vaultflows_rec.vaults
(
    `_block_number_` UInt64,
    `_block_timestamp_` DateTime,
    `_version_` Int64,
    `_deleted_` Bool,
    `id` String,
    `chain_id` UInt32,
    `vault` String,
    `first_seen_block` UInt64,
    `asset` String,
    `asset_decimals` UInt32,
    `share_decimals` UInt32,
    `name` String,
    `symbol` String,
    `compliant` Bool,
    `in_configured_list` Bool,
    `call_ok` Bool,
    `call_error` String
)
ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _version_, _deleted_)
PARTITION BY toYYYYMM(_block_timestamp_)
PRIMARY KEY id
ORDER BY id
SETTINGS allow_experimental_replacing_merge_with_cleanup = 1, index_granularity = 8192;

-- vaultflows_rec.share_transfers
CREATE TABLE vaultflows_rec.share_transfers
(
    `_block_number_` UInt64,
    `_block_timestamp_` DateTime,
    `_version_` Int64,
    `_deleted_` Bool,
    `id` String,
    `chain_id` UInt32,
    `block_number` UInt64,
    `block_hash` String,
    `block_timestamp` UInt64,
    `tx_hash` String,
    `log_index` UInt32,
    `vault` String,
    `from_owner` String,
    `to_owner` String,
    `shares_raw` UInt256,
    `shares_normalized` Decimal(38, 18),
    `share_decimals` UInt32,
    `meta_valid` Bool
)
ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _version_, _deleted_)
PARTITION BY toYYYYMM(_block_timestamp_)
PRIMARY KEY id
ORDER BY (id, vault, block_number)
SETTINGS allow_experimental_replacing_merge_with_cleanup = 1, index_granularity = 8192;
