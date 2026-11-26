'use strict';
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { Probot } = require('discord-probot-transfer');
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');

const CFG = {
  owner: process.env.OWNER_ID || '1483368871032520704',
  guild: process.env.GUILD_ID || '1501507950492127234',
  gameRooms: (process.env.GAME_CHANNEL_IDS || '1575119362363490455,1575119396232232990,1575119427349913630').split(',').map(x => x.trim()).filter(Boolean),
  withdrawRoom: process.env.WITHDRAW_PANEL_CHANNEL_ID || '1575119654534381699',
  requestsRoom: process.env.WITHDRAW_REQUESTS_CHANNEL_ID || '1575119873875517540',
  admins: (process.env.ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean),
  probotId: process.env.PROBOT_ID || '282859044593598464',
  minWithdraw: 4000000, maxWithdraw: 10000000000, fee: 0.04,
  inviteMs: 40000, gameMs: 90000,
};

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'store.json');
fs.mkdirSync(DIR, { recursive: true });

/*
 * GitHub backup is separate from main so data commits never trigger a bot redeploy.
 * Required EuizHost variable: GITHUB_TOKEN (Contents: Read and write).
 */
const GH_REPO = process.env.GITHUB_REPOSITORY || 'hasanalbably905-oss/Casinooooo-';
const GH_BRANCH = process.env.GITHUB_DATA_BRANCH || 'bot-data';
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const GH_FILE_PATH = 'data/store.json';
let githubFileSha = null;
let githubDataBlocked = false;

function githubRequest(method, apiPath, payload) {
  if (!GH_TOKEN) return Promise.reject(new Error('Missing GITHUB_TOKEN environment variable.'));
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + GH_TOKEN,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Batoot-Casino-Bot',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
        const error = new Error('GitHub API ' + res.statusCode + ': ' + (data.message || raw || 'Unknown error'));
        error.statusCode = res.statusCode;
        reject(error);
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('GitHub API request timed out.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const githubContentPath = '/repos/' + GH_REPO + '/contents/' + GH_FILE_PATH + '?ref=' + encodeURIComponent(GH_BRANCH);
async function loadGitHubData() {
  if (!GH_TOKEN) {
    console.warn('GitHub backup disabled: GITHUB_TOKEN is not configured.');
    return false;
  }
  try {
    const remote = await githubRequest('GET', githubContentPath);
    if (!remote.content || !remote.sha) throw new Error('GitHub data file has no content or SHA.');
    const parsed = JSON.parse(Buffer.from(remote.content.replace(/\\s/g, ''), 'base64').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.users || typeof parsed.users !== 'object') {
      throw new Error('Invalid GitHub data format; refusing to overwrite data.');
    }
    // Never replace locally imported balances with a newly-created empty GitHub store.
    const remoteUsers = parsed.users;
    const localUsers = db.users && typeof db.users === 'object' ? db.users : {};
    db.users = Object.keys(remoteUsers).length === 0 && Object.keys(localUsers).length > 0
      ? localUsers
      : remoteUsers;
    db.games = parsed.games || {};
    db.withdrawals = parsed.withdrawals || {};
    db.processedTransfers = parsed.processedTransfers || {};
    db.transfers = parsed.transfers || {};
    db.adminLogs = parsed.adminLogs || [];
    githubFileSha = remote.sha;
    await fs.promises.writeFile(FILE, JSON.stringify(db, null, 2), 'utf8');
    console.log('Loaded casino data from GitHub.');
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      console.log('No GitHub backup exists yet; local data will be uploaded on first save.');
      return false;
    }
    githubDataBlocked = true;
    console.error('GitHub read failed; remote writes disabled to protect existing data:', error);
    return false;
  }
}

async function pushGitHubData(content) {
  if (!GH_TOKEN || githubDataBlocked) return;
  const payload = {
    message: 'Update Batoot Casino data',
    content: Buffer.from(content, 'utf8').toString('base64'),
    ...(githubFileSha ? { sha: githubFileSha } : {}),
    branch: GH_BRANCH,
  };
  try {
    const result = await githubRequest('PUT', '/repos/' + GH_REPO + '/contents/' + GH_FILE_PATH, payload);
    githubFileSha = result.content && result.content.sha ? result.content.sha : githubFileSha;
  } catch (error) {
    if (error.statusCode !== 409 && error.statusCode !== 422) throw error;
    const latest = await githubRequest('GET', githubContentPath);
    if (!latest.sha) throw error;
    const retry = await githubRequest('PUT', '/repos/' + GH_REPO + '/contents/' + GH_FILE_PATH, {
      message: 'Update Batoot Casino data',
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: latest.sha,
      branch: GH_BRANCH,
    });
    githubFileSha = retry.content && retry.content.sha ? retry.content.sha : latest.sha;
  }
}


function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function importOldUsers() {
  const paths = [path.join(DIR, 'databaseusers.json'), path.join(__dirname, 'db.json')];
  for (const file of paths) {
    const rows = readJson(file, []);
    if (!Array.isArray(rows) || !rows.length) continue;
    const users = {};
    for (const row of rows) {
      if (!row || !row.id) continue;
      const coins = Number(row.coins);
      users[String(row.id)] = { coins: Number.isSafeInteger(coins) && coins > 0 ? coins : 0 };
    }
    if (Object.keys(users).length) return users;
  }
  return {};
}
const old = readJson(FILE, null);
const db = old && typeof old === 'object'
  ? { users: old.users || importOldUsers(), games: old.games || {}, withdrawals: old.withdrawals || {}, processedTransfers: old.processedTransfers || {}, transfers: old.transfers || {}, adminLogs: old.adminLogs || [] }
  : { users: importOldUsers(), games: {}, withdrawals: {}, processedTransfers: {}, transfers: {}, adminLogs: [] };

let writeChain = Promise.resolve();
function save() {
  const operation = writeChain.catch(() => {}).then(async () => {
    const content = JSON.stringify(db, null, 2);
    const temp = FILE + '.tmp';
    await fs.promises.writeFile(temp, content, 'utf8');
    await fs.promises.rename(temp, FILE);
    try {
      await pushGitHubData(content);
    } catch (error) {
      // Local storage is always kept; GitHub failures must not break casino commands.
      console.error('GitHub backup failed; local data is safe:', error);
    }
  });
  writeChain = operation;
  return operation;
}
function account(id) {
  const key = String(id);
  if (!db.users[key]) db.users[key] = { id: key, coins: 0 };
  const n = Number(db.users[key].coins);
  db.users[key].coins = Number.isSafeInteger(n) && n >= 0 ? n : 0;
  db.users[key].id = key;
  return db.users[key];
}
function recordMember(member) {
  const data = account(member.id);
  const user = member.user || member;
  data.username = user.username || data.username || String(member.id);
  data.tag = user.tag || data.tag || data.username;
  data.guildId = member.guild ? member.guild.id : CFG.guild;
  data.isMember = true;
  if (member.joinedTimestamp) data.joinedAt = member.joinedTimestamp;
  data.lastSeenAt = Date.now();
  delete data.leftAt;
  return data;
}
function amountOf(input) {
  if (!input) return null;
  const m = String(input).trim().toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(k|m|b)?$/);
  if (!m) return null;
  const factor = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  const n = Number(m[1]) * factor;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
const fmt = n => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('en-US');
const admin = id => String(id) === CFG.owner || CFG.admins.includes(String(id));
function active(id, excludeId) {
  return Object.values(db.games).some(g => g && g.id !== excludeId && ['pending', 'awaiting_accept', 'selecting', 'playing'].includes(g.status) && (g.p1 === id || g.p2 === id));
}
const makeEmbed = (title, description) => new EmbedBuilder().setColor(0x30343b).setTitle(title).setDescription(description || '').setFooter({ text: 'Batoot Casino' }).setTimestamp();
const btn = (id, label, style) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});
client.probot = Probot(client, {
  fetchGuilds: true,
  data: [{
    fetchMembers: true,
    guildId: CFG.guild,
    probotId: CFG.probotId,
    // Credits are accepted only when sent to the configured bot owner account.
    owners: [CFG.owner],
  }],
});

