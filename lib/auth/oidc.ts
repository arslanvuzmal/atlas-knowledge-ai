import { prisma } from '@/lib/database/client';
import { logger } from '@/lib/observability/logger';

/**
 * OIDC/SSO Integration Boundaries
 *
 * This module defines clean integration points for external identity providers.
 * It does not implement a full SSO system but provides the boundaries where
 * one would plug in.
 */

export interface OidcProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  claimMapping: {
    subject: string; // e.g., 'sub'
    email: string; // e.g., 'email'
    name: string; // e.g., 'name'
    roles?: string; // e.g., 'groups' or custom claim
  };
  pkce?: boolean;
}

export interface ExternalIdentity {
  provider: string;
  providerSubject: string;
  email: string;
  name: string;
  roles?: string[];
  rawClaims: Record<string, unknown>;
}

export interface OidcAuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    isNew: boolean;
  };
  sessionId: string;
}

/**
 * Registry of configured OIDC providers.
 * In production, this would be loaded from database/config.
 */
const oidcProviders = new Map<string, OidcProviderConfig>();

/**
 * Registers an OIDC provider configuration.
 */
export function registerOidcProvider(name: string, config: OidcProviderConfig): void {
  oidcProviders.set(name, config);
  logger.info('OIDC provider registered', { name, issuer: config.issuer });
}

/**
 * Gets an OIDC provider configuration.
 */
export function getOidcProvider(name: string): OidcProviderConfig | undefined {
  return oidcProviders.get(name);
}

/**
 * Lists all registered OIDC providers.
 */
export function listOidcProviders(): Array<{ name: string; config: OidcProviderConfig }> {
  return Array.from(oidcProviders.entries()).map(([name, config]) => ({ name, config }));
}

/**
 * Validates an OIDC configuration without making network calls.
 */
export function validateOidcConfig(config: OidcProviderConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.issuer || !config.issuer.startsWith('https://')) {
    errors.push('Issuer must be a valid HTTPS URL');
  }

  if (!config.clientId) {
    errors.push('Client ID is required');
  }

  if (!config.clientSecret) {
    errors.push('Client secret is required');
  }

  if (!config.claimMapping.subject) {
    errors.push('Subject claim mapping is required');
  }

  if (!config.claimMapping.email) {
    errors.push('Email claim mapping is required');
  }

  if (!config.claimMapping.name) {
    errors.push('Name claim mapping is required');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generates the authorization URL for an OIDC provider.
 * The actual redirect would be handled by the frontend.
 */
export function generateOidcAuthUrl(
  providerName: string,
  redirectUri: string,
  state: string,
): string | null {
  const config = oidcProviders.get(providerName);
  if (!config) return null;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state,
  });

  if (config.pkce) {
    // PKCE would be implemented here with code_verifier/code_challenge
    params.set('code_challenge_method', 'S256');
    // code_challenge would be added
  }

  return `${config.issuer}/authorize?${params.toString()}`;
}

/**
 * Exchanges an authorization code for tokens.
 * This is a boundary - the actual implementation would call the token endpoint.
 */
export async function exchangeOidcCode(
  providerName: string,
  _code: string,
  _redirectUri: string,
): Promise<{ accessToken: string; idToken?: string; refreshToken?: string } | null> {
  const config = oidcProviders.get(providerName);
  if (!config) return null;

  // Boundary: actual HTTP call to token endpoint would go here
  // const response = await fetch(`${config.issuer}/token`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  //   body: new URLSearchParams({
  //     grant_type: 'authorization_code',
  //     code,
  //     redirect_uri: redirectUri,
  //     client_id: config.clientId,
  //     client_secret: config.clientSecret,
  //   }),
  // });

  // Placeholder - real implementation would make the HTTP call
  logger.warn('OIDC code exchange not implemented', { provider: providerName });
  return null;
}

/**
 * Validates an ID token and extracts claims.
 * This is a boundary - the actual implementation would verify the JWT signature.
 */
export function validateOidcIdToken(
  providerName: string,
  _idToken: string,
): { valid: boolean; claims?: Record<string, unknown>; error?: string } {
  const config = oidcProviders.get(providerName);
  if (!config) return { valid: false, error: 'Provider not configured' };

  // Boundary: actual JWT verification would go here
  // Would use jose or similar library to verify signature against provider's JWKS
  logger.warn('OIDC ID token validation not implemented', { provider: providerName });
  return { valid: false, error: 'Not implemented' };
}

