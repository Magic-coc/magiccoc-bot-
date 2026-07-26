const express = require('express');
const crypto = require('crypto');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const SCHEDULE_CHANNEL_ID = process.env.SCHEDULE_CHANNEL_ID;

const SLOT_ROLES = {
  '4pm': process.env.SLOT_ROLE_4PM,
  '6pm': process.env.SLOT_ROLE_6PM,
  'mc-free': process.env.MC_FREE_TOURNAMENT_ROLE,
  'coc-war': process.env.COC_WAR_A_ROLE,
  'coc-tournament': process.env.COC_TOURNAMENT_ROLE,
};

const SLOT_CHANNELS = {
  '4pm': process.env.SLOT_CHANNEL_4PM,
  '6pm': process.env.SLOT_CHANNEL_6PM,
  'mc-free': process.env.MC_FREE_TOURNAMENT_CHANNEL,
  'coc-war': process.env.COC_WAR_A_CHANNEL,
  'coc-tournament': process.env.COC_TOURNAMENT_CHANNEL,
};

const SLOT_LABELS = {
  '4pm': 'Magic Chess 4PM Match',
  '6pm': 'Magic Chess 6PM Match',
  'mc-free': 'Magic Chess Free Tournament',
  'coc-war': 'CoC Weekly War',
  'coc-tournament': 'CoC Tournament',
};

const slotCounts = {
  '4pm': 8,
  '6pm': 8,
  'mc-free': 16,
  'coc-war': 20,
  'coc-tournament': 20,
};

const slotCounterMessageIds = {
  '4pm': null,
  '6pm': null,
  'mc-free': null,
  'coc-war': null,
  'coc-tournament': null,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', () => {
  console.log(`MagicCOC Bot is online as ${client.user.tag}`);
});

client.login(BOT_TOKEN);

// ─── New member welcome DM ───────────────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
  try {
    const guild = member.guild;

    const magicChessRole = guild.roles.cache.find(
      r => r.name === 'Magic Chess Player'
    );
    const cocRole = guild.roles.cache.find(
      r => r.name === 'CoC Player'
    );

    if (!magicChessRole || !cocRole) {
      console.error('Magic Chess Player or CoC Player role not found');
      return;
    }

    const dm = await member.createDM();

    await dm.send(
      `👋 Welcome to **Magic COC**, ${member.user.username}!\n\n` +
      `We organize tournaments for **Magic Chess Go Go** and **Clash of Clans** ` +
      `with real money prizes. 🏆\n\n` +
      `Which game do you play? Reply with one of these options:\n\n` +
      `**Magic Chess** — for Magic Chess Go Go\n` +
      `**CoC** — for Clash of Clans\n` +
      `**Both** — if you play both games\n`
    );

    const filter = m => m.author.id === member.user.id;

    const collector = dm.createMessageCollector({
      filter,
      max: 3,
      time: 86400000,
    });

    let assigned = false;

    collector.on('collect', async (response) => {
      const answer = response.content.trim().toLowerCase();

      if (answer === 'magic chess') {
        await member.roles.add(magicChessRole);
        await dm.send(
          `✅ Got it! You are registered as a **Magic Chess Go Go** player.\n\n` +
          `Go to **#match-schedule** in the server and use **/join** to register ` +
          `for upcoming matches. See you in the lobby! 🎮`
        );
        assigned = true;
        collector.stop();

      } else if (answer === 'coc') {
        await member.roles.add(cocRole);
        await dm.send(
          `✅ Got it! You are registered as a **Clash of Clans** player.\n\n` +
          `Go to **#match-schedule** in the server and use **/join** to register ` +
          `for upcoming wars. See you on the battlefield! ⚔️`
        );
        assigned = true;
        collector.stop();

      } else if (answer === 'both') {
        await member.roles.add(magicChessRole);
        await member.roles.add(cocRole);
        await dm.send(
          `✅ Got it! You are registered as both a **Magic Chess Go Go** and ` +
          `**Clash of Clans** player.\n\n` +
          `Go to **#match-schedule** in the server and use **/join** to register ` +
          `for upcoming matches and wars. See you there! 🏆`
        );
        assigned = true;
        collector.stop();

      } else {
        await dm.send(
          `❌ Please reply with exactly one of these:\n\n` +
          `**Magic Chess** — for Magic Chess Go Go\n` +
          `**CoC** — for Clash of Clans\n` +
          `**Both** — if you play both games`
        );
      }
    });

    collector.on('end', async () => {
      if (!assigned) {
        await dm.send(
          `You did not reply in time. No worries — just DM an admin in the ` +
          `server and they will assign your game role for you. 🎮`
        ).catch(() => {});
      }
    });

  } catch (err) {
    console.error('Error in guildMemberAdd:', err.message);
  }
});

