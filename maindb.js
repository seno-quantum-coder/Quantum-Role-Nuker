require("dotenv").config();
const mongoose = require("mongoose");

// ─── Separate connection to the main quantum_logics database ─────────────────
let Employee = null;

async function initMainDb() {
  try {
    const conn = await mongoose.createConnection(process.env.MONGO_URI, {
      maxPoolSize: 3,
      serverSelectionTimeoutMS: 5000,
    });

    const employeeSchema = new mongoose.Schema(
      {
        userId: mongoose.Schema.Types.ObjectId,
        applicationId: mongoose.Schema.Types.ObjectId,
        name: String,
        email: String,
        phone: String,
        jobTitle: String,
        githubUrl: String,
        discordUrl: String, // "@username" or "username" or "username#1234"
        roles: [String],
        isVerified: Boolean,
        joinedAt: Date, // <- intern start date, used as internSince
        discordActivityStatus: {
          type: String,
          enum: ["active", "inactive"],
          default: null,
        },
      },
      { timestamps: true, collection: "employees" },
    );

    Employee = conn.model("Employee", employeeSchema);
    console.log("📦 Main DB (quantum_logics) connected.");
  } catch (err) {
    console.error("❌ Main DB connection failed:", err.message);
  }
}

// ─── Normalize discordUrl → plain lowercase username ─────────────────────────
// "@ade_ena"      -> "ade_ena"
// "@daryaighora"  -> "daryaighora"
// "username#1234" -> "username"
// "username"      -> "username"
function normalizeDiscordUsername(discordUrl) {
  if (!discordUrl) return null;
  return discordUrl
    .replace(/^@/, "") // strip leading @
    .split("#")[0] // strip old #discriminator
    .toLowerCase()
    .trim();
}

// ─── Match employees against one or more candidate names ─────────────────────
// Accepts both member.user.username (unique handle) and member.user.globalName
// (display name) so either can match whatever is stored in discordUrl.
function matchEmployee(employees, candidateNames) {
  const normalized = candidateNames
    .filter(Boolean)
    .map((n) => n.toLowerCase().trim());

  return (
    employees.find((e) => {
      const empName = normalizeDiscordUsername(e.discordUrl);
      return empName && normalized.includes(empName);
    }) || null
  );
}

// ─── Find any employee by one or more Discord name candidates ─────────────────
async function findEmployeeByDiscordUsername(...discordNames) {
  if (!Employee) return null;
  try {
    const all = await Employee.find({});
    return matchEmployee(all, discordNames);
  } catch (err) {
    console.error("Error finding employee:", err.message);
    return null;
  }
}

// ─── Find intern employee by one or more Discord name candidates ──────────────
async function findInternByDiscordUsername(...discordNames) {
  if (!Employee) return null;
  try {
    const interns = await Employee.find({ jobTitle: "Intern" });
    return matchEmployee(interns, discordNames);
  } catch (err) {
    console.error("Error finding intern:", err.message);
    return null;
  }
}

// ─── Get joinedAt date for an intern (used as internSince in bot.js) ─────────
async function getInternJoinedAt(...discordNames) {
  const emp = await findInternByDiscordUsername(...discordNames);
  if (!emp || !emp.joinedAt) return null;
  return emp.joinedAt;
}

// ─── Set discordActivityStatus by employee _id ───────────────────────────────
async function setActivityStatus(employeeId, status) {
  if (!Employee) return;
  try {
    await Employee.findByIdAndUpdate(employeeId, {
      discordActivityStatus: status,
      updatedAt: new Date(),
    });
    console.log(
      `🗄️  Employee ${employeeId} -> discordActivityStatus: ${status}`,
    );
  } catch (err) {
    console.error("Error setting activity status:", err.message);
  }
}

// ─── Mark a Discord member active ────────────────────────────────────────────
// Always pass both username + globalName for best match chance.
async function markActive(...discordNames) {
  const emp = await findEmployeeByDiscordUsername(...discordNames);
  if (!emp) {
    console.log(
      `⚠️  markActive: no match for [${discordNames.filter(Boolean).join(", ")}]`,
    );
    return;
  }
  await setActivityStatus(emp._id, "active");
}

// ─── Mark a Discord member inactive ──────────────────────────────────────────
async function markInactive(...discordNames) {
  const emp = await findEmployeeByDiscordUsername(...discordNames);
  if (!emp) {
    console.log(
      `⚠️  markInactive: no match for [${discordNames.filter(Boolean).join(", ")}]`,
    );
    return;
  }
  await setActivityStatus(emp._id, "inactive");
}

// ─── Backfill all intern employees on startup / periodic re-sync ─────────────
// Pass an array of { username, globalName } objects for every Discord member
// who currently has the Intern role.
async function backfillActivityStatuses(activeDiscordMembers) {
  if (!Employee) return;
  try {
    const interns = await Employee.find({ jobTitle: "Intern" });

    // Build a flat set of all normalized names from active Discord Intern members
    const activeSet = new Set();
    for (const m of activeDiscordMembers) {
      if (m.username) activeSet.add(m.username.toLowerCase().trim());
      if (m.globalName) activeSet.add(m.globalName.toLowerCase().trim());
    }

    let updated = 0;
    for (const emp of interns) {
      const empName = normalizeDiscordUsername(emp.discordUrl);
      if (!empName) continue;

      const correctStatus = activeSet.has(empName) ? "active" : "inactive";
      if (emp.discordActivityStatus !== correctStatus) {
        await setActivityStatus(emp._id, correctStatus);
        updated++;
      }
    }

    console.log(
      `✅ Backfill complete — ${interns.length} intern(s) checked, ${updated} status(es) corrected.`,
    );
  } catch (err) {
    console.error("Main DB backfill error:", err.message);
  }
}

module.exports = {
  initMainDb,
  markActive,
  markInactive,
  backfillActivityStatuses,
  getInternJoinedAt,
};
