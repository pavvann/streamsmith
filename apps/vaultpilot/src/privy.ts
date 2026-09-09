/**
 * Privy client initialisation and authorization-key helpers.
 *
 * Facts (see docs/build/privy-facts.md for citations):
 * - SDK: `@privy-io/node`, `new PrivyClient({appId, appSecret})`.
 *   https://docs.privy.io/basics/nodeJS/setup
 * - Authorization keys are P-256 keypairs. Private key = base64 PKCS8 DER (no PEM headers);
 *   public key = base64 SPKI DER. The Dashboard shows the private key with a `wallet-auth:`
 *   prefix which the SDK strips.  https://docs.privy.io/controls/authorization-keys/keys/create/key
 * - Requests on owned resources are signed by passing
 *   `authorization_context: {authorization_private_keys: [...]}` to SDK methods.
 *   https://docs.privy.io/controls/authorization-keys/using-owners/sign/signing-on-the-server
 */
import {createPrivateKey, createPublicKey} from 'node:crypto';
import {PrivyClient, type AuthorizationContext} from '@privy-io/node';
import {env} from './env.js';

let client: PrivyClient | undefined;

/** Lazily construct the PrivyClient from PRIVY_APP_ID / PRIVY_APP_SECRET. */
export function getPrivy(): PrivyClient {
  if (!client) {
    client = new PrivyClient({appId: env('PRIVY_APP_ID'), appSecret: env('PRIVY_APP_SECRET')});
  }
  return client;
}

/** Strip the optional Dashboard prefix; return base64 PKCS8 DER. */
export function normalizePrivateKey(key: string): string {
  return key.trim().replace(/^wallet-auth:/, '').replace(/^wallet-api:/, '').replace(/\s+/g, '');
}

/**
 * Derive the base64 SPKI public key (the format Privy accepts as `owner.public_key` and in
 * `key_quorums.public_keys`) from a base64 PKCS8 private key. Pure Node crypto.
 */
export function publicKeyFromPrivateKey(privateKey: string): string {
  const pkcs8 = Buffer.from(normalizePrivateKey(privateKey), 'base64');
  const priv = createPrivateKey({key: pkcs8, format: 'der', type: 'pkcs8'});
  if (priv.asymmetricKeyType !== 'ec') {
    throw new Error(`Authorization key must be an EC (P-256) key, got ${priv.asymmetricKeyType}`);
  }
  return createPublicKey(priv).export({format: 'der', type: 'spki'}).toString('base64');
}

/** Authorization context for the human/treasurer key that owns the wallet and policy. */
export function ownerAuth(): AuthorizationContext {
  return {authorization_private_keys: [normalizePrivateKey(env('PRIVY_AUTH_KEY'))]};
}

/** Authorization context for the agent's additional-signer key. */
export function agentAuth(): AuthorizationContext {
  return {authorization_private_keys: [normalizePrivateKey(env('PRIVY_AGENT_AUTH_KEY'))]};
}

export function ownerPublicKey(): string {
  return publicKeyFromPrivateKey(env('PRIVY_AUTH_KEY'));
}

export function agentPublicKey(): string {
  return publicKeyFromPrivateKey(env('PRIVY_AGENT_AUTH_KEY'));
}
