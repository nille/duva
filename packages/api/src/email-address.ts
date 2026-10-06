/** The domain of an email address, the part after its last @. */
export const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);

/** Whether the text is one email address, with no name, brackets or list around it. */
export const isEmailAddress = (text: string) => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(text);
