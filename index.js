const express = require('express');
const axios = require('axios');
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
};

const SLOT_CHANNELS = {
  '4pm': process.env.SLOT_CHANNEL_4PM,
  '6pm': process.env.SLOT_CHANNEL_6PM,
};

const slotCounts = {
  '4pm': 8,
  '6pm': 8,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', () => {
  console.log('MagicCOC Bot is online');
});

client.login(BOT_TOKEN);

function verifySignature(body, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return expectedSignature === signature;
}

async function updateScheduleMessage(slot) {
  try {
    const scheduleChannel = await client.channels.fetch(SCHEDULE_CHANNEL_ID);
    const messages = await scheduleChannel.messages.fetch({ limit: 10 });
    const slotMessage = messages.find(m => 
      m.content.includes(`${slot.toUpperCase()} Match`) && m.author.bot
    );

    if (slotMessage) {
      const slotsLeft = slotCounts[slot];
      if (slotsLeft > 0) {
        await slotMessage.edit(
          slotMessage.content.replace(
            /\d+ slots? left|FULL ❌/,
            `${slotsLeft} slot${slotsLeft === 1 ? '' : 's'} left`
          )
        );
      } else {
        await slotMessage.edit(
          slotMessage.content.replace(/\d+ slots? left|FULL ❌/, 'FULL ❌')
        );
      }
    }
  } catch (err) {
    console.error('Error updating schedule message:', err.message);
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
  const discordUsername = payment?.notes?.discord_username?.toLowerCase().trim();
  const matchSlot = payment?.notes?.match_slot?.toLowerCase().trim();
  const amount = payment?.amount / 100;

  if (!discordUsername || !matchSlot) {
    console.log('Missing notes - discord_username or match_slot not filled');
    return res.send('ok');
  }

  const roleId = SLOT_ROLES[matchSlot];

  if (!roleId) {
    console.log('Unknown match slot:', matchSlot);
    return res.send('ok');
  }

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();

    const member = guild.members.cache.find(
      m => m.user.username.toLowerCase() === discordUsername
    );

    if (!member) {
      const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
      await logChannel.send(
        `⚠️ Payment received but Discord user not found.\n` +
        `Username typed: **${discordUsername}** | Slot: **${matchSlot}** | Amount: ₹${amount}\n` +
        `Please assign **${matchSlot.toUpperCase()} Registered** role manually.`
      );
      return res.send('ok');
    }

    await member.roles.add(roleId);

    if (slotCounts[matchSlot] > 0) {
      slotCounts[matchSlot]--;
    }

    await updateScheduleMessage(matchSlot);

    await member.send(
      `✅ Payment confirmed! You are registered for the **${matchSlot.toUpperCase()} Magic Chess match**.\n` +
      `Entry fee paid: ₹${amount}\n` +
      `Your lobby channel is now visible in the server. See you there! 🎮`
    );

    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    await logChannel.send(
      `✅ Role assigned: **${member.user.username}** → ${matchSlot.toUpperCase()} Registered | ₹${amount} paid | Slots left: ${slotCounts[matchSlot]}`
    );

    res.send('ok');

  } catch (err) {
    console.error('Error:', err.message);
    res.send('ok');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'join') {
    const slot = interaction.options.getString('slot');

    const links = {
      '4pm': process.env.PAYMENT_LINK_4PM,
      '6pm': process.env.PAYMENT_LINK_6PM,
    };

    if (!links[slot]) {
      return interaction.reply({
        content: 'Invalid slot. Choose 4pm or 6pm.',
        ephemeral: true
      });
    }

    if (slotCounts[slot] <= 0) {
      return interaction.reply({
        content: `❌ Sorry the **${slot.toUpperCase()} match** is already full. Watch #match-schedule for new slots.`,
        ephemeral: true
      });
    }

    await interaction.reply({
      content:
        `**${slot.toUpperCase()} Magic Chess Match**\n` +
        `Slots remaining: **${slotCounts[slot]}**\n` +
        `Pay your entry fee here → ${links[slot]}\n\n` +
        `⚠️ Important: When paying, enter your **exact Discord username** in the Discord Username field. If it does not match exactly the bot cannot find you and your role will not be assigned automatically.`,
      ephemeral: true
    });
  }
});

app.listen(3000, () => console.log('Webhook server running on port 3000'));
