import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import type { FastifyRequest } from 'fastify';

// Original project hardcoded these by request (committed to git, not from
// env) since the app registration enforces single-tenant at the Azure Portal
// level. Redacted here for the portfolio copy — set real values to run this
// locally.
const CLIENT_ID = process.env.AZURE_CLIENT_ID || 'REDACTED';
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || 'REDACTED';
const AUTHORITY = 'https://login.microsoftonline.com/organizations';

const SCOPES = ['openid', 'profile', 'email'];

const cca = new ConfidentialClientApplication({
  auth: {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authority: AUTHORITY,
  },
});

const cryptoProvider = new CryptoProvider();

export interface AzurePkce {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export async function generatePkce(): Promise<AzurePkce> {
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes();
  const state = cryptoProvider.createNewGuid();
  return { state, codeVerifier: verifier, codeChallenge: challenge };
}

export async function getAuthCodeUrl(
  state: string,
  codeChallenge: string,
  redirectUri: string,
): Promise<string> {
  return cca.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod: 'S256',
    // Force Microsoft to show the account picker every time. Without this, a
    // browser that's already signed into a work account silently re-uses it,
    // so a user who logged out of our app can't switch to a different MS
    // account on their next sign-in.
    prompt: 'select_account',
  });
}

export interface AzureClaims {
  oid: string;
  email: string | null;
  tid: string;
  name: string | null;
}

export async function acquireTokenByCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<AzureClaims> {
  const tokenResponse = await cca.acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri,
    codeVerifier,
  });
  if (!tokenResponse?.idTokenClaims) {
    throw new Error('azure_no_id_token');
  }
  const claims = tokenResponse.idTokenClaims as Record<string, unknown>;
  const oid = typeof claims.oid === 'string' ? claims.oid : null;
  const tid = typeof claims.tid === 'string' ? claims.tid : null;
  if (!oid || !tid) throw new Error('azure_missing_oid_or_tid');
  const email =
    (typeof claims.email === 'string' && claims.email) ||
    (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
    (typeof claims.upn === 'string' && claims.upn) ||
    null;
  const name = typeof claims.name === 'string' ? claims.name : null;
  return {
    oid,
    email: email ? email.toLowerCase() : null,
    tid,
    name,
  };
}

// Build the redirect_uri from the incoming request. Must match exactly what's
// registered in the Azure App registration's "Redirect URIs" list. Honors
// x-forwarded-proto / x-forwarded-host so it works behind a reverse proxy
// (Railway, Cloudflare, etc.) without needing an env var.
export function buildRedirectUri(req: FastifyRequest): string {
  const fwdProto = req.headers['x-forwarded-proto'];
  const proto =
    (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto?.split(',')[0]?.trim()) ||
    req.protocol ||
    'http';
  const fwdHost = req.headers['x-forwarded-host'];
  const host =
    (Array.isArray(fwdHost) ? fwdHost[0] : fwdHost?.split(',')[0]?.trim()) ||
    req.headers.host;
  return `${proto}://${host}/api/auth/azure/callback`;
}
