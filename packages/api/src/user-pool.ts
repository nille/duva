import {
  AdminCreateUserCommand,
  DeleteWebAuthnCredentialCommand,
  ListWebAuthnCredentialsCommand,
  ResourceNotFoundException,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  CodeMismatchException,
  ExpiredCodeException,
  NotAuthorizedException,
  RevokeTokenCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  type AttributeType,
  type CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
  type UpdateUserPoolCommandInput,
  UserNotFoundException,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import type { components } from "@duva/openapi";
import { signInFrom } from "./infrastructure.ts";

type Passkey = components["schemas"]["Passkey"];
type SignInSession = components["schemas"]["SignInSession"];

/** Where humans sign in: Cognito's user pool, or a stand-in in tests. */
export interface Humans {
  /**
   * Lets the human at `email` sign in, without a password, and returns the ID their sign-ins
   * carry. A new human's actor gets the same ID. Adding a human who can already sign in, whatever
   * the case of the address, returns their ID.
   */
  add(email: string): Promise<string>;
  /**
   * Deletes the human at `email`, so they can't sign in or renew a session, and returns the ID
   * their sign-ins carried, or undefined if they had none.
   */
  remove(email: string): Promise<string | undefined>;
  /**
   * Mails the human a sign-in code, as signing in does, and gives the session that checks it, as
   * before revealing a secret (ADR-0039).
   */
  sendSignInCode(email: string): Promise<string>;
  /** Whether the code is the one mailed to the human for the session, which it then ends. */
  checkSignInCode(email: string, session: string, code: string): Promise<boolean>;
  /**
   * Signs the human in with the token of a sign-in link, through the pool's custom challenge, whose
   * trigger checks the token and uses it up, and gives their new session, or undefined if the
   * trigger refused it (ADR-0041).
   */
  signInWithLink(email: string, token: string): Promise<SignInSession | undefined>;
  /** The passkeys of the human whose access token it is, newest first. Throws NoPasskeyAccess if the token may not list them. */
  passkeys(accessToken: string): Promise<Passkey[]>;
  /** Removes one of the passkeys of the human whose access token it is, and says whether they had it. Throws NoPasskeyAccess as passkeys does. */
  removePasskey(accessToken: string, id: string): Promise<boolean>;
}

/** The access token lacks the scope managing passkeys takes, as one from before passkeys. */
export class NoPasskeyAccess extends Error {}

/**
 * The deployment's user pool. Sign-in names are email addresses, in any case, and the ID a human's
 * sign-ins carry is their Cognito sub. Sign-in codes go through the app client `clientId`, by
 * choice-based sign-in with email codes, as managed login signs in.
 */
export function cognitoHumans(cognito: CognitoIdentityProviderClient, userPoolId: string, clientId: string): Humans {
  return {
    async sendSignInCode(email) {
      const { Session } = await cognito.send(
        new AdminInitiateAuthCommand({ UserPoolId: userPoolId, ClientId: clientId, AuthFlow: "USER_AUTH", AuthParameters: { USERNAME: email, PREFERRED_CHALLENGE: "EMAIL_OTP" } }),
      );
      if (Session === undefined) throw new Error("Cognito answered no sign-in session.");
      return Session;
    },
    async checkSignInCode(email, session, code) {
      try {
        const { AuthenticationResult } = await cognito.send(
          new AdminRespondToAuthChallengeCommand({ UserPoolId: userPoolId, ClientId: clientId, ChallengeName: "EMAIL_OTP", Session: session, ChallengeResponses: { USERNAME: email, EMAIL_OTP_CODE: code } }),
        );
        if (AuthenticationResult === undefined) return false;
        // The sign-in only proves the code: its session is ended at once.
        if (AuthenticationResult.RefreshToken !== undefined) await cognito.send(new RevokeTokenCommand({ ClientId: clientId, Token: AuthenticationResult.RefreshToken })).catch((error: unknown) => console.error(error));
        return true;
      } catch (error) {
        if (error instanceof CodeMismatchException || error instanceof ExpiredCodeException || error instanceof NotAuthorizedException) return false;
        throw error;
      }
    },
    async signInWithLink(email, token) {
      try {
        const { Session } = await cognito.send(new AdminInitiateAuthCommand({ UserPoolId: userPoolId, ClientId: clientId, AuthFlow: "CUSTOM_AUTH", AuthParameters: { USERNAME: email } }));
        const { AuthenticationResult: tokens } = await cognito.send(
          new AdminRespondToAuthChallengeCommand({ UserPoolId: userPoolId, ClientId: clientId, ChallengeName: "CUSTOM_CHALLENGE", Session, ChallengeResponses: { USERNAME: email, ANSWER: token } }),
        );
        if (tokens?.AccessToken === undefined || tokens.RefreshToken === undefined || tokens.ExpiresIn === undefined) return undefined;
        return { accessToken: tokens.AccessToken, refreshToken: tokens.RefreshToken, expiresIn: tokens.ExpiresIn };
      } catch (error) {
        // The trigger refused the token, or the human was removed meanwhile.
        if (error instanceof NotAuthorizedException || error instanceof UserNotFoundException) return undefined;
        throw error;
      }
    },
    async passkeys(accessToken) {
      const passkeys: Passkey[] = [];
      let NextToken: string | undefined;
      do {
        const page = await cognito.send(new ListWebAuthnCredentialsCommand({ AccessToken: accessToken, NextToken })).catch(scopeRefused);
        for (const { CredentialId, FriendlyCredentialName, CreatedAt } of page.Credentials ?? []) {
          if (CredentialId !== undefined && CreatedAt !== undefined) passkeys.push({ id: CredentialId, ...(FriendlyCredentialName && { name: FriendlyCredentialName }), createdAt: CreatedAt.toISOString() });
        }
        NextToken = page.NextToken;
      } while (NextToken !== undefined);
      return passkeys;
    },
    async removePasskey(accessToken, id) {
      try {
        await cognito.send(new DeleteWebAuthnCredentialCommand({ AccessToken: accessToken, CredentialId: id })).catch(scopeRefused);
        return true;
      } catch (error) {
        if (error instanceof ResourceNotFoundException) return false;
        throw error;
      }
    },
    async add(email) {
      try {
        // With no temporary password, the human never has one. Signing in with an emailed code
        // verifies the address, and Cognito sends no invitation.
        const { User } = await cognito.send(
          new AdminCreateUserCommand({
            UserPoolId: userPoolId,
            Username: email,
            UserAttributes: [
              { Name: "email", Value: email },
              { Name: "email_verified", Value: "true" },
            ],
            MessageAction: "SUPPRESS",
          }),
        );
        return sub(User?.Attributes);
      } catch (error) {
        if (!(error instanceof UsernameExistsException)) throw error;
        const { UserAttributes } = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
        return sub(UserAttributes);
      }
    },
    async remove(email) {
      try {
        const { UserAttributes } = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
        await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }));
        return sub(UserAttributes);
      } catch (error) {
        if (error instanceof UserNotFoundException) return undefined;
        throw error;
      }
    },
  };
}

