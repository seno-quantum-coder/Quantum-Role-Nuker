require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");
const cron = require("node-cron");
const db = require("./database");
const mainDb = require("./maindb");
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isInternMember(member) {
  return member.roles.cache.some((r) => r.name.toLowerCase() === "intern");
}

function getTeamRole(member) {
  const found = member.roles.cache.find((r) =>
    config.PROTECTED_ROLES.map((p) => p.toLowerCase()).includes(
      r.name.toLowerCase(),
    ),
  );
  return found ? found.name : null;
}

function humanDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0 && hours > 0) return `${days}d ${hours}h`;
  if (days > 0) return `${days} day(s)`;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours} hour(s)`;
  return `${minutes} minute(s)`;
}

// ─── On Ready ────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ QuantumLogics Bot is online as ${client.user.tag}`);
  await db.initialize();
  await mainDb.initMainDb();
  await backfillMainDbStatuses();
  startInactivityChecker();
});

// ─── Backfill discordActivityStatus in quantum_logics DB on startup ───────────
async function backfillMainDbStatuses() {
  for (const guild of client.guilds.cache.values()) {
    try {
      const members = await guild.members.fetch();
      const activeMembers = [];
      for (const member of members.values()) {
        if (member.user.bot) continue;
        if (isInternMember(member)) {
          // Pass both username and globalName — maindb will try both against discordUrl
          activeMembers.push({
            username: member.user.username,
            globalName: member.user.globalName || null,
          });
        }
      }
      await mainDb.backfillActivityStatuses(activeMembers);
    } catch (err) {
      console.error(`Main DB backfill error in guild ${guild.name}:`, err);
    }
  }
}

// ─── Auto-detect when Intern role is assigned or removed ─────────────────────
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (newMember.user.bot) return;

  const hadIntern = isInternMember(oldMember);
  const hasIntern = isInternMember(newMember);

  const username = newMember.user.username;
  const globalName = newMember.user.globalName || null;

  // Intern role just ADDED
  if (!hadIntern && hasIntern) {
    await mainDb.markActive(username, globalName);
    console.log(
      `🎓 Intern role assigned to ${newMember.user.tag} — marked active.`,
    );
  }

  // Intern role just REMOVED
  if (hadIntern && !hasIntern) {
    await mainDb.markInactive(username, globalName);
    console.log(
      `🔴 Intern role removed from ${newMember.user.tag} — marked inactive.`,
    );
  }
});

// ─── Track Message Activity ───────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  await db.recordActivity(message.guild.id, message.author.id);
  const member = message.guild.members.cache.get(message.author.id);
  if (member && isInternMember(member)) {
    await mainDb.markActive(
      message.author.username,
      message.author.globalName || null,
    );
  }
});

// ─── Track Voice Activity ─────────────────────────────────────────────────────
client.on("voiceStateUpdate", async (oldState, newState) => {
  if (!oldState.channelId && newState.channelId) {
    if (newState.member && !newState.member.user.bot) {
      await db.recordActivity(newState.guild.id, newState.member.id);
      if (isInternMember(newState.member)) {
        await mainDb.markActive(
          newState.member.user.username,
          newState.member.user.globalName || null,
        );
      }
    }
  }
});

