# proto-deps

Vendored protobuf dependencies needed to compile `specs/vaultflows.proto` offline with `buf`.

| File | Source | Fetched |
|---|---|---|
| `sf/substreams/sink/sql/schema/v1/schema.proto` | https://raw.githubusercontent.com/streamingfast/substreams/develop/proto/sf/substreams/sink/sql/schema/v1/schema.proto (Apache-2.0, StreamingFast) | 2026-09-10 |

The BSR module `buf.build/streamingfast/substreams-sink-sql` is retired (its placeholder says the definitions
moved to `buf.build/streamingfast/substreams`), so Streamsmith builds a temporary buf workspace with this
directory as a second module instead of resolving BSR deps over the network.
