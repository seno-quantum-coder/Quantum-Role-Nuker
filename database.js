const mongoose = require("mongoose");

let Activity, ActivityLog, LeaveLog;

async function initialize() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const activitySchema = new mongoose.Schema({
      guildId: String,
      userId: String,
      lastActivity: { type: Number, default: 0 },
      warningSent: { type: Boolean, default: false },
      leaveBalance: { type: Number, default: 0 },
      leaveStart: Number,
    });
    activitySchema.index({ guildId: 1, userId: 1 }, { unique: true });
    Activity = mongoose.model("Activity", activitySchema);

    const activityLogSchema = new mongoose.Schema({
      guildId: String,
      userId: String,
      activityDate: String,
    });
    activityLogSchema.index(
      { guildId: 1, userId: 1, activityDate: 1 },
      { unique: true },
    );
    ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

    const leaveLogSchema = new mongoose.Schema({
      guildId: String,
      userId: String,
      startDate: String,
      endDate: String,
    });
    LeaveLog = mongoose.model("LeaveLog", leaveLogSchema);

    console.log("📦 Database initialized.");
  } catch (error) {
    console.error("Database initialization failed:", error);
  }
}

// ─── Record a member's activity ───────────────────────────────────────────────
async function recordActivity(guildId, userId) {
  const now = Date.now();
  const today = getTodayString();

  try {
    await Activity.findOneAndUpdate(
      { guildId, userId },
      { lastActivity: now, warningSent: false },
      { upsert: true, new: true },
    );

    await ActivityLog.findOneAndUpdate(
      { guildId, userId, activityDate: today },
      {},
      { upsert: true },
    );
  } catch (error) {
    console.error("Error recording activity:", error);
  }
}

// ─── Get all members for a guild ─────────────────────────────────────────────
async function getAllMembers(guildId) {
  try {
    return await Activity.find({ guildId });
  } catch (error) {
    console.error("Error getting all members:", error);
    return [];
  }
}

// ─── Get single member data ───────────────────────────────────────────────────
async function getMemberData(guildId, userId) {
  try {
    return await Activity.findOne({ guildId, userId });
  } catch (error) {
    console.error("Error getting member data:", error);
    return null;
  }
}

// ─── Set leave for a member ───────────────────────────────────────────────────
async function setLeave(guildId, userId, days) {
  const today = getTodayString();
  const endDate = getDateStringOffset(days);

  try {
    await Activity.findOneAndUpdate(
      { guildId, userId },
      { lastActivity: Date.now() },
      { upsert: true },
    );

    await LeaveLog.create({ guildId, userId, startDate: today, endDate });

    await Activity.findOneAndUpdate(
      { guildId, userId },
      { $inc: { leaveBalance: days }, leaveStart: Date.now() },
    );
  } catch (error) {
    console.error("Error setting leave:", error);
  }
}

// ─── Mark warning as sent ─────────────────────────────────────────────────────
async function setWarningSent(guildId, userId, value) {
  try {
    await Activity.findOneAndUpdate(
      { guildId, userId },
      { lastActivity: Date.now(), warningSent: value },
      { upsert: true },
    );
  } catch (error) {
    console.error("Error setting warning sent:", error);
  }
}

// ─── Reset warning flag after action taken ───────────────────────────────────
async function resetWarning(guildId, userId) {
  try {
    await Activity.findOneAndUpdate(
      { guildId, userId },
      { warningSent: false },
    );
  } catch (error) {
    console.error("Error resetting warning:", error);
  }
}

// ─── Get effective inactive days (accounting for approved leave) ──────────────
// Logic:
//   - Find how many calendar days have passed since last activity
//   - Subtract any approved leave days that overlap that window
//   - The remaining is "real" inactive days
async function getEffectiveInactiveDays(guildId, userId) {
  try {
    const member = await getMemberData(guildId, userId);
    if (!member || !member.lastActivity) return 0;

    const lastActivity = new Date(member.lastActivity);
    const now = new Date();

    // Total elapsed days since last activity
    const totalDays = Math.floor((now - lastActivity) / (1000 * 60 * 60 * 24));
    if (totalDays <= 0) return 0;

    // Get approved leave days that fall within the inactivity window
    const lastActivityStr = toDateString(lastActivity);
    const todayStr = getTodayString();

    const leaveDays = await LeaveLog.find({
      guildId,
      userId,
      endDate: { $gte: lastActivityStr },
      startDate: { $lte: todayStr },
    });

    let coveredDays = 0;
    for (const leave of leaveDays) {
      const leaveStart = new Date(
        Math.max(new Date(leave.startDate), lastActivity),
      );
      const leaveEnd = new Date(Math.min(new Date(leave.endDate), now));
      if (leaveEnd > leaveStart) {
        coveredDays += Math.floor(
          (leaveEnd - leaveStart) / (1000 * 60 * 60 * 24),
        );
      }
    }

    return Math.max(0, totalDays - coveredDays);
  } catch (error) {
    console.error("Error getting effective inactive days:", error);
    return 0;
  }
}

// ─── Get consecutive active days ─────────────────────────────────────────────
// Counts backwards from today how many consecutive days they were active
async function getConsecutiveActiveDays(guildId, userId) {
  try {
    const rows = await ActivityLog.find({ guildId, userId }).sort({
      activityDate: -1,
    });

    if (!rows.length) return 0;

    let streak = 0;
    let check = new Date();

    for (const row of rows) {
      const rowDate = toDateString(new Date(row.activityDate));
      const checkDate = toDateString(check);

      if (rowDate === checkDate) {
        streak++;
        check.setDate(check.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  } catch (error) {
    console.error("Error getting consecutive active days:", error);
    return 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTodayString() {
  return toDateString(new Date());
}

function toDateString(date) {
  return date.toISOString().split("T")[0]; // "YYYY-MM-DD"
}

function getDateStringOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

module.exports = {
  initialize,
  recordActivity,
  getAllMembers,
  getMemberData,
  setLeave,
  setWarningSent,
  resetWarning,
  getEffectiveInactiveDays,
  getConsecutiveActiveDays,
};
