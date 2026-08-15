export interface AuthenticationEmail {
  email: string;
  displayName: string;
  tenantSlug: string;
  token: string;
}

export interface InvitationEmail extends AuthenticationEmail {
  tenantName: string;
  roles: string[];
}

export abstract class AuthenticationNotifier {
  abstract sendEmailVerification(message: AuthenticationEmail): Promise<void>;
  abstract sendPasswordReset(message: AuthenticationEmail): Promise<void>;
  abstract sendInvitation(message: InvitationEmail): Promise<void>;
}
