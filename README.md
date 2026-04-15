# QuantumLogics Inactivity Bot

A Discord bot that automatically tracks member activity, handles approved leave, and removes roles from consistently inactive members.

---

## 🚀 Setup Guide

### Step 1 — Create the Bot on Discord

1. Go to https://discord.com/developers/applications and click **New Application**
2. Name it `QuantumLogics Bot` and click **Create**
3. Go to **Bot** in the left sidebar → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
   - ✅ **Presence Intent**
5. Click **Save Changes**
6. Click **Reset Token** → copy the token (you'll need it next)

---

### Step 2 — Configure the Bot

Open `config.js` and fill in:

```js
TOKEN: 'PASTE_YOUR_BOT_TOKEN_HERE',
```

Open `deploy-commands.js` and fill in:

```js
const CLIENT_ID = "YOUR_APPLICATION_CLIENT_ID"; // Developer Portal → General Information → Application ID
const GUILD_ID = "YOUR_GUILD_ID"; // Right-click your server in Discord → Copy Server ID
```

---

### Step 3 — Invite the Bot to QuantumLogics

Go to **OAuth2 → URL Generator** in the Developer Portal.

Select these scopes:

- `bot`
- `applications.commands`

Select these bot permissions:

- Manage Roles
- Send Messages
- Read Message History
- View Channels
- Embed Links

Copy the generated URL, open it in your browser, and add the bot to **QuantumLogics**.

> ⚠️ Make sure the bot's role is **above** all roles it needs to manage in Server Settings → Roles.

---

### Step 4 — Set Up MongoDB

This bot uses MongoDB for data storage. Choose one:

**Option A: Local MongoDB**

1. Download and install MongoDB from https://www.mongodb.com/try/download/community
2. Start MongoDB (it will run on `localhost:27017` by default)

**Option B: MongoDB Atlas (Cloud)**

1. Go to https://www.mongodb.com/cloud/atlas and create a free account
2. Create a cluster and get your connection string
3. Update the connection string in `database.js`:
   ```js
   await mongoose.connect("YOUR_MONGODB_CONNECTION_STRING");
   ```

### Step 5 — Install & Run

```bash
npm install
node deploy-commands.js   # Register slash commands (run once)
node bot.js               # Start the bot
```

---

## ⚙️ How It Works

### Inactivity Logic

| Day     | What happens                                                |
| ------- | ----------------------------------------------------------- |
| Day 1–2 | Nothing                                                     |
| Day 3   | Warning posted in **#announcements** tagging the member     |
| Day 4   | All roles removed (except protected ones) + DM sent to user |

### Leave System (Smart Timer)

Members can use `/leave <days>` to log planned absences.

**Example:** You joined April 1st. You take 7 days leave starting April 1st. On April 10th, only **3 real days** count as inactive (April 8, 9, 10 — after leave ended). The bot correctly ignores the 7 leave days.

### Protected Roles (never removed)

- `AI/ML`
- `Web`
- `Compiler`

To change these, edit `PROTECTED_ROLES` in `config.js`.

---

## 💬 Slash Commands

| Command                    | Who    | Description                                       |
| -------------------------- | ------ | ------------------------------------------------- |
| `/leave <days>`            | Anyone | Log approved leave to pause your inactivity timer |
| `/status`                  | Anyone | Check your own activity status and leave balance  |
| `/status @user`            | Anyone | Check another member's status                     |
| `/resetactivity @user`     | Admin  | Manually reset a member's last activity to now    |
| `/grantleave @user <days>` | Admin  | Grant approved leave days to a member             |

---

## 📁 File Structure

```
quantumlogics-bot/
├── bot.js              # Main bot logic
├── database.js         # MongoDB/Mongoose database layer
├── config.js           # Your settings (token, thresholds, protected roles)
├── deploy-commands.js  # Run once to register slash commands
└── package.json
```

**Data Storage:** MongoDB collections (`Activity`, `ActivityLog`, `LeaveLog`)

---

## 🔄 Keeping It Running (Optional)

Use `pm2` to keep the bot alive 24/7:

```bash
npm install -g pm2
pm2 start bot.js --name quantumlogics-bot
pm2 save
pm2 startup
```

---

## 🐛 Troubleshooting

**Bot won't start (MongoDB connection error)**

- Ensure MongoDB is running: `mongod`
- Check your connection string in `database.js`
- For MongoDB Atlas, verify your IP is whitelisted and credentials are correct

**Commands not working**

- Run `node deploy-commands.js` to ensure slash commands are registered
- Check that the bot has permission to manage roles and send messages