// ─── Track Members Joining ───────────────────────────────────────────────────
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

  // ── /leave ──────────────────────────────────────────────────────────────────
  if (commandName === "leave") {
    const days = interaction.options.getInteger("days");
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    await db.setLeave(guildId, userId, days);

    await interaction.reply({
      content: `✅ Leave recorded! You have **${days} day(s)** of approved leave. These won't count toward your inactivity timer.`,
    });
    console.log(`🏖️ ${interaction.user.tag} took ${days} day(s) of leave.`);
  }

  // ── /status ─────────────────────────────────────────────────────────────────
  if (commandName === "status") {
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const userId = targetUser.id;
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

    const data = await db.getMemberData(guildId, userId);
    const member =
      interaction.guild.members.cache.get(userId) ||
      (await interaction.guild.members.fetch(userId).catch(() => null));

    if (!data || !member) {
      return interaction.editReply({
        content: "❓ No activity data found for this user.",
      });
    }

    const activeDays = await db.getConsecutiveActiveDays(guildId, userId);
    const lastSeen = data.lastActivity
      ? `<t:${Math.floor(data.lastActivity / 1000)}:R>`
      : "Never";
    const serverJoined = member.joinedTimestamp
      ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
      : "Unknown";
    const accountCreated = `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:D>`;

    const isIntern = isInternMember(member);
    const teamRole = getTeamRole(member);
    const teamValue = teamRole ? `**${teamRole}**` : "Not assigned";

    if (!isIntern) {
      // ── Non-intern view ──────────────────────────────────────────────────
      const roleList =
        member.roles.cache
          .filter((r) => r.name !== "@everyone")
          .map((r) => `<@&${r.id}>`)
          .join(", ") || "None";

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📊 Member Status")
        .setDescription(`<@${userId}>`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: "🕐 Last Active", value: lastSeen, inline: true },
          {
            name: "📅 Active Days (streak)",
            value: `${activeDays} day(s)`,
            inline: true,
          },
          { name: "📆 Joined Server", value: serverJoined, inline: true },
          { name: "🗓️ Account Created", value: accountCreated, inline: true },
          { name: "🛠️ Team", value: teamValue, inline: true },
          { name: "🎭 Roles", value: roleList, inline: false },
        )
        .setFooter({ text: "QuantumLogics Activity Tracker" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── Intern view ──────────────────────────────────────────────────────────
    const leaveLeft = data.leaveBalance || 0;
    const activeLeave = await db.getActiveLeave(guildId, userId);
    const effectiveInactiveDays = await db.getEffectiveInactiveDays(
      guildId,
      userId,
    );

    // Fetch intern start date from quantum_logics employees.joinedAt
    const joinedAt = await mainDb.getInternJoinedAt(
      targetUser.username,
      targetUser.globalName || null,
    );
    let internSinceStr = "Not found in employee records";
    let internDurationStr = "—";
    if (joinedAt) {
      internSinceStr = `<t:${Math.floor(joinedAt.getTime() / 1000)}:D>`;
      internDurationStr = humanDuration(Date.now() - joinedAt.getTime());
    }

    // Leave status
    let leaveStatus;
    if (activeLeave) {
      leaveStatus = `✅ On approved leave until **${activeLeave.endDate}**`;
    } else if (leaveLeft > 0) {
      leaveStatus = `🏖️ ${leaveLeft} day(s) balance (not currently active)`;
    } else {
      leaveStatus = "❌ Not on leave";
    }

    // Inactivity timer
    const daysLeft = config.REMOVE_ROLES_AFTER_DAYS - effectiveInactiveDays;
    let inactivityStatus;
    if (activeLeave) {
      inactivityStatus = "⏸️ Paused (on leave)";
    } else if (effectiveInactiveDays >= config.REMOVE_ROLES_AFTER_DAYS) {
      inactivityStatus = `🔴 ${effectiveInactiveDays} day(s) inactive — roles at risk!`;
    } else if (effectiveInactiveDays >= config.WARN_AFTER_DAYS) {
      inactivityStatus = `⚠️ ${effectiveInactiveDays} day(s) inactive — warning issued (${daysLeft} day(s) until removal)`;
    } else {
      inactivityStatus = `✅ ${effectiveInactiveDays} day(s) inactive — all good (${daysLeft} day(s) remaining)`;
    }

    const embedColor = activeLeave
      ? 0x00b0f4
      : effectiveInactiveDays >= config.REMOVE_ROLES_AFTER_DAYS
        ? 0xff0000
        : effectiveInactiveDays >= config.WARN_AFTER_DAYS
          ? 0xffa500
          : 0x57f287;

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle("🎓 Intern Status")
      .setDescription(`<@${userId}>`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: "🕐 Last Active", value: lastSeen, inline: true },
        {
          name: "📅 Active Days (streak)",
          value: `${activeDays} day(s)`,
          inline: true,
        },
        { name: "📆 Joined Server", value: serverJoined, inline: true },
        { name: "🗓️ Account Created", value: accountCreated, inline: true },
        { name: "🛠️ Team", value: teamValue, inline: true },
        { name: "🎓 Intern Since", value: internSinceStr, inline: true },
        { name: "⏳ Time as Intern", value: internDurationStr, inline: true },
        { name: "🏖️ Leave Status", value: leaveStatus, inline: false },
        { name: "⏱️ Inactivity Timer", value: inactivityStatus, inline: false },
        {
          name: "⚠️ Warning Sent",
          value: data.warningSent ? "Yes" : "No",
          inline: true,
        },
      )
      .setFooter({ text: "QuantumLogics Activity Tracker" })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /resetactivity ───────────────────────────────────────────────────────────
  if (commandName === "resetactivity") {
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator,
      )
    ) {
      return interaction.reply({
        content: "❌ Only admins can reset activity.",
      });
    }
    const user = interaction.options.getUser("user");
    await db.recordActivity(interaction.guild.id, user.id);

    // If intern, mark active in main DB
    const targetMember =
      interaction.guild.members.cache.get(user.id) ||
      (await interaction.guild.members.fetch(user.id).catch(() => null));
    if (targetMember && isInternMember(targetMember)) {
      await mainDb.markActive(
        targetMember.user.username,
        targetMember.user.globalName || null,
      );
    }

    await interaction.reply({
      content: `✅ Activity reset for <@${user.id}>.`,
    });
  }

  // ── /grantleave ──────────────────────────────────────────────────────────────
  if (commandName === "grantleave") {
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator,
      )
    ) {
      return interaction.reply({
        content: "❌ Only admins can grant leave.",
      });
    }
    const user = interaction.options.getUser("user");
    const days = interaction.options.getInteger("days");
    await db.setLeave(interaction.guild.id, user.id, days);
    await interaction.reply({
      content: `✅ Granted **${days}** day(s) of leave to <@${user.id}>.`,
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

        const username = member.user.username;
        const globalName = member.user.globalName || null;

        const effectiveInactiveDays = await db.getEffectiveInactiveDays(
          guild.id,
          memberData.userId,
        );

        console.log(
          `🔍 ${member.user.tag} — Effective inactive days: ${effectiveInactiveDays}`,
        );

        const hasIntern = isInternMember(member);

        // ── Still has Intern role and within threshold → ensure marked active ──
        if (
          hasIntern &&
          effectiveInactiveDays < config.REMOVE_ROLES_AFTER_DAYS
        ) {
          await mainDb.markActive(username, globalName);
        }

        // ── 3+ days: Send warning ──
        if (
          effectiveInactiveDays >= config.WARN_AFTER_DAYS &&
          !memberData.warningSent
        ) {
          await sendWarning(guild, member);
          await db.setWarningSent(guild.id, member.id, true);
        }

        // ── 4+ days: Remove roles + mark inactive ──
        if (effectiveInactiveDays >= config.REMOVE_ROLES_AFTER_DAYS) {
          await removeRoles(guild, member);
          await db.resetWarning(guild.id, member.id);
          await mainDb.markInactive(username, globalName);
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