client.probot.on('transfered', async (guild, data, error) => {
  try {
    if (error) {
      console.error('ProBot transfer error:', error);
      return;
    }
    if (!data || !data.member) return;

    // Keep the legacy Batoot behavior: ProBot confirms the recipient through isOwner.
    // The library's price is the credited amount after ProBot fees.
    if (data.isOwner === false) return;

    const member = data.member;
    const memberId = String(member.id || (member.user && member.user.id) || '');
    const credited = Number(String(data.price ?? '').replace(/,/g, '').trim());
    if (!memberId || !Number.isSafeInteger(credited) || credited <= 0) {
      console.warn('ProBot transfer ignored: invalid member or amount.', {
        memberId: Boolean(memberId),
        isOwner: data.isOwner,
        price: data.price,
      });
      return;
    }

    const transferId = String(
      (data.message && data.message.id) ||
      data.messageId ||
      data.transferId ||
      data.id ||
      ''
    );
    if (transferId && db.processedTransfers[transferId]) {
      console.log('Duplicate ProBot transfer ignored:', transferId);
      return;
    }

    const userAccount = account(memberId);
    userAccount.coins += credited;
    if (transferId) {
      db.processedTransfers[transferId] = Date.now();
      const ids = Object.keys(db.processedTransfers);
      if (ids.length > 5000) {
        ids.sort((a, b) => db.processedTransfers[a] - db.processedTransfers[b]);
        for (const id of ids.slice(0, ids.length - 5000)) delete db.processedTransfers[id];
      }
    }
    await save();

    const sender = member.user || member;
    const avatar = typeof client.user?.displayAvatarURL === 'function'
      ? client.user.displayAvatarURL({ dynamic: true })
      : null;
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setDescription('تم الشحن بنجاح')
      .addFields(
        { name: 'المبلغ', value: '> ' + fmt(credited) },
        { name: 'المستلم', value: '> <@' + memberId + '>' },
        { name: 'الرصيد الحالي', value: '> ' + fmt(userAccount.coins) },
      )
      .setFooter({ text: (data.channel && data.channel.guild && data.channel.guild.name) || 'Batoot Casino' })
      .setTimestamp();
    if (avatar) embed.setThumbnail(avatar);

    const channel = data.channel || (guild && guild.channel);
    if (channel && typeof channel.send === 'function') {
      await channel.send({ embeds: [embed], content: '<@' + memberId + '>' }).catch(err => {
        console.error('Could not send ProBot credit confirmation:', err);
      });
    } else {
      console.warn('ProBot transfer credited, but no text channel was available for confirmation.');
    }
  } catch (err) {
    console.error('ProBot transfer handler:', err);
  }
});

