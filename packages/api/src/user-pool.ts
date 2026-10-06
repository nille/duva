import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  type AttributeType,
  type CognitoIdentityProviderClient,
  UserNotFoundException,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";

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
