require("dotenv").config();
module.exports = {
  TOKEN: process.env.DISCORD_TOKEN,

  // ── Inactivity Thresholds ──────────────────────────────────────────────────
  WARN_AFTER_DAYS: 3,
  REMOVE_ROLES_AFTER_DAYS: 4,

  // ── Protected Roles ────────────────────────────────────────────────────────
  PROTECTED_ROLES: ["AI/ML", "Web", "Compiler"],
};
