import {
  AdminCreateUserCommand,
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
import { signInFrom } from "./infrastructure.ts";

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
}

/**
 * The deployment's user pool. Sign-in names are email addresses, in any case, and the ID a human's
 * sign-ins carry is their Cognito sub.
 */
export function cognitoHumans(cognito: CognitoIdentityProviderClient, userPoolId: string): Humans {
  return {
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
