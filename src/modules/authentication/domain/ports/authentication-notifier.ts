export interface AuthenticationEmail {
  email: string;
  displayName: string;
  tenantSlug: string;
  token: string;
}

export abstract class AuthenticationNotifier {
  abstract sendEmailVerification(message: AuthenticationEmail): Promise<void>;
  abstract sendPasswordReset(message: AuthenticationEmail): Promise<void>;
}
