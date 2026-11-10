// The JSON object a relayed CLI printed, or null when there is none. The relay may carry text around the JSON, so this slices from the first '{' to the last '}'. A missing output (undefined) yields null too.
function relayedJson(text) {
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}
