require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const config = require("./config");
// ── IMPORTANT: Fill these in ──────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Log approved leave so your inactivity timer is paused.")
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("Number of leave days")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(60),
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check your own (or another member's) activity status.")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Member to check (leave blank for yourself)")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("resetactivity")
    .setDescription("[Admin] Manually reset a member's last activity to now.")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Target member").setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("grantleave")
    .setDescription("[Admin] Grant approved leave days to a member.")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Target member").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("Number of leave days to grant")
        .setRequired(true)
        .setMinValue(1),
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(config.TOKEN);

(async () => {
  try {
    console.log("🔄 Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
      ),
      {
        body: commands,
      },
    );
    console.log("✅ Slash commands registered successfully!");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
})();
