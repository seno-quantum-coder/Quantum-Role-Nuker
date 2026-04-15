const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");
const cron = require("node-cron");
const db = require("./database");
const config = require("./config");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// ─── On Ready ────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ QuantumLogics Bot is online as ${client.user.tag}`);
  await db.initialize();
  startInactivityChecker();
});

// ─── Track Message Activity ───────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  await db.recordActivity(message.guild.id, message.author.id);
});

// ─── Track Voice Activity ─────────────────────────────────────────────────────
client.on("voiceStateUpdate", async (oldState, newState) => {
  // User joined a voice channel
  if (!oldState.channelId && newState.channelId) {
    if (newState.member && !newState.member.user.bot) {
      await db.recordActivity(newState.guild.id, newState.member.id);
    }
  }
});

// ─── Track Members Joining (reset their timer) ───────────────────────────────
client.on("guildMemberAdd", async (member) => {
  await db.recordActivity(member.guild.id, member.id);
  console.log(
    `👋 New member joined: ${member.user.tag} — activity timer started.`,
  );
});

// ─── Slash Commands ───────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "leave") {
    const days = interaction.options.getInteger("days");
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    await db.setLeave(guildId, userId, days);
    await interaction.reply({
      content: `✅ Leave recorded! You have **${days} day(s)** of approved leave. These won't count toward your inactivity timer.`,
      ephemeral: true,
    });
    console.log(`🏖️ ${interaction.user.tag} took ${days} day(s) of leave.`);
  }

  if (commandName === "status") {
    const userId =
      interaction.options.getUser("user")?.id || interaction.user.id;
    const guildId = interaction.guild.id;
    const data = await db.getMemberData(guildId, userId);

    if (!data) {
      return interaction.reply({
        content: "❓ No activity data found for this user.",
        ephemeral: true,
      });
    }

    const activeDays = await db.getConsecutiveActiveDays(guildId, userId);
    const leaveLeft = data.leaveBalance || 0;
    const lastSeen = data.lastActivity
      ? `<t:${Math.floor(data.lastActivity / 1000)}:R>`
      : "Never";

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 Activity Status`)
      .setDescription(`<@${userId}>`)
      .addFields(
        { name: "🕐 Last Active", value: lastSeen, inline: true },
        {
          name: "📅 Consecutive Active Days",
          value: `${activeDays} day(s)`,
          inline: true,
        },
        {
          name: "🏖️ Leave Balance Remaining",
          value: `${leaveLeft} day(s)`,
          inline: true,
        },
        {
          name: "⚠️ Warning Sent",
          value: data.warningSent ? "Yes" : "No",
          inline: true,
        },
      )
      .setFooter({ text: "QuantumLogics Activity Tracker" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === "resetactivity") {
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator,
      )
    ) {
      return interaction.reply({
        content: "❌ Only admins can reset activity.",
        ephemeral: true,
      });
    }
    const user = interaction.options.getUser("user");
    await db.recordActivity(interaction.guild.id, user.id);
    await interaction.reply({
      content: `✅ Activity reset for <@${user.id}>.`,
      ephemeral: true,
    });
  }

  if (commandName === "grantleave") {
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator,
      )
    ) {
      return interaction.reply({
        content: "❌ Only admins can grant leave.",
        ephemeral: true,
      });
    }
    const user = interaction.options.getUser("user");
    const days = interaction.options.getInteger("days");
    await db.setLeave(interaction.guild.id, user.id, days);
    await interaction.reply({
      content: `✅ Granted **${days}** day(s) of leave to <@${user.id}>.`,
      ephemeral: true,
    });
  }
});

// ─── Inactivity Checker (runs every hour) ────────────────────────────────────
function startInactivityChecker() {
  cron.schedule("0 * * * *", async () => {
    console.log("⏰ Running inactivity check...");
    await checkInactivity();
  });
}

async function checkInactivity() {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      const allData = await db.getAllMembers(guild.id);

      for (const memberData of allData) {
        const member = guild.members.cache.get(memberData.userId);
        if (!member || member.user.bot) continue;

        const effectiveInactiveDays = await db.getEffectiveInactiveDays(
          guild.id,
          memberData.userId,
        );

        console.log(
          `🔍 ${member.user.tag} — Effective inactive days: ${effectiveInactiveDays}`,
        );

        // ── 3+ days: Send warning in #announcements ──
        if (
          effectiveInactiveDays >= config.WARN_AFTER_DAYS &&
          !memberData.warningSent
        ) {
          await sendWarning(guild, member);
          await db.setWarningSent(guild.id, member.id, true);
        }

        // ── 4+ days: Remove roles ──
        if (effectiveInactiveDays >= config.REMOVE_ROLES_AFTER_DAYS) {
          await removeRoles(guild, member);
          await db.resetWarning(guild.id, member.id);
        }
      }
    } catch (err) {
      console.error(`Error checking guild ${guild.name}:`, err);
    }
  }
}

async function sendWarning(guild, member) {
  const channel = guild.channels.cache.find(
    (c) => c.name === "announcements" && c.isTextBased(),
  );

  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle("⚠️ Inactivity Notice")
    .setDescription(
      `Hey ${member} — please show your presence in **QuantumLogics**! We haven't seen you around lately.\n\nIf you're on planned leave, use \`/leave\` to log it and keep your roles safe. ✅`,
    )
    .setFooter({ text: "QuantumLogics Activity System" })
    .setTimestamp();

  if (channel) {
    await channel.send({ embeds: [embed] });
    console.log(`⚠️ Warning sent for ${member.user.tag} in #announcements`);
  }
}

async function removeRoles(guild, member) {
  const protectedRoleNames = config.PROTECTED_ROLES.map((r) => r.toLowerCase());

  const rolesToRemove = member.roles.cache.filter(
    (role) =>
      role.name !== "@everyone" &&
      !protectedRoleNames.includes(role.name.toLowerCase()),
  );

  if (rolesToRemove.size === 0) return;

  const removedRoleNames = rolesToRemove.map((r) => r.name).join(", ");

  try {
    await member.roles.remove(
      rolesToRemove,
      "Inactivity — roles removed by QuantumLogics bot",
    );
    console.log(
      `🔴 Removed roles from ${member.user.tag}: ${removedRoleNames}`,
    );

    // DM the user
    const dmEmbed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🔴 Your Roles Have Been Removed — QuantumLogics")
      .setDescription(
        `Hi **${member.user.username}**,\n\nDue to extended inactivity in the **QuantumLogics** Discord server, your roles have been removed.\n\n**Roles removed:** ${removedRoleNames}\n\n**Protected roles kept:** ${config.PROTECTED_ROLES.join(", ")}\n\nIf you'd like your roles reinstated, please reach out to an admin or return to the server and get active again!\n\nFor future absences, use \`/leave <days>\` to log planned leave — your roles will be protected. 🛡️`,
      )
      .setFooter({ text: "QuantumLogics Activity System" })
      .setTimestamp();

    await member.send({ embeds: [dmEmbed] }).catch(() => {
      console.log(`📵 Could not DM ${member.user.tag} (DMs may be closed).`);
    });
  } catch (err) {
    console.error(
      `Failed to remove roles from ${member.user.tag}:`,
      err.message,
    );
  }
}

client.login(config.TOKEN);
