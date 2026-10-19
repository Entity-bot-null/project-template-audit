/** The application a signed request comes from (AppSignatureGuard). */
export interface AuthenticatedApp {
  appId: string;
  slug: string;
  keyId: string;
}
