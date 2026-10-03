import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  type AttributeType,
  type CognitoIdentityProviderClient,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";

/** Where humans sign in: Cognito's user pool, or a stand-in in tests. */
export interface Humans {
  /**
   * Lets the human at `email` sign in, without a password, and returns the ID their sign-ins
   * carry, which is also their actor ID. Adding a human who can already sign in returns their ID.
   */
  add(email: string): Promise<string>;
}

/** The deployment's user pool. Sign-in names are email addresses, and each human's ID is their Cognito sub. */
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
  };
}

function sub(attributes: AttributeType[] | undefined): string {
  const value = attributes?.find(({ Name }) => Name === "sub")?.Value;
  if (value === undefined) throw new Error("Cognito gave the human no sub.");
  return value;
}