/** Cognito answers NotAuthorizedException to a token without the aws.cognito.signin.user.admin scope (docs/aws.md). */
function scopeRefused(error: unknown): never {
  throw error instanceof NotAuthorizedException ? new NoPasskeyAccess(error.message) : error;
}

function sub(attributes: AttributeType[] | undefined): string {
  const value = attributes?.find(({ Name }) => Name === "sub")?.Value;
  if (value === undefined) throw new Error("Cognito gave the human no sub.");
  return value;
}

/** Where sign-in codes come from: the user pool's sender, or a stand-in in tests. */
export interface SignInSender {
  /** The domain the user pool sends sign-in codes from, or undefined while Cognito sends them itself. */
  domain(): Promise<string | undefined>;
  /** Sends sign-in codes from the domain from now on. Cognito refuses a domain SES hasn't verified. */
  sendFrom(domain: string): Promise<void>;
}

/** The settings UpdateUserPool takes, each of which it resets unless given, as DescribeUserPool names them. */
const poolSettings = [
  "Policies",
  "DeletionProtection",
  "LambdaConfig",
  "AutoVerifiedAttributes",
  "SmsVerificationMessage",
  "EmailVerificationMessage",
  "EmailVerificationSubject",
  "VerificationMessageTemplate",
  "SmsAuthenticationMessage",
  "UserAttributeUpdateSettings",
  "MfaConfiguration",
  "DeviceConfiguration",
  "SmsConfiguration",
  "UserPoolTags",
  "AdminCreateUserConfig",
  "UserPoolAddOns",
  "AccountRecoverySetting",
  "UserPoolTier",
] as const;

/**
 * The deployment's user pool's sender. Sign-in codes come from the domain's SES identity through
 * Duva's configuration set, as the stack sends them from the first domain. duva deploy gives the
 * stack the domain the pool has, so a deploy keeps what an admin chose.
 */
export function cognitoSignInSender(cognito: CognitoIdentityProviderClient, userPoolId: string, configurationSet: string): SignInSender {
  const describe = async () => {
    const { UserPool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: userPoolId }));
    if (UserPool === undefined) throw new Error(`Cognito has no user pool ${userPoolId}.`);
    return UserPool;
  };
  return {
    async domain() {
      const { EmailSendingAccount, SourceArn } = (await describe()).EmailConfiguration ?? {};
      // The SES identity's ARN ends in identity/<domain>.
      return EmailSendingAccount === "DEVELOPER" ? SourceArn?.split(":identity/")[1] : undefined;
    },
    async sendFrom(domain) {
      const pool = await describe();
      // UpdateUserPool resets every setting it isn't given, so each is given as the pool has it.
      const settings = Object.fromEntries(poolSettings.filter((name) => pool[name] !== undefined).map((name) => [name, pool[name]])) as Partial<UpdateUserPoolCommandInput>;
      // UnusedAccountValidityDays is the old name of the temporary password's lifetime, which Policies gives, so it is left out.
      if (settings.AdminCreateUserConfig !== undefined) {
        const { UnusedAccountValidityDays: _, ...adminCreateUser } = settings.AdminCreateUserConfig as typeof settings.AdminCreateUserConfig & { UnusedAccountValidityDays?: number };
        settings.AdminCreateUserConfig = adminCreateUser;
      }
      const [, , , region, account] = (pool.Arn ?? "").split(":");
      await cognito.send(
        new UpdateUserPoolCommand({
          ...settings,
          UserPoolId: userPoolId,
          PoolName: pool.Name,
          EmailConfiguration: {
            EmailSendingAccount: "DEVELOPER",
            SourceArn: `arn:aws:ses:${region}:${account}:identity/${domain}`,
            From: signInFrom(domain),
            ConfigurationSet: configurationSet,
          },
        }),
      );
    },
  };
}