// ─── Signature verification ──────────────────────────────────────────────────

function verifySignature(body, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return expectedSignature === signature;
}

// ─── Slot counter ────────────────────────────────────────────────────────────

async function updateOrCreateSlotCounter(slot) {
  try {
    const scheduleChannel = await client.channels.fetch(SCHEDULE_CHANNEL_ID);
    const slotsLeft = slotCounts[slot];
    const label = SLOT_LABELS[slot];

    const message = slotsLeft > 0
      ? `🎮 **${label}**\n` +
        `✅ Slots remaining: **${slotsLeft}**\n` +
        `Type \`/join\` in this channel to register.`
      : `🎮 **${label}**\n` +
        `❌ **FULL** — No slots remaining.\n` +
        `Watch #announcements for the next match.`;

    if (slotCounterMessageIds[slot]) {
      try {
        const existing = await scheduleChannel.messages.fetch(
          slotCounterMessageIds[slot]
        );
        await existing.edit(message);
      } catch {
        const newMsg = await scheduleChannel.send(message);
        slotCounterMessageIds[slot] = newMsg.id;
      }
    } else {
      const newMsg = await scheduleChannel.send(message);
      slotCounterMessageIds[slot] = newMsg.id;
    }
  } catch (err) {
    console.error('Error updating slot counter:', err.message);
  }
}

// ─── Log to bot-logs ─────────────────────────────────────────────────────────

async function logToChannel(message) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    await logChannel.send(message);
  } catch (err) {
    console.error('Error sending to log channel:', err.message);
  }
}

// ─── Razorpay webhook ────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  if (!verifySignature(req.body, signature, RAZORPAY_WEBHOOK_SECRET)) {
    console.log('Invalid signature - ignoring');
    return res.status(400).send('Invalid signature');
  }

  const event = req.body.event;
  if (event !== 'payment_link.paid') return res.send('ok');

  const payment = req.body.payload?.payment_link?.entity;
  const notes = payment?.notes;

  const discordUsername = notes?.discord_username?.toLowerCase().trim();
  const matchSlot = notes?.match_slot?.toLowerCase().trim();
  const inGameName = notes?.in_game_name?.trim();
  const inGameId = notes?.in_game_id?.trim();
  const inGameDetails = notes?.in_game_details?.trim();
  const amount = payment?.amount / 100;

  if (!discordUsername || !matchSlot) {
    await logToChannel(
      `⚠️ Payment received but missing details.\n` +
      `Amount: ₹${amount} | Slot: ${matchSlot || 'unknown'} | ` +
      `Discord: ${discordUsername || 'unknown'}`
    );
    return res.send('ok');
  }

  const roleId = SLOT_ROLES[matchSlot];
  const label = SLOT_LABELS[matchSlot];

  if (!roleId) {
    await logToChannel(
      `⚠️ Unknown match slot: **${matchSlot}** | ` +
      `Amount: ₹${amount} | Discord: ${discordUsername}`
    );
    return res.send('ok');
  }

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();

    const member = guild.members.cache.find(
      m => m.user.username.toLowerCase() === discordUsername
    );

    if (!member) {
      await logToChannel(
        `⚠️ Payment received but Discord user not found.\n` +
        `Discord username typed: **${discordUsername}**\n` +
        `Slot: **${label}** | Amount: ₹${amount}\n` +
        `In-Game Name: ${inGameName || 'not provided'}\n` +
        `In-Game ID: ${inGameId || 'not provided'}\n` +
        `Group Details: ${inGameDetails || 'solo player'}\n` +
        `⚡ Please assign the role manually.`
      );
      return res.send('ok');
    }

    await member.roles.add(roleId);

    if (slotCounts[matchSlot] > 0) {
      slotCounts[matchSlot]--;
    }

    await updateOrCreateSlotCounter(matchSlot);

    await member.send(
      `✅ Payment confirmed! You are registered for **${label}**.\n` +
      `Amount paid: ₹${amount}\n\n` +
      `Your private lobby channel is now visible in the server.\n` +
      `Please be online and ready 5 minutes before match time. 🎮`
    );

    await logToChannel(
      `✅ Registration confirmed\n` +
      `Discord: **${member.user.username}**\n` +
      `Slot: **${label}** | Amount: ₹${amount}\n` +
      `In-Game Name: **${inGameName || 'not provided'}**\n` +
      `In-Game ID: **${inGameId || 'not provided'}**\n` +
      `Group Details: **${inGameDetails || 'solo player'}**\n` +
      `Slots remaining: **${slotCounts[matchSlot]}**`
    );

    res.send('ok');

  } catch (err) {
    console.error('Error processing payment:', err.message);
    await logToChannel(
      `❌ Error processing payment for **${discordUsername}** — ${err.message}`
    );
    res.send('ok');
  }
});

