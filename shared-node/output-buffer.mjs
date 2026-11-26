// How much output one child process may print before Node kills it with ENOBUFS. Node's default is 1 MB, which one large
// git diff passes; every git, gh or test-runner call that reads output takes this one limit instead.
export const OUTPUT_MAX_BUFFER = 256 * 1024 * 1024;