/**
 * Maps external identity claims to internal user representation.
 */
export function mapExternalIdentity(
  providerName: string,
  claims: Record<string, unknown>,
): ExternalIdentity | null {
  const config = oidcProviders.get(providerName);
  if (!config) return null;

  const getClaim = (path: string): unknown => {
    const parts = path.split('.');
    let current: unknown = claims;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  };

  const subject = getClaim(config.claimMapping.subject);
  const email = getClaim(config.claimMapping.email);
  const name = getClaim(config.claimMapping.name);

  if (!subject || !email || !name) {
    return null;
  }

  let roles: string[] | undefined;
  if (config.claimMapping.roles) {
    const rolesClaim = getClaim(config.claimMapping.roles);
    if (Array.isArray(rolesClaim)) {
      roles = rolesClaim.map(String);
    } else if (typeof rolesClaim === 'string') {
      roles = [rolesClaim];
    }
  }

  return {
    provider: providerName,
    providerSubject: String(subject),
    email: String(email),
    name: String(name),
    roles,
    rawClaims: claims,
  };
}

/**
 * Finds or creates a user from an external identity.
 * This is the integration point for account linking/provisioning.
 */
export async function findOrCreateUserFromExternal(
  external: ExternalIdentity,
): Promise<{ userId: string; isNew: boolean }> {
  // Check if this external identity is already linked
  const existing = await prisma.user.findFirst({
    where: {
      externalId: `${external.provider}:${external.providerSubject}`,
    },
    select: { id: true },
  });

  if (existing) {
    // Update last login
    await prisma.user.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date() },
    });
    return { userId: existing.id, isNew: false };
  }

  // Check if email already exists (account linking)
  const byEmail = await prisma.user.findUnique({
    where: { email: external.email },
    select: { id: true, externalId: true },
  });

  if (byEmail) {
    // Link the external identity to existing account
    await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        externalId: `${external.provider}:${external.providerSubject}`,
        lastLoginAt: new Date(),
      },
    });
    return { userId: byEmail.id, isNew: false };
  }

  // Create new user (role assignment would be handled by admin policy)
  const user = await prisma.user.create({
    data: {
      name: external.name,
      email: external.email,
      externalId: `${external.provider}:${external.providerSubject}`,
      role: 'CUSTOMER', // Default role; admin can change later
      status: 'ACTIVE',
      isDemo: false,
    },
    select: { id: true },
  });

  return { userId: user.id, isNew: true };
}

/**
 * Initiates an OIDC login flow.
 * Returns the authorization URL to redirect the user to.
 */
export function initiateOidcLogin(
  providerName: string,
  redirectUri: string,
): { authUrl: string; state: string } | null {
  const config = oidcProviders.get(providerName);
  if (!config) return null;

  const state = crypto.randomUUID();
  const authUrl = generateOidcAuthUrl(providerName, redirectUri, state);

  if (!authUrl) return null;

  // In a real implementation, the state would be stored server-side
  // with a short TTL for CSRF protection

  return { authUrl, state };
}

/**
 * Completes an OIDC login flow.
 * Exchanges the code, validates the token, and returns a session.
 */
export async function completeOidcLogin(
  providerName: string,
  code: string,
  redirectUri: string,
): Promise<OidcAuthResult | null> {
  const tokens = await exchangeOidcCode(providerName, code, redirectUri);
  if (!tokens || !tokens.idToken) return null;

  const validation = validateOidcIdToken(providerName, tokens.idToken);
  if (!validation.valid || !validation.claims) return null;

  const external = mapExternalIdentity(providerName, validation.claims);
  if (!external) return null;

  const { userId, isNew } = await findOrCreateUserFromExternal(external);

  // Get the user to return their role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) return null;

  // Create session (this would use the existing session system)
  // For now, return the user info; session creation would be handled by the caller
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isNew,
    },
    sessionId: '', // Would be set by session creation
  };
}

/**
 * Gets the list of configured providers for the login page.
 */
export function getConfiguredOidcProviders(): Array<{ name: string; label: string }> {
  return Array.from(oidcProviders.entries()).map(([name, config]) => ({
    name,
    label: config.issuer.replace('https://', '').split('/')[0],
  }));
}
