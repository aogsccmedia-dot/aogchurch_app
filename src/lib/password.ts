// Password rules for sign-up and resets. Hashing lives in crypto.ts (PBKDF2-SHA256, shared with FreeCreator accounts).
export { hashPassword, verifyPassword } from "./crypto.ts";

/** Simple, kind rules: at least 8 characters, not just one repeated character, not a well-known password. */
export function passwordProblem(pw: string, email = ""): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(pw)) return "Choose something less predictable.";
  const common = ["password", "password1", "12345678", "123456789", "qwerty123", "11111111", "iloveyou", "jesus123", "jesuslovesme", "sandton123", "church123"];
  if (common.includes(pw.toLowerCase())) return "That password is too common. Try a short phrase you'll remember.";
  if (email && pw.toLowerCase() === email.toLowerCase()) return "Don't use your email as your password.";
  return null;
}
