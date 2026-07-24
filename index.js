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
  'coc-war': 10,
  'coc-tournament': 16,
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
  ],
});

client.once('ready', () => {
  console.log(`MagicCOC Bot is online as ${client.user.tag}`);
});

client.login(BOT_TOKEN);

function verifySignature(body, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return expectedSignature === signature;
}

async function updateOrCreateSlotCounter(slot) {
  try {
    const scheduleChannel = await client.channels.fetch(SCHEDULE_CHANNEL_ID);
    const slotsLeft = slotCounts[slot];
    const label = SLOT_LABELS[slot];

    const message = slotsLeft > 0
      ? `🎮 **${label}**\n✅ Slots remaining: **${slotsLeft}**\nType \`/join ${slot}\` in this channel to register.`
      : `🎮 **${label}**\n❌ **FULL** — No slots remaining. Watch for next match announcement.`;

    if (slotCounterMessageIds[slot]) {
      try {
        const existingMessage = await scheduleChannel.messages.fetch(
          slotCounterMessageIds[slot]
        );
        await existingMessage.edit(message);
      } catch {
        const newMessage = await scheduleChannel.send(message);
        slotCounterMessageIds[slot] = newMessage.id;
      }
    } else {
      const newMessage = await scheduleChannel.send(message);
      slotCounterMessageIds[slot] = newMessage.id;
    }
  } catch (err) {
    console.error('Error updating slot counter:', err.message);
  }
}

async function logToChannel(message) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    await logChannel.send(message);
  } catch (err) {
    console.error('Error sending to log channel:', err.message);
  }
}

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
  const amount = payment?.amount / 100;

  if (!discordUsername || !matchSlot) {
    await logToChannel(
      `⚠️ Payment received but missing details.\n` +
      `Amount: ₹${amount} | Slot: ${matchSlot || 'unknown'} | Discord: ${discordUsername || 'unknown'}`
    );
    return res.send('ok');
  }

  const roleId = SLOT_ROLES[matchSlot];
  const label = SLOT_LABELS[matchSlot];

  if (!roleId) {
    await logToChannel(
      `⚠️ Unknown match slot received: **${matchSlot}** | Amount: ₹${amount} | Discord: ${discordUsername}`
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
        `In-Game Name: ${inGameName || 'not provided'} | In-Game ID: ${inGameId || 'not provided'}\n` +
        `Please assign the role manually.`
      );
      return res.send('ok');
    }

    await member.roles.add(roleId);

    if (slotCounts[matchSlot] > 0) {
      slotCounts[matchSlot]--;
    }

    await updateOrCreateSlotCounter(matchSlot);

    await member.send(
      `✅ Payment confirmed! You are registered for the **${label}**.\n` +
      `Amount paid: ₹${amount}\n\n` +
      `Your private lobby channel is now visible in the server.\n` +
      `Please be online and ready 5 minutes before match time.\n\n` +
      `See you in the lobby! 🎮`
    );

    await logToChannel(
      `✅ Registration confirmed\n` +
      `Discord: **${member.user.username}**\n` +
      `Slot: **${label}** | Amount: ₹${amount}\n` +
      `In-Game Name: **${inGameName || 'not provided'}**\n` +
      `In-Game ID: **${inGameId || 'not provided'}**\n` +
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

    if (!links[slot]) {
      return interaction.reply({
        content: `❌ This slot is not available right now. Check #match-schedule for available matches.`,
        ephemeral: true,
      });
    }

    if (slotCounts[slot] <= 0) {
      return interaction.reply({
        content: `❌ **${label}** is full. No slots remaining.\nWatch #announcements for the next match. 🎮`,
        ephemeral: true,
      });
    }

    await interaction.reply({
      content:
        `🎮 **${label}**\n` +
        `Slots remaining: **${slotCounts[slot]}**\n\n` +
        `Click below to pay your entry fee and secure your slot:\n` +
        `${links[slot]}\n\n` +
        `⚠️ **Important — fill these correctly when paying:**\n` +
        `• Discord Username — your exact Discord username (right click your name to check)\n` +
        `• In-Game Name — your name as it appears in the game\n` +
        `• In-Game ID — your unique player ID from the game\n` +
        `• Match Slot — already filled, do not change it\n\n` +
        `Your lobby channel unlocks automatically within 30 seconds of payment. 🏆`,
      ephemeral: true,
    });
  }
});

app.listen(3000, () => console.log('Webhook server running on port 3000'));
