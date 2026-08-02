const express = require('express');
const crypto = require('crypto');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CASHFREE_WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const SCHEDULE_CHANNEL_ID = process.env.SCHEDULE_CHANNEL_ID;

const SLOT_ROLES = {
  'ml-a': process.env.SLOT_ROLE_ML_A,
  'ml-b': process.env.SLOT_ROLE_ML_B,
  'ml-free': process.env.SLOT_ROLE_ML_FREE,
  'cr-a': process.env.SLOT_ROLE_CR_A,
  'cr-b': process.env.SLOT_ROLE_CR_B,
  'cr-free': process.env.SLOT_ROLE_CR_FREE,
  'mc-a': process.env.SLOT_ROLE_MC_A,
  'mc-b': process.env.SLOT_ROLE_MC_B,
  'mc-free': process.env.SLOT_ROLE_MC_FREE,
  'coc-war': process.env.SLOT_ROLE_COC_WAR,
  'coc-free': process.env.SLOT_ROLE_COC_FREE,
};

const SLOT_CHANNELS = {
  'ml-a': process.env.SLOT_CHANNEL_ML_A,
  'ml-b': process.env.SLOT_CHANNEL_ML_B,
  'ml-free': process.env.SLOT_CHANNEL_ML_FREE,
  'cr-a': process.env.SLOT_CHANNEL_CR_A,
  'cr-b': process.env.SLOT_CHANNEL_CR_B,
  'cr-free': process.env.SLOT_CHANNEL_CR_FREE,
  'mc-a': process.env.SLOT_CHANNEL_MC_A,
  'mc-b': process.env.SLOT_CHANNEL_MC_B,
  'mc-free': process.env.SLOT_CHANNEL_MC_FREE,
  'coc-war': process.env.SLOT_CHANNEL_COC_WAR,
  'coc-free': process.env.SLOT_CHANNEL_COC_FREE,
};

const SLOT_LABELS = {
  'ml-a': 'Mobile Legends Paid Match A',
  'ml-b': 'Mobile Legends Paid Match B',
  'ml-free': 'Mobile Legends Free Contest',
  'cr-a': 'Clash Royale Paid Match A',
  'cr-b': 'Clash Royale Paid Match B',
  'cr-free': 'Clash Royale Free Contest',
  'mc-a': 'Magic Chess Paid Match A',
  'mc-b': 'Magic Chess Paid Match B',
  'mc-free': 'Magic Chess Free Contest',
  'coc-war': 'CoC Weekly War',
  'coc-free': 'CoC Free Tournament',
};

const FREE_SLOTS = ['ml-free', 'cr-free', 'mc-free', 'coc-free'];

const PAID_LINKS = {
  'ml-a': process.env.PAYMENT_LINK_ML_A,
  'ml-b': process.env.PAYMENT_LINK_ML_B,
  'cr-a': process.env.PAYMENT_LINK_CR_A,
  'cr-b': process.env.PAYMENT_LINK_CR_B,
  'coc-war': process.env.PAYMENT_LINK_COC_WAR,
};

const slotCounts = {
  'ml-a': 8,
  'ml-b': 8,
  'ml-free': 20,
  'cr-a': 8,
  'cr-b': 8,
  'cr-free': 16,
  'mc-a': 8,
  'mc-b': 8,
  'mc-free': 16,
  'coc-war': 40,
  'coc-free': 128,
};

const activeSlots = {
  'ml-a': false,
  'ml-b': false,
  'ml-free': false,
  'cr-a': false,
  'cr-b': false,
  'cr-free': false,
  'mc-a': false,
  'mc-b': false,
  'mc-free': false,
  'coc-war': false,
  'coc-free': false,
};

const slotCounterMessageIds = {};
Object.keys(slotCounts).forEach(key => {
  slotCounterMessageIds[key] = null;
});

const pendingFreeRegistrations = {};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('clientReady', () => {
  console.log('Tournament Hub Bot is online as ' + client.user.tag);
});

client.login(BOT_TOKEN);

