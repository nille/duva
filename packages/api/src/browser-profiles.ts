// Each human's AgentCore Browser profile (ADR-0038): the cookies and local storage their Coo's
// browsing keeps between sessions, so a site it logged in to once stays open to it. A profile is
// named for its human, which the account holds once (docs/aws.md), so it is found by its name, and
// the runtime creates it on the human's first browsing run. Signing Coo out of every site deletes
// it, and so does removing the human.
import { BedrockAgentCoreControlClient, ConflictException, CreateBrowserProfileCommand, DeleteBrowserProfileCommand, ListBrowserProfilesCommand, ResourceNotFoundException } from "@aws-sdk/client-bedrock-agentcore-control";
import { browserProfileTag } from "./infrastructure.ts";

/** The name of the human's profile: letters, digits and underscores, as AgentCore takes them. */
export const profileName = (human: string) => `duva_${human.replaceAll("-", "")}`;

/** Where the profiles are deleted from: AgentCore in a deployment, a stand-in in tests. */
export interface BrowserProfiles {
  /** Deletes the human's profile, if they have one, so their Coo is signed out of every site. */
  forget(human: string): Promise<void>;
}

/** The ID of the profile of the name, if there is one. */
async function profileNamed(control: BedrockAgentCoreControlClient, name: string): Promise<string | undefined> {
  let nextToken: string | undefined;
  do {
    const listed = await control.send(new ListBrowserProfilesCommand({ name, ...(nextToken !== undefined && { nextToken }) }));
    const found = listed.profileSummaries?.find((profile) => profile.name === name && profile.status !== "DELETED" && profile.status !== "DELETING");
    if (found !== undefined) return found.profileId;
    nextToken = listed.nextToken;
  } while (nextToken !== undefined);
  return undefined;
}

/** The ID of the profile of the name, created if it is the first. Two runs creating it at once both get the one. */
export async function profileFor(control: BedrockAgentCoreControlClient, name: string): Promise<string> {
  const found = await profileNamed(control, name);
  if (found !== undefined) return found;
  try {
    return (await control.send(new CreateBrowserProfileCommand({ name, description: "A Duva human's Coo's logins", tags: { [browserProfileTag.key]: browserProfileTag.value } }))).profileId!;
  } catch (error) {
    if (!(error instanceof ConflictException)) throw error;
    const made = await profileNamed(control, name);
    if (made === undefined) throw error;
    return made;
  }
}

/** The humans' profiles in AgentCore, in the deployment's region, or none where the stack left the browser out, giving its ID as empty. */
export function agentCoreBrowserProfiles(browserId: string): BrowserProfiles {
  if (browserId === "") return { forget: async () => {} };
  const control = new BedrockAgentCoreControlClient({});
  return {
    async forget(human) {
      const id = await profileNamed(control, profileName(human));
      if (id === undefined) return;
      await control.send(new DeleteBrowserProfileCommand({ profileId: id })).catch((error: unknown) => {
        if (!(error instanceof ResourceNotFoundException)) throw error;
      });
    },
  };
}
