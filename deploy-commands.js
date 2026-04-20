require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const config = require("./config");

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

  new SlashCommandBuilder()
    .setName("setintern")
    .setDescription("[Admin] Record when a member became an intern.")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Target member").setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("date")
        .setDescription("Intern start date (YYYY-MM-DD). Defaults to today.")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("syncactivity")
    .setDescription(
      "[Admin] Scan message history to backfill a member's last activity timestamp.",
    )
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Member to sync (leave blank to sync ALL interns)")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("forcecheck")
    .setDescription(
      "[Admin] Immediately run the inactivity check (don't wait for the hourly cron).",
    ),

  new SlashCommandBuilder()
    .setName("debuguser")
    .setDescription(
      "[Admin] Show raw DB data for a member to diagnose inactivity issues.",
    )
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Member to inspect (leave blank for yourself)")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("testwarn")
    .setDescription(
      "[Admin] Force-send an inactivity warning for a specific user right now.",
    )
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Target member").setRequired(true),
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
      { body: commands },
    );
    console.log("✅ Slash commands registered successfully!");
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
})();
