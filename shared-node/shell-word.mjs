// One shell word for a path or an argument, unchanged when a shell would read it as it stands. Workflow bundles inline
// this file, so it imports nothing.
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

export const shellWord = (word) => (SHELL_SAFE.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);
