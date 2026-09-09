/**
 * Agent signer lifecycle: register the agent's authorization key as a key quorum, attach it to
 * the business wallet as an *additional signer* scoped by an override policy, and detach it.
 *
 * Facts:
 * - "Register the key quorum with Privy by making a POST request to https://api.privy.io/v1/key_quorums"
 *   with `public_keys` (base64 DER P-256) and `authorization_threshold`; the returned `id` is used
 *   as `signer_id` for additional signers.  https://docs.privy.io/controls/key-quorum/create
 * - Add signers (Node/REST): "Make a request to update the wallet with the desired
 *   `additional_signers` ... The wallet owner must sign the request."
 *   https://docs.privy.io/wallets/using-wallets/signers/add-signers
 * - Each signer entry: `{signer_id, override_policy_ids: [policyId]}`; "each signer can only have
 *   one override policy".  https://docs.privy.io/recipes/wallets/conditional-signer-policies
 * - Remove signers (Node/REST): "Make a request to update the wallet with the updated list of
 *   `additional_signers` you'd like on the wallet. The wallet owner must sign the request."
 *   https://docs.privy.io/wallets/using-wallets/signers/remove-signers
 *   PATCH replaces the list, so we read-modify-write.
 */
import {generateP256KeyPair, type KeyQuorum, type Wallet} from '@privy-io/node';
import {agentPublicKey, getPrivy, ownerAuth, publicKeyFromPrivateKey} from './privy.js';

export interface AgentAuthorizationKey {
  /** Key quorum id; use as `signer_id`. */
  keyQuorumId: string;
  publicKey: string;
  /** Only present when this function generated the key (no PRIVY_AGENT_AUTH_KEY supplied). */
  privateKey?: string;
  keyQuorum: KeyQuorum;
}

export interface CreateAgentKeyOptions {
  /** Existing agent private key (base64 PKCS8, `wallet-auth:` prefix ok). Defaults to PRIVY_AGENT_AUTH_KEY. */
  privateKey?: string;
  /** Generate a fresh keypair instead of using an env/provided key. */
  generate?: boolean;
  displayName?: string;
}

/**
 * Register the agent's P-256 public key with Privy as a 1-of-1 key quorum. The key quorum id is
 * what gets attached to the wallet as `signer_id`.
 */
export async function createAgentAuthorizationKey(opts: CreateAgentKeyOptions = {}): Promise<AgentAuthorizationKey> {
  const privy = getPrivy();
  let publicKey: string;
  let privateKey: string | undefined;
  if (opts.generate) {
    const pair = await generateP256KeyPair();
    publicKey = pair.publicKey;
    privateKey = pair.privateKey;
  } else if (opts.privateKey) {
    publicKey = publicKeyFromPrivateKey(opts.privateKey);
  } else {
    publicKey = agentPublicKey();
  }
  const keyQuorum = await privy.keyQuorums().create({
    public_keys: [publicKey],
    authorization_threshold: 1,
    display_name: opts.displayName ?? 'Vaultpilot agent signer',
  });
  return {keyQuorumId: keyQuorum.id, publicKey, keyQuorum, ...(privateKey ? {privateKey} : {})};
}

/**
 * Attach the agent key quorum as an additional signer with exactly one override policy.
 * Signed by the wallet owner (PRIVY_AUTH_KEY). Preserves other existing signers.
 */
export async function attachAgentSigner(walletId: string, keyId: string, policyId: string): Promise<Wallet> {
  const privy = getPrivy();
  const current = await privy.wallets().get(walletId);
  const others = (current.additional_signers ?? []).filter((s) => s.signer_id !== keyId);
  return privy.wallets().update(walletId, {
    additional_signers: [
      ...others.map((s) => ({signer_id: s.signer_id, ...(s.override_policy_ids ? {override_policy_ids: s.override_policy_ids} : {})})),
      {signer_id: keyId, override_policy_ids: [policyId]},
    ],
    authorization_context: ownerAuth(),
  });
}

/**
 * Revoke the agent: rewrite `additional_signers` without its key quorum id. Signed by the owner.
 * After this the agent's key can no longer sign anything on the wallet.
 */
export async function detachAgentSigner(walletId: string, keyId: string): Promise<Wallet> {
  const privy = getPrivy();
  const current = await privy.wallets().get(walletId);
  const remaining = (current.additional_signers ?? []).filter((s) => s.signer_id !== keyId);
  return privy.wallets().update(walletId, {
    additional_signers: remaining.map((s) => ({
      signer_id: s.signer_id,
      ...(s.override_policy_ids ? {override_policy_ids: s.override_policy_ids} : {}),
    })),
    authorization_context: ownerAuth(),
  });
}