// ─── Slash commands ──────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'join') {
    const slot = interaction.options.getString('slot');
    const label = SLOT_LABELS[slot];

    const links = {
      '4pm': process.env.PAYMENT_LINK_4PM,
      '6pm': process.env.PAYMENT_LINK_6PM,
      'mc-free': process.env.PAYMENT_LINK_MC_FREE,
      'coc-war': process.env.PAYMENT_LINK_COC_WAR,
      'coc-tournament': process.env.PAYMENT_LINK_COC_TOURNAMENT,
    };

    if (!links[slot] || links[slot] === 'placeholder') {
      return interaction.reply({
        content:
          `⏳ **${label}** registration is not open yet.\n` +
          `Watch #announcements for updates. 🎮`,
        ephemeral: true,
      });
    }

    if (slotCounts[slot] <= 0) {
      return interaction.reply({
        content:
          `❌ **${label}** is full. No slots remaining.\n` +
          `Watch #announcements for the next match. 🎮`,
        ephemeral: true,
      });
    }

    await interaction.reply({
      content:
        `🎮 **${label}**\n` +
        `Slots remaining: **${slotCounts[slot]}**\n\n` +
        `Pay your entry fee here:\n` +
        `${links[slot]}\n\n` +
        `⚠️ **Fill these correctly when paying:**\n` +
        `• Discord Username — your exact Discord username\n` +
        `• In-Game Name — your name as it appears in the game\n` +
        `• In-Game ID — your unique player ID\n` +
        `• In-Game Details — if registering as a group, write your ` +
        `teammates IGN and ID here. Solo players leave this blank.\n\n` +
        `Your lobby channel unlocks automatically within 30 seconds of payment. 🏆`,
      ephemeral: true,
    });
  }
});

// ─── Admin commands ──────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const member = message.member;
  const isAdmin = member && member.roles.cache.some(
    r => r.name === 'Admin'
  );

  if (!isAdmin) return;

  if (message.content === '!resetslots') {
    slotCounts['4pm'] = 8;
    slotCounts['6pm'] = 8;
    slotCounts['mc-free'] = 16;
    slotCounts['coc-war'] = 20;
    slotCounts['coc-tournament'] = 20;

    Object.keys(slotCounterMessageIds).forEach(key => {
      slotCounterMessageIds[key] = null;
    });

    await message.reply('✅ All slot counts reset successfully.');
  }

  if (message.content.startsWith('!resetslot ')) {
    const slot = message.content.split(' ')[1];
    const defaultCounts = {
      '4pm': 8,
      '6pm': 8,
      'mc-free': 16,
      'coc-war': 20,
      'coc-tournament': 20,
    };

    if (!defaultCounts[slot]) {
      return message.reply(
        '❌ Unknown slot. Use: `4pm` `6pm` `mc-free` `coc-war` `coc-tournament`'
      );
    }

    slotCounts[slot] = defaultCounts[slot];
    slotCounterMessageIds[slot] = null;
    await message.reply(
      `✅ Slot **${slot}** reset to **${defaultCounts[slot]}** successfully.`
    );
  }
});

// ─── Server ──────────────────────────────────────────────────────────────────

app.listen(3000, () => console.log('Webhook server running on port 3000'));
