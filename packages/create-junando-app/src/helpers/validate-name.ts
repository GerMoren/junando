/**
 * Validates an npm-compatible project name (basename of target dir).
 * Rules: letters/digits/dots/hyphens/underscores; must start with letter or digit.
 * Matches the practical subset of npm's package name spec we expose to users.
 */
export function isValidProjectName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(name);
}
