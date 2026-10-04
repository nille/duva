/** Whether the text is one email address, with no name, brackets or list around it. */
export const isEmailAddress = (text: string) => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(text);
