// Where in the web app the links Duva mails lead, before their token: the API builds them, and the
// web app follows them (ADR-0041).

/** A sign-in link, which signs its human in once. */
export const signInLinkRoute = "#/sign-in/";

/** The link that confirms a new recovery address. */
export const recoveryLinkRoute = "#/recovery/";
