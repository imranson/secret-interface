// Account rules, shared by the server and the sign-in form.

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/
export const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 256

/** Why `username` can't be used, or null if it can. */
export function usernameProblem(username: string): string | null {
  return USERNAME_PATTERN.test(username)
    ? null
    : 'Usernames are 3–32 characters: letters, numbers, dots, dashes and underscores.'
}

/** Why `password` can't be used, or null if it can. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password.length > MAX_PASSWORD_LENGTH) return `Passwords can be at most ${MAX_PASSWORD_LENGTH} characters.`
  return null
}
