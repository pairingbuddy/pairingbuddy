// Prompt data helpers. A value goes into a prompt as one JSON string with "<" escaped, so it cannot close its XML-ish tag or pass for an instruction.

function asPromptData(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// The corpus paths are evidence to read, one escaped JSON line per path, or 'none' when the corpus is empty or not an array.
function corpusBlock(corpus) {
  return Array.isArray(corpus) && corpus.length > 0 ? corpus.map(asPromptData).join('\n') : 'none';
}
