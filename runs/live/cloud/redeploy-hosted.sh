#!/bin/bash
# Hosted redeploy: run after a fresh Portal device login has written .portal-token.json
set -euo pipefail; cd "$(dirname "$0")/../../.."; set -a; source .env; set +a
TOK=$(python3 -c "import json; d=json.load(open('.portal-token.json')); print(d.get('accessToken') or d.get('access_token'))")
H=https://admin.streamingfast.io/sf.portalapi.v1.HostedService
P(){ curl -s --max-time 40 -X POST "$H/$1" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d "$2"; }
echo "--- UpdateDeploymentConfig (no parameters field) ---"
P UpdateDeploymentConfig "{\"deployment_id\":\"$HOSTED_DEPLOYMENT_ID\",\"organization_id\":\"$PORTAL_ORG_ID\",\"deployment_request\":{\"sink_sql_deployment\":{\"spkg\":{\"url\":\"https://api.substreams.dev/v1/packages/erc4626-flows/v0.1.0\"},\"network\":\"base\",\"replica\":1,\"execution_config\":{\"start_block\":51001200,\"output_module\":\"map_events\",\"module_output_type\":\"proto:vaultflows.v1.Events\"},\"outputConfig\":{\"clickhouse\":{\"server\":\"$CH_CLOUD_HOST\",\"port\":9440,\"user\":\"default\",\"database\":\"vaultflows_hosted\",\"secure\":true}}}}}" | cut -c1-300; echo
echo "--- state ---"; P GetDeploymentState "{\"deployment_id\":\"$HOSTED_DEPLOYMENT_ID\",\"organization_id\":\"$PORTAL_ORG_ID\"}" | cut -c1-400; echo
