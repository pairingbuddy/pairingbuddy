// Helpers for the mistake check: compare approaches and findings across attempts. No imports, no Node APIs.
export const normalizeApproach = (approach) => String(approach ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// The file part of a finding's where: drops a trailing :line or :line-line suffix.
export const fileOfWhere = (where) => where.replace(/:\d+(-\d+)?$/, "");
// The identity of a mistake: its rule, the file it is in and the mistake name, so line moves do not change it.
export const mistakeKey = (finding, mistake) => JSON.stringify([finding.rule, fileOfWhere(finding.where), mistake]);
