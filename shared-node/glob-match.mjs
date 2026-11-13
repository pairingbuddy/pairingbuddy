// Pure glob matching for config_globs. A pattern without a slash matches the file name anywhere (like .gitignore);
// one with a slash matches the whole repo-relative path. * stays inside one directory, ** crosses directories, ? is one character.
const escaped = (char) => char.replace(/[.+^${}()|[\]\\]/g, "\\$&");

function toRegExp(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += escaped(char);
  }
  return new RegExp(`^${source}$`);
}

export function matchesGlob(pattern, path) {
  const subject = pattern.includes("/") ? path : path.split("/").at(-1);
  return toRegExp(pattern.replace(/^\//, "")).test(subject);
}

// The files that no glob covers.
export function outsideGlobs(globs, files) {
  return files.filter((file) => !globs.some((glob) => matchesGlob(glob, file)));
}