async function ephemeral(i, content) {
  const payload = { content, ephemeral: true };
  if (i.deferred || i.replied) return i.followUp(payload).catch(() => {});
  return i.reply(payload).catch(() => {});
}
async function targetUser(message, token) {
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned;
  const id = String(token || '').replace(/[<@!>]/g, '');
  if (!/^\d{17,20}$/.test(id)) return null;
  return client.users.fetch(id).catch(() => null);
}
async function createMemberTransfer(message, args) {
  const target = await targetUser(message, args[1]);
  const rawAmount = args[2];
  const amount = amountOf(rawAmount);
  if (!target) return message.reply('❎ **حدد العضو الذي تريد التحويل إليه**\nمثال: `تحويل @عضو 100k`');
  if (!amount) return message.reply('❎ **المبلغ غير صحيح**\nاستخدم رقماً أو K أو M، مثال: `تحويل @عضو 250k`');
  if (target.bot) return message.reply('❎ لا يمكن تحويل الرصيد إلى بوت.');
  if (target.id === message.author.id) return message.reply('❎ لا يمكنك التحويل إلى نفسك.');
  const targetMember = await message.guild.members.fetch(target.id).catch(() => null);
  if (!targetMember) return message.reply('❎ يجب أن يكون المستلم عضواً في السيرفر.');
  const senderData = account(message.author.id);
  const receiverData = account(target.id);
  if (senderData.coins < amount) {
    return message.reply('❎ **رصيدك لا يكفي**\nرصيدك الحالي: **' + fmt(senderData.coins) + '**\nالمبلغ المطلوب: **' + fmt(amount) + '**');
  }
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const transfer = {
    id, from: message.author.id, to: target.id, amount,
    status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 120000,
    channelId: message.channel.id, guildId: message.guild.id,
  };
  db.transfers[id] = transfer;
  await save();
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('تأكيد تحويل رصيد')
    .setDescription(
      '**يرجى مراجعة تفاصيل التحويل قبل التأكيد.**\n\n' +
      '**المرسل:** ' + message.author + '\n' +
      '**المستلم:** ' + target + '\n' +
      '**المبلغ:** ' + fmt(amount) + ' كوينز\n' +
      '**رصيدك الحالي:** ' + fmt(senderData.coins) + '\n' +
      '**الرصيد بعد التحويل:** ' + fmt(senderData.coins - amount) + '\n\n' +
      'لن يتم خصم أي مبلغ إلا بعد ضغطك على زر **تأكيد التحويل**.\n' +
      'ينتهي هذا الطلب خلال دقيقتين، ويمكنك إلغاؤه دون أي خصم.'
    )
    .setFooter({ text: 'Batoot Casino • نظام التحويل الآمن' })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    btn('t:confirm:' + id, 'تأكيد التحويل', ButtonStyle.Success),
    btn('t:cancel:' + id, 'إلغاء', ButtonStyle.Danger),
  );
  const sent = await message.reply({ embeds: [embed], components: [row] }).catch(async error => {
    transfer.status = 'cancelled';
    transfer.cancelReason = 'message_failed';
    await save();
    throw error;
  });
  transfer.messageId = sent.id;
  await save();
}
async function transferButton(i, parts) {
  const action = parts[1];
  const id = parts[2];
  const transfer = db.transfers[id];
  if (!transfer || transfer.status !== 'pending') return ephemeral(i, 'هذا التحويل غير متاح أو تم التعامل معه مسبقاً.');
  if (i.user.id !== transfer.from) return ephemeral(i, 'فقط صاحب طلب التحويل يستطيع تأكيده أو إلغاءه.');
  if (Date.now() > transfer.expiresAt) {
    transfer.status = 'expired';
    transfer.finishedAt = Date.now();
    await save();
    await i.update({ content: 'انتهت مهلة التحويل. لم يتم خصم أي رصيد.', embeds: [], components: [] }).catch(() => {});
    return;
  }
  if (action === 'cancel') {
    transfer.status = 'cancelled';
    transfer.finishedAt = Date.now();
    await save();
    return i.update({ content: 'تم إلغاء طلب التحويل. لم يتم تغيير أي رصيد.', embeds: [], components: [] });
  }
  if (action !== 'confirm') return;
  const sender = account(transfer.from);
  const receiver = account(transfer.to);
  if (sender.coins < transfer.amount) {
    transfer.status = 'rejected';
    transfer.finishedAt = Date.now();
    await save();
    return i.update({ content: 'فشل التحويل: رصيدك لم يعد كافياً. لم يتم خصم أي مبلغ.', embeds: [], components: [] });
  }
  // Update both balances in one synchronous transaction before saving.
  sender.coins -= transfer.amount;
  receiver.coins += transfer.amount;
  transfer.status = 'completed';
  transfer.finishedAt = Date.now();
  transfer.senderBalanceAfter = sender.coins;
  transfer.receiverBalanceAfter = receiver.coins;
  const historyIds = Object.keys(db.transfers);
  const finished = historyIds.filter(key => db.transfers[key].status !== 'pending')
    .sort((a, b) => (db.transfers[a].finishedAt || 0) - (db.transfers[b].finishedAt || 0));
  for (const oldId of finished.slice(0, Math.max(0, finished.length - 1000))) delete db.transfers[oldId];
  await save();
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('تم التحويل بنجاح')
    .setDescription('تم نقل الرصيد بين الحسابين وحفظ العملية في سجل التحويلات.')
    .addFields(
      { name: 'المرسل', value: '<@' + transfer.from + '>', inline: true },
      { name: 'المستلم', value: '<@' + transfer.to + '>', inline: true },
      { name: 'المبلغ المحوّل', value: fmt(transfer.amount) + ' كوينز', inline: false },
      { name: 'رصيدك بعد التحويل', value: fmt(sender.coins), inline: true },
      { name: 'رصيد المستلم بعد التحويل', value: fmt(receiver.coins), inline: true },
      { name: 'رقم العملية', value: '`' + transfer.id + '`', inline: false },
    )
    .setFooter({ text: 'Batoot Casino • سجل التحويلات' })
    .setTimestamp();
  return i.update({ embeds: [embed], components: [] });
}
async function claimDaily(message) {
  const data = account(message.author.id);
  const now = Date.now();
  const remaining = 24 * 60 * 60 * 1000 - (now - Number(data.dailyAt || 0));
  if (remaining > 0) {
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.ceil((remaining % 3600000) / 60000);
    return message.reply('⏳ استلمت مكافأتك اليومية بالفعل. ارجع بعد **' + hours + ' ساعة و' + minutes + ' دقيقة**.');
  }
  const reward = crypto.randomInt(1500, 5001);
  data.coins += reward;
  data.dailyAt = now;
  data.dailyClaims = (data.dailyClaims || 0) + 1;
  await save();
  return message.reply({ embeds: [makeEmbed('🎁 المكافأة اليومية',
    'مبروك! حصلت على **' + fmt(reward) + ' كوين**.\n\nرصيدك الجديد: **' + fmt(data.coins) + '**\nيمكنك استلام المكافأة التالية بعد 24 ساعة.'
  ).setColor(0x2ecc71)] });
}
async function workForCoins(message) {
  const data = account(message.author.id);
  const now = Date.now();
  const remaining = 60 * 60 * 1000 - (now - Number(data.workAt || 0));
  if (remaining > 0) return message.reply('🕒 يمكنك العمل مجدداً بعد **' + Math.ceil(remaining / 60000) + ' دقيقة**.');
  const jobs = ['ساعدت في تنظيم الكازينو', 'أنهيت مهمة يومية', 'فزت بمسابقة صغيرة', 'قدمت خدمة لأحد الأعضاء', 'أنجزت عملاً إضافياً'];
  const reward = crypto.randomInt(500, 2501);
  data.coins += reward;
  data.workAt = now;
  data.workCount = (data.workCount || 0) + 1;
  await save();
  return message.reply({ embeds: [makeEmbed('💼 نتيجة العمل',
    '📌 ' + jobs[crypto.randomInt(jobs.length)] + '\n\n💰 أجرك: **' + fmt(reward) + ' كوين**\n💳 رصيدك الحالي: **' + fmt(data.coins) + '**\n\nيمكنك العمل مرة أخرى بعد ساعة.'
  ).setColor(0x3498db)] });
}
async function showProfile(message, user) {
  const data = account(user.id);
  const sent = Object.values(db.transfers).filter(t => t && t.status === 'completed' && t.from === user.id).length;
  const received = Object.values(db.transfers).filter(t => t && t.status === 'completed' && t.to === user.id).length;
  const member = await message.guild.members.fetch(user.id).catch(() => null);
  const joined = member && member.joinedTimestamp ? '<t:' + Math.floor(member.joinedTimestamp / 1000) + ':D>' : 'غير متوفر';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: 'الملف الشخصي • ' + user.username, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '💰 الرصيد', value: fmt(data.coins) + ' كوين', inline: true },
      { name: '🎁 مرات اليومي', value: String(data.dailyClaims || 0), inline: true },
      { name: '💼 مرات العمل', value: String(data.workCount || 0), inline: true },
      { name: '📤 تحويلات مرسلة', value: String(sent), inline: true },
      { name: '📥 تحويلات مستلمة', value: String(received), inline: true },
      { name: '📅 تاريخ الانضمام', value: joined, inline: true },
    )
    .setFooter({ text: 'Batoot Casino • الملف الشخصي' }).setTimestamp();
  return message.reply({ embeds: [embed] });
}
async function showTransferHistory(message, user) {
  const rows = Object.values(db.transfers)
    .filter(t => t && t.status === 'completed' && (t.from === user.id || t.to === user.id))
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0)).slice(0, 10);
  if (!rows.length) return message.reply('📭 لا توجد تحويلات مكتملة مسجلة لك.');
  const lines = rows.map((t, index) => {
    const outgoing = t.from === user.id;
    return '**' + (index + 1) + '.** ' + (outgoing ? '📤 إلى' : '📥 من') + ' <@' + (outgoing ? t.to : t.from) + '> — **' + fmt(t.amount) + '** كوين\n<t:' + Math.floor((t.finishedAt || t.createdAt) / 1000) + ':R>';
  });
  return message.reply({ embeds: [makeEmbed('📜 آخر التحويلات', lines.join('\n\n')).setColor(0x5865f2)] });
}
function logAdminAction(entry) {
  db.adminLogs.unshift({ ...entry, at: Date.now() });
  if (db.adminLogs.length > 500) db.adminLogs.length = 500;
}
async function showAdminLog(message) {
  if (!admin(message.author.id)) return message.reply('❎ هذا الأمر للإدارة فقط.');
  const rows = db.adminLogs.slice(0, 10);
  if (!rows.length) return message.reply('لا توجد عمليات إدارية مسجلة حالياً.');
  const lines = rows.map((x, i) => '**' + (i + 1) + '.** <@' + x.admin + '> ' + x.action + ' **' + fmt(x.amount) + '** إلى <@' + x.target + '>\n<t:' + Math.floor(x.at / 1000) + ':R>');
  return message.reply({ embeds: [makeEmbed('🛡️ سجل عمليات الإدارة', lines.join('\n\n')).setColor(0xe67e22)] });
}
async function balance(message, user) {
  const member = message.guild.members.cache.get(user.id);
  const data = member ? recordMember(member) : account(user.id);
  data.username = user.username || data.username || String(user.id);
  data.tag = user.tag || data.tag || data.username;
  data.guildId = message.guild.id;
  data.lastSeenAt = Date.now();
  await save();

  // Keep the original balance command appearance and reply behavior.
  const embed = new EmbedBuilder()
    .setColor('Gold')
    .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
    .setTitle('الرصيد الحالي لـ ' + user.username)
    .setDescription('**' + fmt(data.coins) + ' كوين**')
    .setFooter({ text: message.guild.name })
    .setTimestamp();

  return message.reply({ embeds: [embed] });
}
function legacyAdminAmount(input) {
  if (!input) return { error: 'missing' };
  const raw = String(input).trim();
  if (raw.includes('.') || raw.includes(',')) return { error: 'decimal' };
  if (!/^\d+(?:[kKmM])?$/.test(raw)) return { error: 'invalid' };
  const suffix = raw.slice(-1).toLowerCase();
  const digits = /[km]$/i.test(raw) ? raw.slice(0, -1) : raw;
  const value = Number(digits) * (suffix === 'k' ? 1000 : suffix === 'm' ? 1000000 : 1);
  if (!Number.isSafeInteger(value) || value <= 0) return { error: 'invalid' };
  return { value };
}
async function adminBalance(message, args, add) {
  if (!admin(message.author.id)) return message.reply('هذا الأمر للأونر والإدارة المعتمدة فقط.');
  if (!args[1]) return message.reply('> لم تقم بتحديد العضو !');
  const user = await targetUser(message, args[1]);
  if (!user) return message.reply('❎ **لم استطع العثور على هذا الشخص**');
  if (!args[2]) return message.reply('> لم تقم بتحديد المبلغ !');
  const parsed = legacyAdminAmount(args[2]);
  if (parsed.error === 'decimal') return message.reply('❎ **لا يمكن ' + (add ? 'إضافة' : 'حذف') + ' أرقام عشرية**');
  if (parsed.error) return message.reply('❎ **برجاء وضع أرقام صحيحة**');
  const n = parsed.value;
  const a = account(user.id);
  if (!add && a.coins === 0) return message.reply('❎ **هذا الشخص ليس لديه أي رصيد للحذف**');
  if (!add && a.coins < n) return message.reply('❎ **هذا الشخص ليس معه هذا المبلغ لحذفه**');
  a.coins += add ? n : -n;
  logAdminAction({ admin: message.author.id, target: user.id, amount: n, action: add ? 'أضاف رصيداً' : 'خصم رصيداً', balanceAfter: a.coins });
  await save();
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setDescription(add ? 'تم الإضافة بنجاح' : 'تم حذف بنجاح')
    .addFields(
      { name: 'بواسطة', value: message.author.toString() },
      { name: add ? 'اضاف' : 'حذف', value: String.fromCharCode(36) + fmt(n) },
      { name: add ? 'المستلم' : 'من', value: user.toString() },
      { name: 'الرصيد الحالي للمستلم', value: fmt(a.coins) },
    );
  return message.reply({ embeds: [embed] });
}
async function challenge(message, args) {
  if (!CFG.gameRooms.includes(message.channel.id)) return message.reply('أوامر التحدي تعمل فقط في رومات الألعاب المحددة.');
  const user = await targetUser(message, args[1]);
  const bet = amountOf(args[2]);
  if (!user || user.bot || user.id === message.author.id || !bet) return message.reply('الاستخدام: تحدي @العضو المبلغ');
  if (active(message.author.id) || active(user.id)) return message.reply('أحد اللاعبين لديه تحدٍ لم ينتهِ بعد.');
  if (account(message.author.id).coins < bet) return message.reply('❎ **ليس لديك ما يكفي للتحدي على ' + fmt(bet) + '**');
  if (account(user.id).coins < bet) return message.reply('❎ **ليس لدى صديقك ما يكفي للتحدي على ' + fmt(bet) + '**');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const g = db.games[id] = {
    id, p1: message.author.id, p2: user.id, bet, status: 'pending',
    escrow: false, channel: message.channel.id, message: null, mode: null,
    expires: Date.now() + CFG.inviteMs, created: Date.now(),
  };
  const embed = new EmbedBuilder()
    .setColor(0x808080)
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
    .setTitle('اختار نوع اللعبة')
    .setDescription('> العضو: ' + user.toString() + '\n\nالمبلغ: `' + fmt(bet) + '`')
    .addFields(
      { name: 'لعبة النرد 🎲', value: '> يفوز الذي يحصل على أعلى مجموع من ثلاث مرات, التعادل ليس فوزا !' },
      { name: 'الرقم التقريبي 📊', value: '> في كل جولة سوف تحصل على رقم عشوائي, و انت عليك ان تحصل على نفس الرقم او اقل منه, الذي يحصل عليه يفوز, في حال الحصول على اعلى تعتبر خاسر, جولة واحدة لكل تحدي ! انهاء الجولة يعني انهاء التحدي, التعادل ليس فوزا !' },
    );
  const sent = await message.reply({ embeds: [embed], components: gameRows(g), allowedMentions: { repliedUser: false } }).catch(() => null);
  if (!sent) { delete db.games[id]; return message.reply('تعذر إرسال التحدي.'); }
  g.message = sent.id;
  await save();
}
function legacyPlayerTag(id) {
  const user = client.users.cache.get(String(id));
  return user ? user.tag : String(id);
}
function diceRollList(g, id) {
  const value = g.rolls && g.rolls[id];
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [Number(value)];
}
function diceTotal(g, id) {
  return diceRollList(g, id).reduce((sum, value) => sum + Number(value || 0), 0);
}
function dicePlayerText(g, id) {
  const rolls = diceRollList(g, id);
  if (!rolls.length) return '> بانتظار اللعب';
  return '> ' + rolls.join(' + ') + (rolls.length === 3 ? ' = **' + diceTotal(g, id) + '**' : '  •  (' + rolls.length + '/3)');
}
function legacyGameEmbed(g) {
  return new EmbedBuilder()
    .setTitle('بيانات التحدي — 3 رميات لكل لاعب')
    .addFields(
      { name: legacyPlayerTag(g.p1), value: dicePlayerText(g, g.p1) },
      { name: legacyPlayerTag(g.p2), value: dicePlayerText(g, g.p2) },
    );
}
function legacyCloseEmbed(g) {
  const max = g.closeMax || '—';
  const players = [g.p1, g.p2].map(id => {
    const nums = (g.closeNumbers && g.closeNumbers[id]) || [];
    const total = (g.closeSums && g.closeSums[id]) || 0;
    const done = g.closeDone && g.closeDone[id];
    const status = done ? 'Done' : g.closeTurn === id ? '**Playing..**' : 'Waiting..';
    const expression = nums.length ? nums.join(' + ') + ' = **' + total + '**' : status;
    return { name: legacyPlayerTag(id), value: '> ' + expression };
  });
  return new EmbedBuilder()
    .setColor(0x000000)
    .setTitle('بيانات التحدي')
    .setDescription('اقصى رقم : **' + max + '**')
    .addFields(players)
    .setFooter({ text: 'الرقم التقريبي • المبلغ: ' + fmt(g.bet) });
}
function gameRows(g) {
  if (g.status === 'pending') return [new ActionRowBuilder().addComponents(
    btn('g:dice:' + g.id, 'النرد 🎲', ButtonStyle.Primary),
    btn('g:close:' + g.id, 'الرقم التقريبي 📊', ButtonStyle.Primary),
    btn('g:cancel:' + g.id, 'إلغاء', ButtonStyle.Danger),
  )];
  if (g.status === 'awaiting_accept') return [new ActionRowBuilder().addComponents(
    btn('g:accept:' + g.id, 'قبول', ButtonStyle.Success),
    btn('g:decline:' + g.id, 'رفض', ButtonStyle.Danger),
  )];
  if (g.status === 'playing' && g.mode === 'close') return [new ActionRowBuilder().addComponents(
    btn('g:low:' + g.id, g.closeRanges.low[0] + ' - ' + g.closeRanges.low[1], ButtonStyle.Primary),
    btn('g:finish:' + g.id, 'finish', ButtonStyle.Success),
    btn('g:high:' + g.id, g.closeRanges.high[0] + ' - ' + g.closeRanges.high[1], ButtonStyle.Primary),
  )];
  if (g.status === 'playing' && g.mode === 'dice') return [new ActionRowBuilder().addComponents(
    btn('g:roll:' + g.id, 'العب نردك', ButtonStyle.Primary),
  )];
  return [];
}
async function editGame(g, title, description, components) {
  const ch = await client.channels.fetch(g.channel).catch(() => null);
  if (!ch || !ch.isTextBased()) return;
  const msg = await ch.messages.fetch(g.message).catch(() => null);
  const embed = g.mode === 'close' ? legacyCloseEmbed(g) : legacyGameEmbed(g);
  if (msg) await msg.edit({ content: description || null, embeds: [embed], components: components || [] }).catch(() => {});
}
async function settle(g, winner, result) {
  if (!g || g.status !== 'playing') return;
  g.status = 'finished';
  if (winner) {
    const loser = winner === g.p1 ? g.p2 : g.p1;
    const fee = Math.floor(g.bet * CFG.fee);
    const payout = g.bet * 2 - fee;
    const winnerScore = g.mode === 'close'
      ? Number((g.closeSums && g.closeSums[winner]) || 0)
      : diceTotal(g, winner);
    const loserScore = g.mode === 'close'
      ? Number((g.closeSums && g.closeSums[loser]) || 0)
      : diceTotal(g, loser);
    account(winner).coins += payout;
    if (g.mode === 'dice') {
      g.result = '**<@' + winner + '>** فائززززز !!! ب مجموع **' + winnerScore + '** الي يفوز فيه نقطة!\n\n' +
        '**<@' + loser + '>** خاسر ب مجموع **' + loserScore + '** نقطة!\n> اللعبة: **النرد**, المبلغ: **' + fmt(g.bet) + '**';
    } else {
      g.result = '<@' + winner + '>  فائززززز !!! ب مجموع ' + winnerScore + ' نقطة!\n\n' +
        '<@' + loser + '> خاسر ب مجموع **' + loserScore + '** نقطة!\nاللعبة: **الرقم التقريبي**, المبلغ: **' + fmt(g.bet) + '**';
    }
  } else {
    account(g.p1).coins += g.bet;
    account(g.p2).coins += g.bet;
    g.result = result + '\nتعادل؛ أُعيد الرهان لكل لاعب.';
  }
  await save();
  await editGame(g, 'انتهت اللعبة', g.result, []);
}
async function refund(g, reason) {
  if (!g || !g.escrow || !['selecting', 'playing'].includes(g.status)) return;
  g.status = 'cancelled';
  const returned = g.mode === 'close' ? Math.floor(g.bet / 2) : g.bet;
  account(g.p1).coins += returned;
  account(g.p2).coins += returned;
  g.result = g.mode === 'close'
    ? reason + '\nتم خصم نصف الرهان من كل لاعب بسبب عدم إكمال التحدي.'
    : reason;
  await save();
  await editGame(g, 'تم إلغاء التحدي', g.result, []);
}
async function sweep() {
  const now = Date.now();
  for (const g of Object.values(db.games)) {
    if (!g || !g.expires || g.expires > now) continue;
    if (g.status === 'pending' || g.status === 'awaiting_accept') {
      g.status = 'expired';
      await editGame(g, 'انتهت صلاحية التحدي', 'لم يتم قبول التحدي خلال الوقت المحدد.', []);
    } else if (g.status === 'selecting' || g.status === 'playing') {
      await refund(g, 'انتهى الوقت؛ أُعيد الرهان للطرفين.');
    }
  }
  await save();
}
function initializeApproximateGame(g) {
  const firstNumbers = [];
  for (let n = 19; n <= 79; n += 3) firstNumbers.push(n);
  const secondNumbers = [2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 6, 6, 7, 7, 7];
  const thirdNumbers = [4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14];
  const fourthNumbers = [5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 12, 12, 13, 14, 15, 15, 16, 16, 17, 18, 18, 19];
  const fifthNumbers = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 22, 23, 24, 25, 26, 27];
  const index = crypto.randomInt(firstNumbers.length);
  g.closeMax = firstNumbers[index];
  g.closeRanges = {
    low: [secondNumbers[index], thirdNumbers[index]],
    high: [fourthNumbers[index], fifthNumbers[index]],
  };
  g.closeNumbers = { [g.p1]: [], [g.p2]: [] };
  g.closeSums = { [g.p1]: 0, [g.p2]: 0 };
  g.closeDone = { [g.p1]: false, [g.p2]: false };
  g.closeOrder = crypto.randomInt(2) === 0 ? [g.p1, g.p2] : [g.p2, g.p1];
  g.closeTurn = g.closeOrder[0];
}
async function finishApproximateTurn(g, reason) {
  g.closeDone[g.closeTurn] = true;
  const next = g.closeOrder.find(id => !g.closeDone[id]);
  if (next) {
    g.closeTurn = next;
    g.expires = Date.now() + 90000;
    await save();
    await editGame(g, 'دور اللاعب التالي', '<@' + next + '>\n اصبح دورك !', gameRows(g));
    return;
  }
  const a = g.closeSums[g.p1];
  const b = g.closeSums[g.p2];
  const aSafe = a <= g.closeMax;
  const bSafe = b <= g.closeMax;
  let winner = null;
  if (aSafe !== bSafe) winner = aSafe ? g.p1 : g.p2;
  else if (aSafe && bSafe && a !== b) winner = a > b ? g.p1 : g.p2;
  const result = 'اقصى رقم: **' + g.closeMax + '**\n' +
    '<@' + g.p1 + '> : ' + (g.closeNumbers[g.p1].join(' + ') || '—') + ' = **' + a + '**\n' +
    '<@' + g.p2 + '> : ' + (g.closeNumbers[g.p2].join(' + ') || '—') + ' = **' + b + '**' +
    (reason ? '\n' + reason : '');
  await settle(g, winner, result);
}
async function gameButton(i, parts) {
  const action = parts[1];
  const id = parts[parts.length - 1];
  const g = db.games[id];
  if (!g) return ephemeral(i, 'هذا التحدي غير موجود أو انتهى.');
  const uid = i.user.id;
  if (action === 'cancel' || action === 'dice' || action === 'close') {
    if (g.status !== 'pending') return ephemeral(i, 'اختيار اللعبة لم يعد متاحاً.');
    if (uid !== g.p1) return ephemeral(i, 'صاحب التحدي فقط يستطيع اختيار اللعبة أو إلغاءها.');
    if (action === 'cancel') {
      g.status = 'cancelled';
      await save();
      return i.update({
        content: '> تم إلغاء التحدي بنجاح ' + i.user.toString() + ' !\n> || <@' + g.p1 + '> | <@' + g.p2 + '> ||',
        embeds: [],
        components: [],
      });
    }
    g.mode = action;
    g.status = 'awaiting_accept';
    g.expires = Date.now() + CFG.inviteMs;
    const details = action === 'dice'
      ? { name: '🎲 لعبة النرد:', value: '> يفوز الذي يحصل على أعلى مجموع من ثلاث مرات, التعادل ليس فوزا !' }
      : { name: '📊 الرقم التقريبي:', value: '> في كل جولة سوف تحصل على رقم عشوائي, و انت عليك ان تحصل على نفس الرقم او اقل منه, الذي يحصل عليه يفوز, في حال الحصول على اعلى تعتبر خاسر, جولة واحدة لكل تحدي ! انهاء الجولة يعني انهاء التحدي, التعادل ليس فوزا !' };
    const waiting = new EmbedBuilder()
      .setColor(0x000000)
      .setDescription('> تنبيه: في حال عدم استجابة الطرفين و عدم اكمال التحدي يؤدي الى خصم نصف المبلغ من الطرفين.\n> عند التعادل لا يتم سحب اي مبلغ من الطرفين.')
      .addFields(details, { name: 'المبلغ:', value: fmt(g.bet) });
    await save();
    await i.deferReply({ ephemeral: true });
    await i.message.edit({
      content: '> بانتظار رد من <@' + g.p2 + '> ...',
      embeds: [waiting],
      components: gameRows(g),
    });
    return i.editReply({
      content: '> لقد تم اختيار اللعبة هي : `' + (action === 'dice' ? 'نرد' : 'الرقم التقريبي') + '` !!',
    });
  }
  if (action === 'accept' || action === 'decline') {
    if (g.status !== 'awaiting_accept') return ephemeral(i, 'تم التعامل مع التحدي مسبقاً.');
    if (uid !== g.p2) return ephemeral(i, 'هذا التحدي موجّه للاعب الآخر فقط.');
    if (action === 'decline') {
      g.status = 'declined';
      await save();
      return i.update({
        content: '> تم رفض التحدي بنجاح ' + i.user.toString() + ' !\n> || <@' + g.p1 + '> | <@' + g.p2 + '> ||',
        embeds: [],
        components: [],
      });
    }
    if (active(g.p1, g.id) || active(g.p2, g.id)) return ephemeral(i, 'أحد اللاعبين دخل تحدياً آخر.');
    if (account(g.p1).coins < g.bet || account(g.p2).coins < g.bet) return ephemeral(i, 'رصيد أحد اللاعبين لم يعد كافياً.');
    account(g.p1).coins -= g.bet;
    account(g.p2).coins -= g.bet;
    g.escrow = true;
    g.status = 'playing';
    g.expires = Date.now() + CFG.gameMs;
    g.rolls = { [g.p1]: [], [g.p2]: [] };
    if (g.mode === 'close') initializeApproximateGame(g);
    else g.turn = crypto.randomInt(2) === 0 ? g.p1 : g.p2;
    await save();
    await i.deferReply({ ephemeral: true });
    await i.editReply({
      content: '> لقد تم القبول اللعبة هي : `' + (g.mode === 'dice' ? 'نرد' : 'الرقم التقريبي') + '` ، اللعب مع : <@' + g.p1 + '> !!',
    });
    // Legacy behavior: confirm privately, then publish the first turn after 2.5 seconds.
    setTimeout(() => {
      editGame(
        g,
        'بدأ التحدي',
        '<@' + (g.mode === 'close' ? g.closeTurn : g.turn) + '>\\n اصبح دورك',
        gameRows(g),
      ).catch(err => console.error('Could not start accepted game:', err));
    }, 2500);
    return;
  }
  if (['low', 'high', 'finish'].includes(action)) {
    if (g.status !== 'playing' || g.mode !== 'close') return ephemeral(i, 'لعبة الرقم التقريبي غير نشطة.');
    if (uid !== g.p1 && uid !== g.p2) return ephemeral(i, 'أنت لست أحد لاعبي هذا التحدي.');
    if (g.closeTurn !== uid) return ephemeral(i, 'انه ليس دورك !');
    if (g.closeDone[uid]) return ephemeral(i, 'لقد أنهيت دورك بالفعل.');
    if (action === 'finish') {
      await i.deferUpdate();
      await finishApproximateTurn(g);
      return;
    }
    const range = action === 'low' ? g.closeRanges.low : g.closeRanges.high;
    const number = crypto.randomInt(range[0], range[1] + 1);
    g.closeNumbers[uid].push(number);
    g.closeSums[uid] += number;
    g.expires = Date.now() + 90000;
    await i.deferUpdate();
    const total = g.closeSums[uid];
    if (total >= g.closeMax) {
      await i.followUp({
        content: 'لقد حصلت على **' + number + '**\nاصبح مجموعك **' + total + '**\n' +
          (total === g.closeMax ? 'تهانينا، حصلت على الرقم المطلوب وتم إنهاء دورك.' : 'يا للأسف، لقد تخطيت الرقم المطلوب وتم إنهاء دورك.'),
        ephemeral: true,
      }).catch(() => {});
      await finishApproximateTurn(g, total === g.closeMax ? 'وصل إلى الحد الأقصى.' : 'تجاوز الحد الأقصى.');
      return;
    }
    await save();
    await editGame(g, 'لعبة الرقم التقريبي', '<@' + uid + '>\n اصبح مجموعك **' + total + '** — أكمل أو اضغط finish لإنهاء دورك.', gameRows(g));
    await i.followUp({
      content: 'لقد حصلت على **' + number + '**\nاصبح مجموعك **' + total + '**\nانتبه ألا يصبح مجموعك أعلى من الرقم المطلوب؛ يمكنك إنهاء دورك بالضغط على finish.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }
  if (action === 'roll') {
    if (g.status !== 'playing' || g.mode !== 'dice') return ephemeral(i, 'لعبة النرد غير نشطة.');
    if (uid !== g.p1 && uid !== g.p2) return ephemeral(i, 'أنت لست أحد لاعبي التحدي.');
    if (!g.rolls || typeof g.rolls !== 'object') g.rolls = { [g.p1]: [], [g.p2]: [] };
    if (!Array.isArray(g.rolls[g.p1])) g.rolls[g.p1] = g.rolls[g.p1] === undefined ? [] : [Number(g.rolls[g.p1])];
    if (!Array.isArray(g.rolls[g.p2])) g.rolls[g.p2] = g.rolls[g.p2] === undefined ? [] : [Number(g.rolls[g.p2])];
    if (g.rolls[uid].length >= 3) return ephemeral(i, 'أكملت رمياتك الثلاث بالفعل.');
    if (g.turn && g.turn !== uid) return ephemeral(i, 'ليس دورك الآن.');
    g.rolls[uid].push(crypto.randomInt(1, 7));
    const bothFinished = g.rolls[g.p1].length === 3 && g.rolls[g.p2].length === 3;
    if (!bothFinished) {
      const other = uid === g.p1 ? g.p2 : g.p1;
      const nextPlayer = g.rolls[other].length < 3 ? other : uid;
      g.turn = nextPlayer;
      g.expires = Date.now() + CFG.gameMs;
      await save();
      await i.deferUpdate();
      await editGame(g, 'لعبة النرد — 3 رميات', '<@' + nextPlayer + '>\\n اصبح دورك', gameRows(g));
      return;
    }
    const a = diceTotal(g, g.p1), b = diceTotal(g, g.p2);
    const winner = a === b ? null : (a > b ? g.p1 : g.p2);
    const result =
      '<@' + g.p1 + '> رمياته: **' + diceRollList(g, g.p1).join(' + ') + ' = ' + a + '**\\n' +
      '<@' + g.p2 + '> رمياته: **' + diceRollList(g, g.p2).join(' + ') + ' = ' + b + '**';
    await i.deferUpdate();
    await settle(g, winner, result);
  }
}
function withdrawPanel() {
  return {
    embeds: [makeEmbed('💳 سحب الرصيد', 'اضغط لطلب سحب كويناتك.\nالحد الأدنى: **' + fmt(CFG.minWithdraw) + '**\nالحد الأعلى: **' + fmt(CFG.maxWithdraw) + '**\nالطلبات تخضع لمراجعة الإدارة.')],
    components: [new ActionRowBuilder().addComponents(btn('w:open', 'طلب سحب', ButtonStyle.Success))],
  };
}
async function withdrawalModal(i) {
  const n = amountOf(i.fields.getTextInputValue('amount'));
  if (!n || n < CFG.minWithdraw || n > CFG.maxWithdraw) return ephemeral(i, 'المبلغ يجب أن يكون بين ' + fmt(CFG.minWithdraw) + ' و ' + fmt(CFG.maxWithdraw) + '.');
  const wallet = account(i.user.id);
  if (wallet.coins < n) return ephemeral(i, 'رصيدك غير كافٍ. رصيدك: ' + fmt(wallet.coins));
  const ch = await client.channels.fetch(CFG.requestsRoom).catch(() => null);
  if (!ch || !ch.isTextBased()) return ephemeral(i, 'روم طلبات السحب غير متاح.');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  wallet.coins -= n;
  db.withdrawals[id] = { id, user: i.user.id, amount: n, status: 'pending', created: Date.now(), message: null };
  await save();
  const msg = await ch.send({
    embeds: [makeEmbed('طلب سحب جديد', 'العضو: <@' + i.user.id + '>\nالمبلغ: **' + fmt(n) + '**\nالرصيد بعد الحجز: **' + fmt(wallet.coins) + '**\nالحالة: قيد المراجعة')],
    components: [new ActionRowBuilder().addComponents(btn('w:approve:' + id, 'قبول', ButtonStyle.Success), btn('w:reject:' + id, 'رفض وإرجاع الرصيد', ButtonStyle.Danger))],
  }).catch(() => null);
  if (!msg) {
    wallet.coins += n;
    delete db.withdrawals[id];
    await save();
    return ephemeral(i, 'تعذر إرسال الطلب؛ أُعيد المبلغ إلى رصيدك.');
  }
  db.withdrawals[id].message = msg.id;
  await save();
  return ephemeral(i, 'تم إرسال طلبك للإدارة وحجز المبلغ مؤقتاً.');
}
async function withdrawalButton(i, parts) {
  if (parts[1] === 'open') {
    const modal = new ModalBuilder().setCustomId('w:modal').setTitle('طلب سحب');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('amount').setLabel('المبلغ (مثال: 4m أو 4000000)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(24),
    ));
    return i.showModal(modal);
  }
  if (parts[1] === 'rate') {
    const req = db.withdrawals[parts[2]];
    const rating = Number(parts[3]);
    if (!req || req.status !== 'approved' || req.user !== i.user.id) {
      return ephemeral(i, 'هذا التقييم غير متاح لهذا الحساب أو لطلب السحب.');
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return ephemeral(i, 'التقييم غير صالح.');
    if (req.rating) return ephemeral(i, 'تم تسجيل تقييمك لهذا الطلب مسبقاً، شكراً لك! ❤️');
    req.rating = rating;
    req.ratedAt = Date.now();
    await save();
    const stars = '⭐'.repeat(rating);
    const ratedEmbed = EmbedBuilder.from(i.message.embeds[0])
      .setDescription(
        (i.message.embeds[0].description || '') +
        '\n\n✅ **تم استلام تقييمك: ' + stars + ' (' + rating + '/5)**\nشكراً لمشاركتك رأيك، نسعد بخدمتك دائماً. 💚'
      );
    return i.update({ embeds: [ratedEmbed], components: [] });
  }
  const req = db.withdrawals[parts[2]];
  if (!req || req.status !== 'pending') return ephemeral(i, 'تمت معالجة هذا الطلب مسبقاً أو أنه غير موجود.');
  if (!admin(i.user.id)) return ephemeral(i, 'قبول ورفض الطلبات للأونر والإدارة فقط.');
  if (parts[1] === 'reject') {
    account(req.user).coins += req.amount;
    req.status = 'rejected';
  } else if (parts[1] === 'approve') {
    req.status = 'approved';
  } else return;
  req.reviewedBy = i.user.id;
  req.reviewedAt = Date.now();
  await save();
  const text = 'العضو: <@' + req.user + '>\nالمبلغ: **' + fmt(req.amount) + '**\nالقرار: ' +
    (req.status === 'approved' ? 'موافقة — التسليم الخارجي يدوي من الإدارة.' : 'رفض وإرجاع الرصيد.') +
    '\nبواسطة: ' + i.user.toString();
  await i.update({ embeds: [makeEmbed('تحديث طلب السحب', text)], components: [] });
  const user = await client.users.fetch(req.user).catch(() => null);
  if (user && req.status === 'approved') {
    const dmEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ تمت الموافقة على طلب السحب')
      .setDescription(
        'عزيزي العضو، نود إعلامك بأنه تمت الموافقة على طلب السحب الخاص بك بنجاح.\n\n' +
        '💰 **المبلغ المعتمد:** ' + fmt(req.amount) + ' كوين\n' +
        '📦 **حالة التسليم:** التسليم — إن وجد — يتم يدوياً من قِبل الإدارة.\n\n' +
        '⭐ نرجو منك تقييم تجربتك مع خدمة السحب بالضغط على أحد الخيارات أدناه.'
      )
      .setFooter({ text: 'Batoot Casino • خدمة السحب' })
      .setTimestamp();
    const ratingRow = new ActionRowBuilder().addComponents(
      btn('w:rate:' + req.id + ':1', '⭐ 1', ButtonStyle.Secondary),
      btn('w:rate:' + req.id + ':2', '⭐ 2', ButtonStyle.Secondary),
      btn('w:rate:' + req.id + ':3', '⭐ 3', ButtonStyle.Secondary),
      btn('w:rate:' + req.id + ':4', '⭐ 4', ButtonStyle.Secondary),
      btn('w:rate:' + req.id + ':5', '⭐ 5', ButtonStyle.Success),
    );
    await user.send({ embeds: [dmEmbed], components: [ratingRow] }).catch(err => {
      console.warn('Could not DM withdrawal approval:', err.message);
    });
  } else if (user) {
    const dmEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('❌ تم رفض طلب السحب')
      .setDescription(
        'نأسف لإبلاغك بأنه تم رفض طلب السحب الخاص بك.\n' +
        '💰 **المبلغ المُعاد إلى رصيدك:** ' + fmt(req.amount) + ' كوين\n' +
        'تمت إعادة المبلغ إلى محفظتك داخل البوت.'
      )
      .setFooter({ text: 'Batoot Casino • خدمة السحب' })
      .setTimestamp();
    await user.send({ embeds: [dmEmbed] }).catch(err => {
      console.warn('Could not DM withdrawal rejection:', err.message);
    });
  }
}

client.on('guildMemberAdd', member => {
  recordMember(member);
  save().catch(error => console.error('Could not save new member:', error));
});
client.on('guildMemberRemove', member => {
  const data = account(member.id);
  data.username = member.user.username || data.username || String(member.id);
  data.tag = member.user.tag || data.tag || data.username;
  data.guildId = member.guild.id;
  data.isMember = false;
  data.leftAt = Date.now();
  save().catch(error => console.error('Could not save departed member:', error));
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  if (CFG.guild && message.guild.id !== CFG.guild) return;
  const text = message.content.trim();
  if (!text) return;
  const args = text.split(/\s+/);
  const cmd = args[0].toLowerCase();
  try {
    if (['تحويل', 'transfer', 'pay'].includes(cmd)) return createMemberTransfer(message, args);
    if (cmd === 'شحن') {
      const parsed = legacyAdminAmount(args[1]);
      if (parsed.error) return message.reply('❎ **صيغة الشحن غير صحيحة**\nمثال: `شحن 10m`');
      return message.channel.send('#credit ' + CFG.owner + ' ' + String(parsed.value));
    }
    if (cmd === 'withdraw' && message.channel.id === CFG.withdrawRoom) return message.channel.send(withdrawPanel());
    if (['فلوس', 'money', 'رصيدي', 'balance'].includes(cmd)) return balance(message, message.mentions.users.first() || message.author);
    if (['يومي', 'daily'].includes(cmd)) return claimDaily(message);
    if (['عمل', 'work'].includes(cmd)) return workForCoins(message);
    if (['ملفي', 'profile', 'بروفايل'].includes(cmd)) return showProfile(message, message.mentions.users.first() || message.author);
    if (['تحويلاتي', 'history'].includes(cmd)) return showTransferHistory(message, message.author);
    if (['سجل-اداري', 'adminlog'].includes(cmd)) return showAdminLog(message);
    if (['توب', 'top'].includes(cmd)) {
      await message.guild.members.fetch().catch(() => {});
      const ranked = Object.entries(db.users)
        .filter(([id]) => message.guild.members.cache.has(id))
        .sort((a, b) => b[1].coins - a[1].coins)
        .slice(0, 10);
      const lines = ranked.map(([id, data], i) =>
        '**#' + (i + 1) + '. ' + (client.users.cache.get(id) || message.guild.members.cache.get(id).user).toString() + '** - `' + fmt(data.coins) + '`'
      );
      const embed = new EmbedBuilder()
        .setAuthor({ name: 'توب رصيد' })
        .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
        .setColor(0x3498db)
        .setDescription(lines.length ? lines.join('\n') : 'لا توجد أرصدة مسجلة.')
        .setFooter({ text: message.guild.name })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }
    if (cmd === 'add') return adminBalance(message, args, true);
    if (['rmv', 'remove'].includes(cmd)) return adminBalance(message, args, false);
    if (['تحدي', 'challenge'].includes(cmd)) return challenge(message, args);
    if (['مساعدة', 'help'].includes(cmd)) {
      return message.reply({ embeds: [makeEmbed('أوامر Batoot Casino',
        'فلوس — عرض الرصيد\nيومي — استلام مكافأة كل 24 ساعة\nعمل — العمل مقابل كوينز كل ساعة\nملفي — عرض ملفك وإحصائياتك\nتحويل @عضو مبلغ — طلب تحويل رصيد إلى عضو بعد تأكيدك، مثال: تحويل @عضو 250k\nتحويلاتي — آخر 10 تحويلات لك\nتوب — أعلى 10 أرصدة\nتحدي @عضو مبلغ — تحدٍ في رومات الألعاب\nwithdraw — لوحة السحب في روم السحب\nشحن مبلغ — إرسال أمر #credit (للأونر فقط)، مثال: شحن 10m\nadd @عضو مبلغ — إضافة رصيد (للأونر والإدارة المعتمدة)\nrmv / remove @عضو مبلغ — حذف رصيد (للأونر والإدارة المعتمدة)\nسجل-اداري — آخر 10 عمليات إضافة وخصم (للإدارة)')] });
    }
  } catch (error) {
    console.error('messageCreate:', error);
    await message.reply('حدث خطأ غير متوقع. حاول مرة أخرى أو تواصل مع الإدارة.').catch(() => {});
  }
});

client.on('interactionCreate', async i => {
  try {
    if (i.isModalSubmit() && i.customId === 'w:modal') {
      await i.deferReply({ ephemeral: true });
      return withdrawalModal(i);
    }
    if (!i.isButton()) return;
    const parts = i.customId.split(':');
    if (parts[0] === 't') return transferButton(i, parts);
    if (parts[0] === 'g') return gameButton(i, parts);
    if (parts[0] === 'w') return withdrawalButton(i, parts);
  } catch (error) {
    console.error('interactionCreate:', error);
    await ephemeral(i, 'حدث خطأ أثناء تنفيذ العملية. تواصل مع الإدارة إذا لاحظت تغييراً في رصيدك.');
  }
});

client.once('ready', async () => {
  console.log('Batoot Casino ready: ' + client.user.tag);
  const guild = await client.guilds.fetch(CFG.guild).catch(() => null);
  if (guild) {
    const members = await guild.members.fetch().catch(error => {
      console.error('Could not fetch server members; check Server Members Intent:', error);
      return null;
    });
    if (members) {
      for (const data of Object.values(db.users)) if (data && typeof data === 'object') data.isMember = false;
      for (const member of members.values()) recordMember(member);
      console.log('Member records refreshed:', members.size);
    }
  }
  await save();
  await sweep().catch(console.error);
  setInterval(() => sweep().catch(console.error), 30000);
});
client.on('error', error => console.error('Discord client error:', error));
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}
(async () => {
  await loadGitHubData();
  await client.login(process.env.DISCORD_TOKEN);
})().catch(error => {
  console.error('Startup storage error:', error);
  client.login(process.env.DISCORD_TOKEN);
});