client.on('guildMemberAdd', async (member) => {
  try {
    const guild = member.guild;

    const mlRole = guild.roles.cache.find(r => r.name === 'Mobile Legend Player');
    const crRole = guild.roles.cache.find(r => r.name === 'Clash Royale Player');
    const mcRole = guild.roles.cache.find(r => r.name === 'Magic Chess Player');
    const cocRole = guild.roles.cache.find(r => r.name === 'CoC Player');

    if (!mlRole || !crRole || !mcRole || !cocRole) {
      console.log('One or more interest roles not found');
      return;
    }

    const dm = await member.createDM();

    await dm.send(
      'Welcome to Tournament Hub ' + member.user.username + '\n\n' +
      'We organize skill-based tournaments for Mobile Legends, ' +
      'Clash Royale, Magic Chess and Clash of Clans with real cash prizes.\n\n' +
      'Which games do you play? Reply with one of these:\n\n' +
      'ML - Mobile Legends Bang Bang\n' +
      'CR - Clash Royale\n' +
      'MC - Magic Chess Go Go\n' +
      'COC - Clash of Clans\n' +
      'ALL - I play all games'
    );

    const collector = dm.createMessageCollector({
      filter: m => m.author.id === member.user.id,
      max: 3,
      time: 86400000,
    });

    let assigned = false;

    collector.on('collect', async (response) => {
      const answer = response.content.trim().toUpperCase();

      if (['ML', 'CR', 'MC', 'COC', 'ALL'].includes(answer)) {
        if (answer === 'ML' || answer === 'ALL') await member.roles.add(mlRole);
        if (answer === 'CR' || answer === 'ALL') await member.roles.add(crRole);
        if (answer === 'MC' || answer === 'ALL') await member.roles.add(mcRole);
        if (answer === 'COC' || answer === 'ALL') await member.roles.add(cocRole);

        await dm.send(
          'You are all set! Your game role has been assigned.\n\n' +
          'Go to match-schedule in the server and type /join ' +
          'to register for upcoming matches and tournaments. See you there!'
        );
        assigned = true;
        collector.stop();
      } else {
        await dm.send(
          'Please reply with one of these exactly:\n\n' +
          'ML - Mobile Legends Bang Bang\n' +
          'CR - Clash Royale\n' +
          'MC - Magic Chess Go Go\n' +
          'COC - Clash of Clans\n' +
          'ALL - I play all games'
        );
      }
    });

    collector.on('end', async () => {
      if (!assigned) {
        await dm.send(
          'You did not reply in time. DM an admin in the server ' +
          'to assign your game role.'
        ).catch(() => {});
      }
    });

  } catch (err) {
    console.log('Error in guildMemberAdd: ' + err.message);
  }
});

function verifyCashfreeSignature(body, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('base64');
  return expectedSignature === signature;
}

async function updateOrCreateSlotCounter(slot) {
  try {
    const scheduleChannel = await client.channels.fetch(SCHEDULE_CHANNEL_ID);
    const slotsLeft = slotCounts[slot];
    const label = SLOT_LABELS[slot];
    const isFree = FREE_SLOTS.includes(slot);

    const message = slotsLeft > 0
      ? label + ' — ' + (isFree ? 'FREE' : 'Paid') + '\n' +
        'Slots remaining: ' + slotsLeft + '\n' +
        'Type /join in this channel to register.'
      : label + '\n' +
        'FULL — No slots remaining. Watch announcements for next match.';

    if (slotCounterMessageIds[slot]) {
      try {
        const existing = await scheduleChannel.messages.fetch(
          slotCounterMessageIds[slot]
        );
        await existing.edit(message);
      } catch (e) {
        const newMsg = await scheduleChannel.send(message);
        slotCounterMessageIds[slot] = newMsg.id;
      }
    } else {
      const newMsg = await scheduleChannel.send(message);
      slotCounterMessageIds[slot] = newMsg.id;
    }
  } catch (err) {
    console.log('Error updating slot counter: ' + err.message);
  }
}

async function logToChannel(message) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    await logChannel.send(message);
  } catch (err) {
    console.log('Error sending to log channel: ' + err.message);
  }
}

