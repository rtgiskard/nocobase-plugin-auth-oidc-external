export interface ExternalOIDCOptions {
  issuer: string;
  clientId: string;
  clientSecretEnv?: string;
  clientSecret?: string;
  redirectUri: string;
  scope: string;
  autoSignUp: boolean;
  tokenEndpointAuthMethod?: 'client_secret_post' | 'client_secret_basic';
  usernameClaim: string;
  nicknameClaim: string;
  emailClaim: string;
  buttonLabel: string;
  buttonHint: string;
}

export interface OIDCStatePayload {
  authenticator: string;
  callbackPath: string;
  codeVerifier: string;
  nonce: string;
  redirectTo: string;
  flowCookieHash: string;
  clientBindingHash: string;
  createdAt: number;
}

export interface OIDCCallbackTicketPayload {
  authenticator: string;
  claims: OIDCClaims;
  redirectTo: string;
  flowCookieHash: string;
  clientBindingHash: string;
  createdAt: number;
}

export interface OIDCClaims extends Record<string, unknown> {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  groups?: string[];
}