async function assignRole(member, slot, inGameName, inGameId, inGameDetails, amount) {
  try {
    const roleId = SLOT_ROLES[slot];
    const label = SLOT_LABELS[slot];

    await member.roles.add(roleId);

    if (slotCounts[slot] > 0) {
      slotCounts[slot]--;
    }

    if (slotCounts[slot] === 0) {
      activeSlots[slot] = false;
    }

    await updateOrCreateSlotCounter(slot);

    await member.send(
      'You are registered for ' + label + '.\n' +
      (amount ? 'Amount paid: ' + amount + '\n\n' : '\n') +
      'Your private lobby channel is now visible in the server.\n' +
      'Please be online and ready 5 minutes before match time.'
    );

    await logToChannel(
      'Registration confirmed\n' +
      'Discord: ' + member.user.username + '\n' +
      'Slot: ' + label + (amount ? ' | Amount: ' + amount : ' | FREE') + '\n' +
      'In-Game Name: ' + (inGameName || 'not provided') + '\n' +
      'In-Game ID: ' + (inGameId || 'not provided') + '\n' +
      'Group Details: ' + (inGameDetails || 'solo player') + '\n' +
      'Slots remaining: ' + slotCounts[slot]
    );

  } catch (err) {
    console.log('Error assigning role: ' + err.message);
    await logToChannel('Error assigning role for ' + member.user.username + ' - ' + err.message);
  }
}

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-cashfree-signature'];

  if (!verifyCashfreeSignature(req.body, signature, CASHFREE_WEBHOOK_SECRET)) {
    console.log('Invalid Cashfree signature - ignoring');
    return res.status(400).send('Invalid signature');
  }

  const event = req.body.type;
  if (event !== 'PAYMENT_SUCCESS') return res.send('ok');

  const payment = req.body.data;
  const notes = payment?.customer_details?.customer_note || '';

  const parts = notes.split('|').map(p => p.trim());
  const discordUsername = parts[0]?.toLowerCase();
  const matchSlot = parts[1]?.toLowerCase();
  const inGameName = parts[2];
  const inGameId = parts[3];
  const inGameDetails = parts[4];
  const amount = payment?.order_amount;

  if (!discordUsername || !matchSlot) {
    await logToChannel(
      'Payment received but missing details.\n' +
      'Amount: ' + amount + ' | Notes: ' + notes
    );
    return res.send('ok');
  }

  const roleId = SLOT_ROLES[matchSlot];
  if (!roleId) {
    await logToChannel('Unknown match slot: ' + matchSlot + ' | Amount: ' + amount);
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
        'Payment received but Discord user not found.\n' +
        'Discord username: ' + discordUsername + '\n' +
        'Slot: ' + SLOT_LABELS[matchSlot] + ' | Amount: ' + amount + '\n' +
        'In-Game Name: ' + (inGameName || 'not provided') + '\n' +
        'In-Game ID: ' + (inGameId || 'not provided') + '\n' +
        'Please assign role manually.'
      );
      return res.send('ok');
    }

    await assignRole(member, matchSlot, inGameName, inGameId, inGameDetails, amount);
    res.send('ok');

  } catch (err) {
    console.log('Error processing payment: ' + err.message);
    await logToChannel('Error processing payment - ' + err.message);
    res.send('ok');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'join') {
    const slot = interaction.options.getString('slot');
    const label = SLOT_LABELS[slot];
    const isFree = FREE_SLOTS.includes(slot);

    if (!activeSlots[slot]) {
      return interaction.reply({
        content:
          label + ' is not available at the moment.\n' +
          'Watch #announcements for when the next match or contest opens.',
        ephemeral: true,
      });
    }

    if (slotCounts[slot] <= 0) {
      return interaction.reply({
        content: label + ' is full. No slots remaining. Watch #announcements for next match.',
        ephemeral: true,
      });
    }

    if (isFree) {
      await interaction.reply({
        content:
          label + ' — FREE\n' +
          'Slots remaining: ' + slotCounts[slot] + '\n\n' +
          'Check your DMs — the bot will ask for your details to complete registration.',
        ephemeral: true,
      });

      try {
        const dm = await interaction.user.createDM();

        await dm.send(
          'Registering you for ' + label + '\n\n' +
          'Please reply with your details in this exact format:\n\n' +
          'IGN | Player ID | Group Details\n\n' +
          'Example for solo player:\n' +
          'Lavkush | #ABC123 | solo\n\n' +
          'Example for group:\n' +
          'Lavkush | #ABC123 | teammate1 #XYZ | teammate2 #DEF\n\n' +
          'Reply within 5 minutes or your slot will not be confirmed.'
        );

        pendingFreeRegistrations[interaction.user.id] = {
          slot: slot,
          timestamp: Date.now(),
        };

      } catch (err) {
        console.log('Error sending free registration DM: ' + err.message);
      }

    } else {
      const link = PAID_LINKS[slot];

      if (!link || link === 'placeholder') {
        return interaction.reply({
          content: label + ' registration is not open yet. Watch #announcements for updates.',
          ephemeral: true,
        });
      }

      await interaction.reply({
        content:
          label + '\n' +
          'Slots remaining: ' + slotCounts[slot] + '\n\n' +
          'Pay your entry fee here:\n' +
          link + '\n\n' +
          'Fill these correctly when paying:\n' +
          'Discord Username - your exact Discord username\n' +
          'In-Game Name - your name as it appears in game\n' +
          'In-Game ID - your unique player ID\n' +
          'Group Details - teammates IGN and ID if registering as group. Leave blank if solo.\n\n' +
          'Your lobby channel unlocks automatically within 30 seconds of payment.',
        ephemeral: true,
      });
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.guild === null) {
    const userId = message.author.id;
    const pending = pendingFreeRegistrations[userId];

    if (pending) {
      const elapsed = Date.now() - pending.timestamp;
      if (elapsed > 300000) {
        delete pendingFreeRegistrations[userId];
        await message.reply('Registration timed out. Please use /join again to retry.');
        return;
      }

      const parts = message.content.split('|').map(p => p.trim());
      const inGameName = parts[0];
      const inGameId = parts[1];
      const inGameDetails = parts.slice(2).join(' | ') || 'solo player';

      if (!inGameName || !inGameId) {
        await message.reply(
          'Incorrect format. Please reply with:\n\n' +
          'IGN | Player ID | Group Details\n\n' +
          'Example: Lavkush | #ABC123 | solo'
        );
        return;
      }

      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        await guild.members.fetch();

        const member = guild.members.cache.get(userId);

        if (!member) {
          await message.reply('Could not find you in the server. Make sure you are still in the server and try again.');
          delete pendingFreeRegistrations[userId];
          return;
        }

        delete pendingFreeRegistrations[userId];
        await assignRole(member, pending.slot, inGameName, inGameId, inGameDetails, null);
        await message.reply('Registration complete! Check the server — your lobby channel is now visible.');

      } catch (err) {
        console.log('Error in free registration: ' + err.message);
        await message.reply('Something went wrong. Please DM an admin for help.');
      }

      return;
    }
  }

  const member = message.member;
  if (!member) return;

  const isAdmin = member.roles.cache.some(r => r.name === 'Admin');
  if (!isAdmin) return;

  const validSlots = Object.keys(activeSlots);

  if (message.content.startsWith('!open ')) {
    const slot = message.content.split(' ')[1];
    if (!validSlots.includes(slot)) {
      return message.reply('Unknown slot. Valid slots: ' + validSlots.join(', '));
    }
    activeSlots[slot] = true;
    await updateOrCreateSlotCounter(slot);
    await message.reply(SLOT_LABELS[slot] + ' is now OPEN. Players can register using /join.');
    await logToChannel('Slot opened by admin: ' + SLOT_LABELS[slot]);
  }

  if (message.content.startsWith('!close ')) {
    const slot = message.content.split(' ')[1];
    if (!validSlots.includes(slot)) {
      return message.reply('Unknown slot. Valid slots: ' + validSlots.join(', '));
    }
    activeSlots[slot] = false;
    await message.reply(SLOT_LABELS[slot] + ' is now CLOSED. Players can no longer register.');
    await logToChannel('Slot closed by admin: ' + SLOT_LABELS[slot]);
  }

  if (message.content === '!status') {
    const statusList = validSlots.map(slot =>
      SLOT_LABELS[slot] + ': ' + (activeSlots[slot] ? 'OPEN (' + slotCounts[slot] + ' slots left)' : 'CLOSED')
    ).join('\n');
    await message.reply('Current slot status:\n\n' + statusList);
  }

  if (message.content === '!resetslots') {
    const defaults = {
      'ml-a': 8, 'ml-b': 8, 'ml-free': 20,
      'cr-a': 8, 'cr-b': 8, 'cr-free': 16,
      'mc-a': 8, 'mc-b': 8, 'mc-free': 16,
      'coc-war': 40, 'coc-free': 128,
    };
    Object.keys(slotCounts).forEach(key => {
      slotCounts[key] = defaults[key];
      slotCounterMessageIds[key] = null;
    });
    await message.reply('All slot counts reset successfully.');
  }

  if (message.content.startsWith('!resetslot ')) {
    const slot = message.content.split(' ')[1];
    const defaults = {
      'ml-a': 8, 'ml-b': 8, 'ml-free': 20,
      'cr-a': 8, 'cr-b': 8, 'cr-free': 16,
      'mc-a': 8, 'mc-b': 8, 'mc-free': 16,
      'coc-war': 40, 'coc-free': 128,
    };
    if (!defaults[slot]) {
      return message.reply('Unknown slot. Valid slots: ' + validSlots.join(', '));
    }
    slotCounts[slot] = defaults[slot];
    slotCounterMessageIds[slot] = null;
    await message.reply('Slot ' + slot + ' reset to ' + defaults[slot] + ' successfully.');
  }
});

app.listen(3000, () => console.log('Webhook server running on port 3000'));
