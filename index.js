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
const { handleGoldenCatalog } = require('./golden-catalog');
const { handleGoldenSocial } = require('./golden-social');
const { handleGoldenUtilities } = require('./golden-utilities');
const { handleGoldenExtras } = require('./golden-extras');
const { rpsWinner, xoWinner, xoIsDraw } = require('./golden-game-rules');

const CFG = {
  owners: (process.env.OWNER_IDS || '1483368871032520704,1244772188662403176,1071915968521056377').split(',').map(x => x.trim()).filter(Boolean),
  owner: process.env.OWNER_ID || '1483368871032520704',
  creditRecipient: process.env.CREDIT_RECIPIENT_ID || '1483368871032520704',
  guild: process.env.GUILD_ID || '1501507950492127234',
  gameRooms: (process.env.GAME_CHANNEL_IDS || '1575119362363490455,1575119427349913630,1575119396232232990').split(',').map(x => x.trim()).filter(Boolean),
  rentalRoom: process.env.RENTAL_ROOM_ID || '1575329123830730845',
  tournamentRoom: process.env.TOURNAMENT_ROOM_ID || '1575330966472360016',
  rentalRoom: process.env.RENTAL_ROOM_ID || '1575329123830730845',
  rentPrice: Number(process.env.PRIVATE_ROOM_PRICE || 999999),
  rentDurationMs: 12 * 60 * 60 * 1000,
  challengeRoom: process.env.CHALLENGE_ROOM_ID || '1575332710283747519',
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
    db.creditReviews = parsed.creditReviews || {};
    db.transfers = parsed.transfers || {};
    db.linkRequests = parsed.linkRequests || {};
    db.linkedAccounts = parsed.linkedAccounts || {};
    db.linkCooldowns = parsed.linkCooldowns || {};
    db.linkedWithdrawals = parsed.linkedWithdrawals || {};
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
    if (error.statusCode === 409 || error.statusCode === 422) {
      githubDataBlocked = true;
      console.error('GitHub backup conflict: remote data was not overwritten. Backups paused until reviewed.', error);
      return;
    }
    throw error;
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
  ? { users: old.users || importOldUsers(), games: old.games || {}, withdrawals: old.withdrawals || {}, processedTransfers: old.processedTransfers || {}, creditReviews: old.creditReviews || {}, transfers: old.transfers || {}, linkRequests: old.linkRequests || {}, linkedAccounts: old.linkedAccounts || {}, linkCooldowns: old.linkCooldowns || {}, linkedWithdrawals: old.linkedWithdrawals || {}, tournaments: old.tournaments || {}, privateRooms: old.privateRooms || {}, blackjack: old.blackjack || {}, settings: old.settings || {}, adminLogs: old.adminLogs || [] }
  : { users: importOldUsers(), games: {}, withdrawals: {}, processedTransfers: {}, creditReviews: {}, transfers: {}, linkRequests: {}, linkedAccounts: {}, linkCooldowns: {}, linkedWithdrawals: {}, tournaments: {}, privateRooms: {}, blackjack: {}, settings: {}, adminLogs: [] };

let writeChain = Promise.resolve();

// Serialize mutations that touch the same wallet or request. This prevents
// two rapid Discord interactions from spending or settling the same balance twice.
const mutationLocks = new Map();
async function withLock(key, task) {
  const lockKey = String(key);
  const previous = mutationLocks.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  mutationLocks.set(lockKey, current);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (mutationLocks.get(lockKey) === current) mutationLocks.delete(lockKey);
  }
}
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
  if (!db.users[key]) db.users[key] = { id: key, coins: 0, friends: [], blocked: [] };
  const n = Number(db.users[key].coins);
  db.users[key].coins = Number.isSafeInteger(n) && n >= 0 ? n : 0;
  db.users[key].id = key;
  if (!Array.isArray(db.users[key].friends)) db.users[key].friends = [];
  if (!Array.isArray(db.users[key].blocked)) db.users[key].blocked = [];
  return db.users[key];
}
function canAddCoins(data, amount) {
  return Number.isSafeInteger(amount) && amount > 0 &&
    Number.isSafeInteger(data.coins) && data.coins >= 0 &&
    data.coins <= Number.MAX_SAFE_INTEGER - amount;
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
const admin = id => CFG.owners.includes(String(id)) || CFG.admins.includes(String(id));
function active(id, excludeId) {
  return Object.values(db.games).some(g => g && g.id !== excludeId && ['pending', 'awaiting_accept', 'selecting', 'playing'].includes(g.status) && (g.p1 === id || g.p2 === id));
}
const makeEmbed = (title, description) => new EmbedBuilder().setColor(0x30343b).setTitle(title).setDescription(description || '').setFooter({ text: 'Batoot Casino' }).setTimestamp();
const greenEmbed = (title, description) => new EmbedBuilder()
  .setColor(0x22c55e)
  .setTitle(title)
  .setDescription(description || '')
  .setFooter({ text: 'BAToot CASINO • SECURE WALLET' })
  .setTimestamp();
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
    owners: [CFG.creditRecipient],
  }],
});

async function queueCreditReview(memberId, amount, guild, data, reason) {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const review = db.creditReviews[id] = {
    id, memberId, amount, status: 'pending', reason,
    guildId: (guild && guild.id) || CFG.guild,
    channelId: (data && data.channel && data.channel.id) || null,
    sourceMessageId: (data && data.message && data.message.id) || null,
    createdAt: Date.now(),
  };
  await save();
  const channel = await client.channels.fetch(CFG.requestsRoom).catch(() => null);
  if (channel && channel.isTextBased()) {
    const msg = await channel.send({
      embeds: [makeEmbed('مراجعة شحن مطلوبة', 'تعذر التحقق آلياً من رقم عملية فريد أو من إمكانية إضافة المبلغ بأمان.\\n\\nالعضو: <@' + memberId + '>\\nالمبلغ: **' + fmt(amount) + '**\\nالسبب: ' + reason + '\\nرقم المراجعة: `' + id + '`')],
      components: [new ActionRowBuilder().addComponents(
        btn('c:approve:' + id, 'اعتماد الشحن', ButtonStyle.Success),
        btn('c:reject:' + id, 'رفض', ButtonStyle.Danger),
      )],
    }).catch(err => {
      console.error('Could not publish credit review:', err);
      return null;
    });
    if (msg) {
      review.message = msg.id;
      review.messageChannel = channel.id;
      await save();
    }
  }
  return review;
}
async function recoverCreditReviews() {
  const channel = await client.channels.fetch(CFG.requestsRoom).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('Credit review recovery skipped: requests channel is unavailable.');
    return;
  }
  for (const review of Object.values(db.creditReviews)) {
    if (!review || review.status !== 'pending') continue;
    if (review.message) {
      const existing = await channel.messages.fetch(review.message).catch(() => null);
      if (existing) continue;
    }
    const msg = await channel.send({
      embeds: [makeEmbed('مراجعة شحن — استعادة تلقائية', 'العضو: <@' + review.memberId + '>\\nالمبلغ: **' + fmt(review.amount) + '**\\nالسبب: ' + review.reason + '\\nرقم المراجعة: `' + review.id + '`')],
      components: [new ActionRowBuilder().addComponents(
        btn('c:approve:' + review.id, 'اعتماد الشحن', ButtonStyle.Success),
        btn('c:reject:' + review.id, 'رفض', ButtonStyle.Danger),
      )],
    }).catch(error => {
      console.error('Could not restore credit review ' + review.id + ':', error);
      return null;
    });
    if (msg) {
      review.message = msg.id;
      review.messageChannel = channel.id;
      await save();
    }
  }
}
async function creditReviewButton(i, parts) {
  if (!admin(i.user.id)) return ephemeral(i, 'اعتماد عمليات الشحن للإدارة فقط.');
  const review = db.creditReviews[parts[2]];
  if (!review || review.status !== 'pending') return ephemeral(i, 'تمت معالجة هذه المراجعة مسبقاً أو أنها غير موجودة.');
  if (parts[1] === 'approve') {
    const wallet = account(review.memberId);
    if (!canAddCoins(wallet, review.amount)) return ephemeral(i, 'لا يمكن إضافة هذا المبلغ بأمان بسبب حد الرصيد. راجع الحساب يدوياً.');
    wallet.coins += review.amount;
    review.status = 'approved';
    review.balanceAfter = wallet.coins;
  } else if (parts[1] === 'reject') {
    review.status = 'rejected';
  } else return;
  review.reviewedBy = i.user.id;
  review.reviewedAt = Date.now();
  await save();
  return i.update({
    embeds: [makeEmbed(review.status === 'approved' ? 'تم اعتماد الشحن' : 'تم رفض الشحن',
      'العضو: <@' + review.memberId + '>\nالمبلغ: **' + fmt(review.amount) + '**\nالحالة: ' + (review.status === 'approved' ? 'تمت الإضافة إلى الرصيد' : 'مرفوض') + '\nبواسطة: <@' + i.user.id + '>')],
    components: [],
  });
}
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
    if (!transferId) {
      console.warn('ProBot transfer has no documented unique transaction ID; queued for manual review instead of auto-crediting.');
      await queueCreditReview(memberId, credited, guild, data, 'لم توفر مكتبة ProBot رقم عملية فريداً يمكن استخدامه لمنع تكرار الشحن.');
      return;
    }
    if (db.processedTransfers[transferId]) {
      console.log('Duplicate ProBot transfer ignored:', transferId);
      return;
    }

    const userAccount = account(memberId);
    if (!canAddCoins(userAccount, credited)) {
      await queueCreditReview(memberId, credited, guild, data, 'إضافة المبلغ ستتجاوز الحد الآمن للرصيد.');
      return;
    }
    userAccount.coins += credited;
    {
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
  if (!canAddCoins(receiver, transfer.amount)) return ephemeral(i, 'لا يمكن إتمام التحويل لأن رصيد المستلم سيصل إلى الحد الأعلى المسموح.');
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
function linkedPartners(id) {
  const value = db.linkedAccounts[String(id)];
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  return [...new Set(list.map(String).filter(Boolean))];
}
function linkedTo(id) {
  return linkedPartners(id)[0] || null;
}
function hasLinkedPair(a, b) {
  return linkedPartners(a).includes(String(b)) && linkedPartners(b).includes(String(a));
}
function addLinkedPair(a, b) {
  const aa = linkedPartners(a), bb = linkedPartners(b);
  if (!aa.includes(String(b))) aa.push(String(b));
  if (!bb.includes(String(a))) bb.push(String(a));
  db.linkedAccounts[String(a)] = aa;
  db.linkedAccounts[String(b)] = bb;
}
function removeLinkedPair(a, b) {
  db.linkedAccounts[String(a)] = linkedPartners(a).filter(x => x !== String(b));
  db.linkedAccounts[String(b)] = linkedPartners(b).filter(x => x !== String(a));
  if (!db.linkedAccounts[String(a)].length) delete db.linkedAccounts[String(a)];
  if (!db.linkedAccounts[String(b)].length) delete db.linkedAccounts[String(b)];
}
async function requestAccountLink(message, args) {
  const target = await targetUser(message, args[1]);
  if (!target || target.bot || target.id === message.author.id) {
    return message.reply('❎ الاستخدام: `ربط @عضو` — حدد عضواً آخر من السيرفر.');
  }
  const targetMember = await message.guild.members.fetch(target.id).catch(() => null);
  if (!targetMember) return message.reply('❎ يجب أن يكون الطرفان داخل السيرفر.');
  const from = String(message.author.id), to = String(target.id);
  const mine = linkedPartners(from), theirs = linkedPartners(to);
  if (mine.includes(to)) return message.reply('❎ هذا الحساب مرتبط بك بالفعل.');
  if (mine.length >= 5) return message.reply('❎ وصلت إلى الحد الأقصى: 5 حسابات مرتبطة.');
  if (theirs.length >= 5) return message.reply('❎ الطرف الثاني وصل إلى الحد الأقصى: 5 حسابات مرتبطة.');
  db.linkCooldowns = db.linkCooldowns || {};
  const remaining = 30000 - (Date.now() - Number(db.linkCooldowns[from] || 0));
  if (remaining > 0) return message.reply('⏳ انتظر ' + Math.ceil(remaining / 1000) + ' ثانية قبل إرسال طلب ربط آخر.');
  const existing = Object.values(db.linkRequests).find(x => x && x.status === 'pending' &&
    ((x.from === from && x.to === to) || (x.from === to && x.to === from)));
  if (existing) return message.reply('⏳ يوجد طلب ربط معلّق بينكما بالفعل.');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  db.linkRequests[id] = { id, from, to, status: 'pending',
    createdAt: Date.now(), expiresAt: Date.now() + 15000 };
  db.linkCooldowns[from] = Date.now();
  await save();
  const embed = greenEmbed('🔗 طلب ربط الحسابات',
    '━━━━━━━━━━━━━━━━━━━━\nتم إرسال طلب لربط المحفظتين بين الطرفين.\n━━━━━━━━━━━━━━━━━━━━')
    .setAuthor({ name: 'GOLDEN CASINO • ACCOUNT LINK', iconURL: message.guild.iconURL({ dynamic: true }) || undefined })
    .addFields(
      { name: '👤 صاحب الطلب', value: message.author.toString(), inline: true },
      { name: '🤝 الطرف الثاني', value: target.toString(), inline: true },
      { name: '🛡️ الحماية', value: 'لا يتم نقل أو خصم أي رصيد بمجرد الربط.', inline: false },
      { name: '⏳ مدة الطلب', value: '15 ثانية', inline: true },
      { name: '📌 الخطوة التالية', value: 'على الطرف الثاني الضغط على **قبول الربط** لإكمال العملية.', inline: false },
      { name: '🔗 الحسابات المرتبطة', value: mine.length + '/5 لك • ' + theirs.length + '/5 للطرف الثاني', inline: true },
    );
  const row = new ActionRowBuilder().addComponents(
    btn('l:linkaccept:' + id, 'قبول الربط', ButtonStyle.Success),
    btn('l:linkreject:' + id, 'رفض', ButtonStyle.Danger),
  );
  const sent = await message.reply({ embeds: [embed], components: [row] }).catch(() => null);
  if (!sent) { db.linkRequests[id].status = 'cancelled'; await save(); return; }
  db.linkRequests[id].messageId = sent.id;
  await save();
}
async function requestLinkedWithdrawal(message, args) {
  const partners = linkedPartners(message.author.id);
  if (!partners.length) return message.reply('❎ حسابك غير مرتبط. استخدم `ربط @عضو` أولاً.');
  const mentioned = message.mentions.users.first();
  if (partners.length > 1 && !mentioned) return message.reply('اختر الحساب المطلوب السحب منه: `سحب @الشريك 10m`.');
  const partnerId = mentioned ? mentioned.id : partners[0];
  if (!partners.includes(partnerId)) return message.reply('❎ هذا العضو ليس ضمن حساباتك المرتبطة.');
  const amount = amountOf(mentioned ? args[2] : args[1]);
  if (!amount) return message.reply('❎ الاستخدام: `سحب @الشريك 10m` أو `سحب 10m` إذا كان لديك شريك واحد.');
  const source = account(partnerId);
  if (source.coins < amount) return message.reply('❎ رصيد الحساب المرتبط غير كافٍ. رصيده الحالي: **' + fmt(source.coins) + '**.');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  db.linkedWithdrawals[id] = { id, from: partnerId, to: message.author.id, amount,
    status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 15000 };
  await save();
  const embed = greenEmbed('💸 طلب سحب من المحفظة المرتبطة',
    '━━━━━━━━━━━━━━━━━━━━\nطلب تحويل رصيد بين المحفظتين المرتبطتين.\n━━━━━━━━━━━━━━━━━━━━')
    .setAuthor({ name: 'GOLDEN CASINO • WALLET TRANSFER', iconURL: message.guild.iconURL({ dynamic: true }) || undefined })
    .addFields(
      { name: '📤 سيتم الخصم من', value: '<@' + partnerId + '>', inline: true },
      { name: '📥 المستفيد', value: message.author.toString(), inline: true },
      { name: '💰 المبلغ المطلوب', value: '**' + fmt(amount) + ' كوين**', inline: false },
      { name: '🔐 تأكيد الأمان', value: 'لن يتم تنفيذ العملية إلا بموافقة صاحب المحفظة التي سيُخصم منها الرصيد.', inline: false },
      { name: '⏳ صلاحية الطلب', value: '15 ثانية', inline: true },
    );
  const row = new ActionRowBuilder().addComponents(
    btn('l:withdrawaccept:' + id, 'موافقة ونقل الرصيد', ButtonStyle.Success),
    btn('l:withdrawreject:' + id, 'رفض الطلب', ButtonStyle.Danger),
  );
  const sent = await message.reply({ embeds: [embed], components: [row] }).catch(() => null);
  if (!sent) { db.linkedWithdrawals[id].status = 'cancelled'; await save(); return; }
  db.linkedWithdrawals[id].messageId = sent.id;
  await save();
}
async function depositToLinkedPartner(message, args) {
  const userId = message.author.id;
  const partners = linkedPartners(userId);
  if (!partners.length) return message.reply('❎ حسابك غير مرتبط. استخدم `ربط @عضو` أولاً.');
  const mentioned = message.mentions.users.first();
  if (partners.length > 1 && !mentioned) return message.reply('اختر الحساب المستلم: `إيداع @الشريك 10m`.');
  const partnerId = mentioned ? mentioned.id : partners[0];
  if (!partners.includes(partnerId)) return message.reply('❎ هذا العضو ليس ضمن حساباتك المرتبطة.');
  const raw = String(mentioned ? args[2] : args[1] || '').replace(/,/g, '').toUpperCase();
  if (!raw) return message.reply('الاستخدام: إيداع @الشريك 1000 أو إيداع 1K أو إيداع كامل.');
  const sender = account(userId);
  const receiver = account(partnerId);
  let amount;
  if (raw === 'كامل' || raw === 'فل') amount = sender.coins;
  else if (raw === 'نص') amount = Math.floor(sender.coins / 2);
  else if (raw.endsWith('%')) {
    const percent = Number(raw.slice(0, -1));
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return message.reply('النسبة يجب أن تكون بين 1% و100%.');
    amount = Math.floor(sender.coins * percent / 100);
  } else {
    const match = raw.match(/^(\d+(?:\.\d+)?)(K|M)?$/);
    if (!match) return message.reply('❎ صيغة المبلغ غير صحيحة.');
    amount = Number(match[1]) * (match[2] === 'K' ? 1000 : match[2] === 'M' ? 1000000 : 1);
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) return message.reply('❎ يجب إدخال مبلغ صحيح أكبر من صفر.');
  if (sender.coins < amount) return message.reply('❎ رصيدك غير كافٍ. رصيدك الحالي: ' + fmt(sender.coins));
  if (!canAddCoins(receiver, amount)) return message.reply('❎ لا يمكن إضافة المبلغ إلى رصيد الحساب المرتبط.');
  if (active(userId) || active(partnerId)) return message.reply('❎ لا يمكن الإيداع أثناء وجود أحدكما في تحدٍ نشط.');
  if (!hasLinkedPair(userId, partnerId)) return message.reply('❎ الربط بين الحسابين غير مكتمل حالياً.');
  sender.coins -= amount;
  receiver.coins += amount;
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  db.transfers[id] = { id, from: userId, to: partnerId, amount, type: 'linked-deposit', createdAt: Date.now() };
  await save();
  const embed = greenEmbed('💸 عملية إيداع ناجحة',
    'تم إيداع **' + fmt(amount) + '** كوين إلى <@' + partnerId + '>.')
    .addFields(
      { name: 'رصيدك الجديد', value: fmt(sender.coins), inline: true },
      { name: 'رصيد الشريك الجديد', value: fmt(receiver.coins), inline: true },
    )
    .setTimestamp();
  await message.reply({ embeds: [embed] });
  const partner = await client.users.fetch(partnerId).catch(() => null);
  if (partner) await partner.send('💰 استلمت ' + fmt(amount) + ' كوين من <@' + userId + '>.').catch(() => {});
}
async function unlinkAccounts(message, args) {
  const userId = String(message.author.id);
  const partners = linkedPartners(userId);
  if (!partners.length) return message.reply('❎ لا توجد حسابات مرتبطة بحسابك.');
  const raw = String(args[1] || '').toLowerCase();
  if (raw === 'all' || raw === 'الكل') {
    for (const partnerId of partners) removeLinkedPair(userId, partnerId);
    await save();
    return message.reply('🔓 تم فصل جميع الحسابات المرتبطة (' + partners.length + ' حسابات).');
  }
  const target = await targetUser(message, args[1]);
  if (!target) {
    if (partners.length > 1) return message.reply('لديك أكثر من حساب مرتبط. استخدم `فصل @عضو` أو `فصل all`.');
    removeLinkedPair(userId, partners[0]);
    await save();
    return message.reply('🔓 تم فك الربط مع <@' + partners[0] + '>.');
  }
  if (!partners.includes(target.id)) return message.reply('❎ هذا الحساب ليس مرتبطاً بك.');
  removeLinkedPair(userId, target.id);
  await save();
  const embed = greenEmbed('🔓 تم فك ربط الحسابين',
    '━━━━━━━━━━━━━━━━━━━━\nتم إنهاء الارتباط بين المحفظتين بنجاح.\n━━━━━━━━━━━━━━━━━━━━')
    .addFields(
      { name: 'الحساب الأول', value: message.author.toString(), inline: true },
      { name: 'الحساب الثاني', value: target.toString(), inline: true },
      { name: 'الحسابات المرتبطة المتبقية', value: linkedPartners(userId).length + '/5', inline: false },
    );
  return message.reply({ embeds: [embed] });
}
async function linkedAccountButton(i, parts) {
  const action = parts[1], id = parts[2];
  if (action === 'linkaccept' || action === 'linkreject') {
    const req = db.linkRequests[id];
    if (!req || req.status !== 'pending') return ephemeral(i, 'طلب الربط غير متاح أو تمت معالجته.');
    if (Date.now() > req.expiresAt) { req.status = 'expired'; await save(); return ephemeral(i, 'انتهت مهلة طلب الربط.'); }
    if (i.user.id !== req.to) return ephemeral(i, 'فقط الشخص الذي وصله طلب الربط يستطيع الرد.');
    if (action === 'linkreject') {
      req.status = 'rejected'; req.finishedAt = Date.now(); await save();
      return i.update({ content: 'تم رفض طلب ربط الحسابين.', embeds: [], components: [] });
    }
    if (linkedPartners(req.from).length >= 5 || linkedPartners(req.to).length >= 5) return ephemeral(i, 'تعذر الربط: أحد الحسابين وصل إلى الحد الأقصى (5).');
    if (hasLinkedPair(req.from, req.to)) return ephemeral(i, 'الحسابان مرتبطان بالفعل.');
    addLinkedPair(req.from, req.to);
    req.status = 'accepted'; req.finishedAt = Date.now();
    await save();
    return i.update({ embeds: [greenEmbed('✅ تم ربط الحسابين بنجاح',
      '<@' + req.from + '> و <@' + req.to + '> أصبحا مرتبطين.\n\nيمكن لكل حساب ربط حتى 5 شركاء. أي طلب سحب من محفظة شريك يتطلب موافقة صاحبها.')], components: [] });
  }
  if (action === 'withdrawaccept' || action === 'withdrawreject') {
    const req = db.linkedWithdrawals[id];
    if (!req || req.status !== 'pending') return ephemeral(i, 'طلب السحب غير متاح أو تمت معالجته.');
    if (Date.now() > req.expiresAt) { req.status = 'expired'; await save(); return ephemeral(i, 'انتهت مهلة طلب السحب.'); }
    if (i.user.id !== req.from) return ephemeral(i, 'فقط صاحب الحساب الذي سيُخصم منه الرصيد يستطيع الموافقة أو الرفض.');
    if (action === 'withdrawreject') {
      req.status = 'rejected'; req.finishedAt = Date.now(); await save();
      return i.update({ content: 'تم رفض طلب نقل الرصيد. لم يتم خصم أي مبلغ.', embeds: [], components: [] });
    }
    if (!hasLinkedPair(req.from, req.to)) {
      req.status = 'cancelled'; await save();
      return ephemeral(i, 'تم إلغاء الطلب لأن ربط الحسابين لم يعد قائماً.');
    }
    const source = account(req.from), destination = account(req.to);
    if (source.coins < req.amount) return ephemeral(i, 'الرصيد الحالي لم يعد كافياً. لم يتم خصم أي مبلغ.');
    if (!canAddCoins(destination, req.amount)) return ephemeral(i, 'لا يمكن إضافة المبلغ إلى حسابك بسبب الحد الأعلى للرصيد.');
    source.coins -= req.amount;
    destination.coins += req.amount;
    req.status = 'completed'; req.finishedAt = Date.now();
    req.sourceBalanceAfter = source.coins; req.destinationBalanceAfter = destination.coins;
    await save();
    return i.update({ embeds: [greenEmbed('✅ اكتمل تحويل الرصيد',
      'تمت موافقة صاحب الحساب المرتبط ونقل الرصيد بنجاح.\n\nمن: <@' + req.from + '>\nإلى: <@' + req.to + '>\nالمبلغ: **' + fmt(req.amount) + ' كوين**\nرصيدك الجديد: **' + fmt(destination.coins) + '**')], components: [] });
  }
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
  if (!canAddCoins(data, reward)) return message.reply('تعذر إضافة المكافأة لأن رصيدك وصل إلى الحد الأعلى.');
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
  if (!canAddCoins(data, reward)) return message.reply('تعذر إضافة الأجر لأن رصيدك وصل إلى الحد الأعلى.');
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

  // Golden-style wallet panel: main wallet plus every linked wallet (maximum five).
  const ownBalance = data.hideBalance === true ? 0 : data.coins;
  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
    .setTitle('الرصيد الحالي لـ ' + (user.username || data.username))
    .addFields({
      name: '💰 ' + (user.username || data.username),
      value: '**' + fmt(ownBalance) + ' كوين**',
      inline: false,
    });

  const partners = linkedPartners(user.id).slice(0, 5);
  for (let index = 0; index < partners.length; index++) {
    const partnerId = partners[index];
    const partnerUser = await client.users.fetch(partnerId).catch(() => null);
    const partnerData = account(partnerId);
    const partnerName = partnerUser?.username || partnerData.username || partnerId;
    const partnerBalance = partnerData.hideBalance === true ? 0 : partnerData.coins;
    embed.addFields({
      name: '💳 ' + partnerName + ' (' + (index + 1) + '/' + partners.length + ')',
      value: '**' + fmt(partnerBalance) + ' كوين**',
      inline: false,
    });
  }

  embed.setFooter({
    text: partners.length
      ? '# Golden Casino | المحافظ المرتبطة'
      : (message.guild.name + ' • Golden Casino'),
  }).setTimestamp();

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
  if (add && !canAddCoins(a, n)) return message.reply('❎ لا يمكن إضافة هذا المبلغ؛ سيتجاوز الحد الآمن للرصيد.');
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
function activeTournament() {
  return Object.values(db.tournaments || {}).find(item => item && item.status === 'active') || null;
}
async function refreshTournamentBoard(tournament) {
  const channel = await client.channels.fetch(CFG.tournamentRoom).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const entries = Object.entries(tournament.participants || {})
    .sort((a, b) => Number(b[1].wageredAmount || 0) - Number(a[1].wageredAmount || 0))
    .slice(0, 10);
  const description = entries.length
    ? entries.map(([id, data], index) => (index === 0 ? '🏆' : '**#' + (index + 1) + '**') + ' <@' + id + '> — **' + fmt(data.wageredAmount) + '**').join('\n')
    : 'لا يوجد مشاركون حتى الآن.';
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🏆 ترتيب البطولة')
    .setDescription(description)
    .setFooter({ text: 'Golden Casino • البطولة' }).setTimestamp();
  if (tournament.messageId) {
    const oldMessage = await channel.messages.fetch(tournament.messageId).catch(() => null);
    if (oldMessage) { await oldMessage.edit({ embeds: [embed] }).catch(() => {}); return; }
  }
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) { tournament.messageId = sent.id; await save(); }
}
async function trackTournamentBet(userId, amount) {
  const tournament = activeTournament();
  if (!tournament || tournament.endsAt <= Date.now()) return;
  if (!tournament.participants) tournament.participants = {};
  const row = tournament.participants[String(userId)] || { wageredAmount: 0 };
  row.wageredAmount = Math.min(Number.MAX_SAFE_INTEGER, (Number(row.wageredAmount) || 0) + amount);
  tournament.participants[String(userId)] = row;
  await save();
  await refreshTournamentBoard(tournament);
}
async function finishTournament(tournament, cancelled = false) {
  if (!tournament || tournament.status !== 'active') return;
  tournament.status = cancelled ? 'cancelled' : 'finished';
  tournament.finishedAt = Date.now();
  const ranking = Object.entries(tournament.participants || {})
    .sort((a, b) => Number(b[1].wageredAmount || 0) - Number(a[1].wageredAmount || 0));
  const awards = [];
  if (!cancelled) {
    for (let index = 0; index < Math.min(10, ranking.length); index++) {
      const prize = index === 0 ? tournament.prizes.first
        : index === 1 ? tournament.prizes.second
        : index === 2 ? tournament.prizes.third
        : tournament.prizes.top10;
      const [userId] = ranking[index];
      const wallet = account(userId);
      if (Number.isSafeInteger(prize) && prize > 0 && canAddCoins(wallet, prize)) {
        wallet.coins += prize;
        awards.push({ userId, prize, place: index + 1 });
      }
    }
  }
  tournament.awards = awards;
  await save();
  const channel = await client.channels.fetch(CFG.tournamentRoom).catch(() => null);
  if (channel?.isTextBased()) {
    const result = cancelled ? 'تم إلغاء البطولة دون توزيع الجوائز.' :
      (awards.length ? awards.map(x => '**#' + x.place + '** <@' + x.userId + '> — **' + fmt(x.prize) + '** كوين').join('\n') : 'انتهت البطولة دون مشاركين مستحقين للجوائز.');
    await channel.send({ embeds: [new EmbedBuilder().setColor(cancelled ? 0xed4245 : 0x2ecc71)
      .setTitle(cancelled ? 'تم إلغاء البطولة' : '🏆 انتهت البطولة')
      .setDescription(result).setTimestamp()] }).catch(() => {});
  }
}
const BLACKJACK_SUITS = ['♠️', '♥️', '♦️', '♣️'];
const BLACKJACK_RANKS = [
  { rank: 'A', value: 11 }, { rank: '2', value: 2 }, { rank: '3', value: 3 },
  { rank: '4', value: 4 }, { rank: '5', value: 5 }, { rank: '6', value: 6 },
  { rank: '7', value: 7 }, { rank: '8', value: 8 }, { rank: '9', value: 9 },
  { rank: '10', value: 10 }, { rank: 'J', value: 10 }, { rank: 'Q', value: 10 }, { rank: 'K', value: 10 },
];
function blackjackDeck() {
  const deck = BLACKJACK_SUITS.flatMap(suit => BLACKJACK_RANKS.map(card => ({ ...card, suit })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function blackjackScore(hand) {
  let score = hand.reduce((sum, card) => sum + card.value, 0);
  let aces = hand.filter(card => card.rank === 'A').length;
  while (score > 21 && aces > 0) { score -= 10; aces--; }
  return score;
}
function blackjackCards(hand) {
  return hand.map(card => card.rank + card.suit).join('  ');
}
function blackjackEmbed(game, revealDealer = false, headline = '🃏 بلاك جاك') {
  const dealerHand = revealDealer ? blackjackCards(game.dealer) : game.dealer[0].rank + game.dealer[0].suit + '  🂠';
  const dealerScore = revealDealer ? '\nالمجموع: **' + blackjackScore(game.dealer) + '**' : '';
  return new EmbedBuilder().setColor(0x1f8b4c).setTitle(headline)
    .setDescription(
      '**اللاعب <@' + game.userId + '>**\n' + blackjackCards(game.player) +
      '\nالمجموع: **' + blackjackScore(game.player) + '**\n\n' +
      '**الموزّع**\n' + dealerHand + dealerScore +
      '\n\nالرهان الحالي: **' + fmt(game.stake) + '** كوين'
    ).setFooter({ text: 'Golden Casino • Blackjack' }).setTimestamp();
}
function blackjackRow(game) {
  if (game.status !== 'playing') return [];
  return [new ActionRowBuilder().addComponents(
    btn('bj:hit:' + game.id, 'سحب ورقة', ButtonStyle.Primary),
    btn('bj:stand:' + game.id, 'تثبيت', ButtonStyle.Success),
    btn('bj:double:' + game.id, 'مضاعفة الرهان', ButtonStyle.Danger, game.doubled || game.player.length !== 2),
  )];
}
async function finishBlackjack(game, outcome) {
  if (!game || game.status !== 'playing') return;
  game.status = outcome;
  game.finishedAt = Date.now();
  const wallet = account(game.userId);
  let payout = 0;
  if (outcome === 'win') payout = game.natural ? Math.floor(game.stake * 2.5) : game.stake * 2;
  else if (outcome === 'draw' || outcome === 'expired') payout = game.stake;
  if (payout > 0 && canAddCoins(wallet, payout)) wallet.coins += payout;
  else if (payout > 0) { game.status = 'refunded'; payout = game.stake; wallet.coins += payout; }
  game.payout = payout;
  await save();
  const channel = await client.channels.fetch(game.channelId).catch(() => null);
  const msg = channel?.isTextBased() ? await channel.messages.fetch(game.messageId).catch(() => null) : null;
  const result = outcome === 'win' ? '🎉 فزت! استلمت **' + fmt(payout) + '** كوين.'
    : outcome === 'draw' ? '🤝 تعادل! تمت إعادة **' + fmt(payout) + '** كوين.'
    : outcome === 'expired' ? '⌛ انتهى الوقت؛ تمت إعادة رهانك.'
    : outcome === 'refunded' ? 'تمت إعادة الرهان لحماية رصيدك من تجاوز الحد الأعلى.'
    : 'خسرت الجولة. لم يتم إرجاع الرهان.';
  if (msg) await msg.edit({ embeds: [blackjackEmbed(game, true, '🃏 انتهت جولة بلاك جاك').setDescription(
    blackjackEmbed(game, true).data.description + '\n\n' + result
  )], components: [] }).catch(() => {});
}
async function blackjackStand(game) {
  while (blackjackScore(game.dealer) < 17) game.dealer.push(game.deck.pop());
  const player = blackjackScore(game.player), dealer = blackjackScore(game.dealer);
  const outcome = dealer > 21 || player > dealer ? 'win' : player === dealer ? 'draw' : 'loss';
  return finishBlackjack(game, outcome);
}
async function startBlackjack(message, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return message.reply('الاستخدام: بلاك جاك 100k');
  const wallet = account(message.author.id);
  if (wallet.coins < amount) return message.reply('رصيدك غير كافٍ لهذه الجولة.');
  if (active(message.author.id)) return message.reply('لا يمكنك بدء بلاك جاك أثناء وجودك في تحدٍ آخر.');
  if (Object.values(db.blackjack).some(game => game && game.userId === message.author.id && game.status === 'playing')) return message.reply('لديك جولة بلاك جاك نشطة بالفعل.');
  wallet.coins -= amount;
  const deck = blackjackDeck();
  const game = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    userId: message.author.id, channelId: message.channel.id, status: 'playing',
    stake: amount, doubled: false, deck, player: [deck.pop(), deck.pop()],
    dealer: [deck.pop(), deck.pop()], createdAt: Date.now(), expiresAt: Date.now() + 90000,
  };
  game.natural = blackjackScore(game.player) === 21;
  db.blackjack[game.id] = game;
  await save();
  const sent = await message.reply({ embeds: [blackjackEmbed(game)], components: blackjackRow(game) });
  game.messageId = sent.id;
  await save();
  if (game.natural) await blackjackStand(game);
}
async function blackjackButton(i) {
  const [, action, id] = i.customId.split(':');
  const game = db.blackjack[id];
  if (!game || game.status !== 'playing') return ephemeral(i, 'هذه الجولة انتهت أو لم تعد متاحة.');
  if (i.user.id !== game.userId) return ephemeral(i, 'هذه الجولة ليست لك.');
  if (Date.now() >= game.expiresAt) {
    await finishBlackjack(game, 'expired');
    return ephemeral(i, 'انتهى وقت الجولة وتمت إعادة الرهان.');
  }
  if (action === 'hit') {
    game.player.push(game.deck.pop());
    const score = blackjackScore(game.player);
    if (score > 21) return finishBlackjack(game, 'loss');
    if (score === 21) return blackjackStand(game);
    game.expiresAt = Date.now() + 90000;
    await save();
    return i.update({ embeds: [blackjackEmbed(game)], components: blackjackRow(game) });
  }
  if (action === 'stand') {
    await i.deferUpdate();
    return blackjackStand(game);
  }
  if (action === 'double') {
    if (game.doubled || game.player.length !== 2) return ephemeral(i, 'المضاعفة متاحة مرة واحدة وفي أول دور فقط.');
    const wallet = account(game.userId);
    if (wallet.coins < game.stake) return ephemeral(i, 'رصيدك لا يكفي لمضاعفة الرهان.');
    wallet.coins -= game.stake;
    game.stake *= 2;
    game.doubled = true;
    game.player.push(game.deck.pop());
    await i.deferUpdate();
    if (blackjackScore(game.player) > 21) return finishBlackjack(game, 'loss');
    return blackjackStand(game);
  }
}
function privateRoomPrice() {
  const value = Number(db.settings.privateRoomPrice ?? CFG.rentPrice);
  return Number.isSafeInteger(value) && value > 0 ? value : CFG.rentPrice;
}
function activePrivateRooms() {
  return Object.values(db.privateRooms || {}).filter(room => room && room.status === 'active');
}
function privateRoomPanelEmbed() {
  const price = privateRoomPrice();
  const available = Math.max(0, 5 - activePrivateRooms().length);
  return new EmbedBuilder().setColor(0xf1c40f).setTitle('🎰 | Golden Casino • الرومات الخاصة')
    .setDescription(
      '> احجز روم خاصة لك ولأصدقائك داخل السيرفر.\n' +
      '> يمكنك إضافة حتى **5 أعضاء** إلى رومك.\n' +
      '> مدة الحجز: **12 ساعة**.\n' +
      '> سعر الحجز: **' + fmt(price) + ' كوين**.\n' +
      '> الرومات المتاحة حالياً: **' + available + '/5**.\n\n' +
      '**داخل رومك:** استخدم `add @عضو` و `rem @عضو` لإدارة الأعضاء، و`رومي` لمعرفة وقت الانتهاء.'
    ).setFooter({ text: 'Golden Casino • Private Rooms' }).setTimestamp();
}
async function ensurePrivateRoomPanel() {
  const channel = await client.channels.fetch(CFG.rentalRoom).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn('Private room panel channel unavailable:', CFG.rentalRoom);
    return;
  }
  const row = new ActionRowBuilder().addComponents(btn('r:buy', '🎟️ احجز روم خاصة', ButtonStyle.Success));
  const panelId = db.settings.privateRoomPanelMessageId;
  const oldMessage = panelId ? await channel.messages.fetch(panelId).catch(() => null) : null;
  if (oldMessage) return oldMessage.edit({ embeds: [privateRoomPanelEmbed()], components: [row] });
  const sent = await channel.send({ embeds: [privateRoomPanelEmbed()], components: [row] });
  db.settings.privateRoomPanelMessageId = sent.id;
  await save();
}
async function refreshPrivateRoomPanel() {
  const channel = await client.channels.fetch(CFG.rentalRoom).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const row = new ActionRowBuilder().addComponents(btn('r:buy', '🎟️ احجز روم خاصة', ButtonStyle.Success));
  const id = db.settings.privateRoomPanelMessageId;
  const msg = id ? await channel.messages.fetch(id).catch(() => null) : null;
  if (msg) await msg.edit({ embeds: [privateRoomPanelEmbed()], components: [row] }).catch(() => {});
  else await ensurePrivateRoomPanel();
}
async function buyPrivateRoom(i) {
  if (activePrivateRooms().length >= 5) return ephemeral(i, 'عذراً، جميع الرومات الخاصة الخمس محجوزة حالياً.');
  const existing = activePrivateRooms().find(room => room.owner === i.user.id);
  if (existing) return ephemeral(i, 'لديك روم خاصة بالفعل: <#' + existing.channelId + '>.');
  const price = privateRoomPrice();
  const wallet = account(i.user.id);
  if (wallet.coins < price) return ephemeral(i, 'رصيدك غير كافٍ. السعر: **' + fmt(price) + '** كوين.');
  const guild = await client.guilds.fetch(CFG.guild).catch(() => null);
  const panel = await client.channels.fetch(CFG.rentalRoom).catch(() => null);
  if (!guild || !panel || !panel.isTextBased()) return ephemeral(i, 'روم الحجوزات غير متاحة حالياً، تواصل مع الإدارة.');
  const member = await guild.members.fetch(i.user.id).catch(() => null);
  if (!member) return ephemeral(i, 'يجب أن تكون عضواً في السيرفر لحجز روم خاصة.');
  const channel = await guild.channels.create({
    name: '🎰｜' + member.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 70) + '-' + member.user.id.slice(-4),
    type: 0,
    ...(panel.parentId ? { parent: panel.parentId } : {}),
    permissionOverwrites: [
      { id: guild.id, deny: ['ViewChannel'] },
      { id: member.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks'] },
      { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels', 'ManageMessages'] },
    ],
  }).catch(error => { console.error('Private room create failed:', error); return null; });
  if (!channel) return ephemeral(i, 'تعذر إنشاء الروم. لم يتم خصم أي مبلغ من رصيدك.');
  wallet.coins -= price;
  const room = {
    channelId: channel.id, owner: i.user.id, status: 'active',
    createdAt: Date.now(), expiresAt: Date.now() + CFG.rentDurationMs,
    addedMembers: [], price,
  };
  db.privateRooms[channel.id] = room;
  await channel.send({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('🎰 رومك الخاصة')
    .setDescription('صاحب الروم: <@' + i.user.id + '>\nالمدة: **12 ساعة**\nالسعر المدفوع: **' + fmt(price) + '** كوين\nتنتهي: <t:' + Math.floor(room.expiresAt / 1000) + ':R>\n\nإضافة عضو: `add @عضو`\nإزالة عضو: `rem @عضو`\nعرض التفاصيل: `رومي`')
    .setFooter({ text: 'Golden Casino • Private Rooms' }).setTimestamp()] });
  await save();
  await refreshPrivateRoomPanel();
  return ephemeral(i, '✅ تم حجز رومك الخاصة: <#' + channel.id + '>\nتم خصم **' + fmt(price) + '** كوين من محفظتك.');
}
async function expirePrivateRoom(room) {
  if (!room || room.status !== 'active') return;
  room.status = 'expired';
  room.expiredAt = Date.now();
  await save();
  const channel = await client.channels.fetch(room.channelId).catch(() => null);
  if (channel) await channel.delete('انتهت مدة حجز الروم الخاصة').catch(() => {});
  await refreshPrivateRoomPanel();
}
async function privateRoomCommand(message, args) {
  const current = db.privateRooms[message.channel.id];
  const cmd = String(args[0] || '').toLowerCase();
  if (cmd === 'رومي') {
    const room = Object.values(db.privateRooms).find(item => item && item.owner === message.author.id && item.status === 'active');
    if (!room) return message.reply('ليس لديك روم خاصة حالياً.');
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('🎰 تفاصيل رومك الخاصة')
      .setDescription('الروم: <#' + room.channelId + '>\nالأعضاء المضافون: ' + ((room.addedMembers || []).map(id => '<@' + id + '>').join('، ') || 'لا يوجد') +
        '\nتنتهي: <t:' + Math.floor(room.expiresAt / 1000) + ':R>') ] });
  }
  if (!current || current.status !== 'active') return false;
  if (current.owner !== message.author.id) return message.reply('إدارة الروم الخاصة متاحة لصاحب الروم فقط.');
  if (['add', 'اضافة', 'إضافة'].includes(cmd)) {
    const user = message.mentions.users.first();
    if (!user || user.bot || user.id === current.owner) return message.reply('استخدم: `add @عضو`');
    if ((current.addedMembers || []).includes(user.id)) return message.reply('هذا العضو موجود بالفعل في الروم.');
    if ((current.addedMembers || []).length >= 5) return message.reply('الحد الأعلى هو 5 أعضاء إضافيين.');
    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) return message.reply('يجب أن يكون العضو في السيرفر.');
    await message.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    current.addedMembers.push(user.id);
    await save();
    return message.reply('✅ تمت إضافة ' + user + ' إلى الروم.');
  }
  if (['rem', 'remove', 'حذف', 'ازالة', 'إزالة'].includes(cmd)) {
    const user = message.mentions.users.first();
    if (!user || !(current.addedMembers || []).includes(user.id)) return message.reply('استخدم: `rem @عضو` لعضو مضاف إلى الروم.');
    await message.channel.permissionOverwrites.delete(user.id).catch(() => {});
    current.addedMembers = current.addedMembers.filter(id => id !== user.id);
    await save();
    return message.reply('✅ تمت إزالة ' + user + ' من الروم.');
  }
  return false;
}
async function challenge(message, args) {
  if (!CFG.gameRooms.includes(message.channel.id)) return message.reply('أوامر التحدي تعمل فقط في رومات الألعاب المحددة.');
  const challengeChannel = await client.channels.fetch(CFG.challengeRoom).catch(() => null);
  if (!challengeChannel || !challengeChannel.isTextBased()) return message.reply('روم عرض التحديات غير متاح حالياً.');
  const preference = String(args[1] || '').toLowerCase();
  if (['عام', 'فرندز'].includes(preference)) {
    const data = account(message.author.id);
    data.challenge = preference === 'عام' ? 'general' : 'friends';
    await save();
    return message.reply(preference === 'عام'
      ? 'تم تغيير إعداد استقبال التحديات إلى عام.'
      : 'تم تغيير إعداد استقبال التحديات إلى الأصدقاء فقط.');
  }
  const user = await targetUser(message, args[1]);
  const bet = amountOf(args[2]);
  if (!user || user.bot || user.id === message.author.id || !bet) return message.reply('الاستخدام: تحدي @العضو المبلغ');
  if (bet > Math.floor(Number.MAX_SAFE_INTEGER / 2)) return message.reply('قيمة الرهان أكبر من الحد الآمن.');
  if (active(message.author.id) || active(user.id)) return message.reply('أحد اللاعبين لديه تحدٍ لم ينتهِ بعد.');
  const challengerData = account(message.author.id);
  const opponentData = account(user.id);
  if ((challengerData.blocked || []).includes(user.id) || (opponentData.blocked || []).includes(message.author.id)) {
    return message.reply('لا يمكنك تحدي هذا اللاعب لأن أحدكما حظر الآخر.');
  }
  if (challengerData.challenge === 'friends' || opponentData.challenge === 'friends') {
    if (!(challengerData.friends || []).includes(user.id) || !(opponentData.friends || []).includes(message.author.id)) {
      return message.reply('لا يمكنك تحدي هذا اللاعب لأن أحدكما يستقبل التحديات من الأصدقاء فقط.');
    }
  }
  if (account(message.author.id).coins < bet) return message.reply('❎ **ليس لديك ما يكفي للتحدي على ' + fmt(bet) + '**');
  if (account(user.id).coins < bet) return message.reply('❎ **ليس لدى صديقك ما يكفي للتحدي على ' + fmt(bet) + '**');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const g = db.games[id] = {
    id, p1: message.author.id, p2: user.id, bet, status: 'pending',
    escrow: false, channel: challengeChannel.id, message: null, mode: null,
    expires: Date.now() + CFG.inviteMs, created: Date.now(),
  };
  const embed = new EmbedBuilder()
    .setColor(0x808080)
    .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
    .setTitle('اختار نوع اللعبة')
    .setDescription('> العضو: ' + user.toString() + '\n\nالمبلغ: `' + fmt(bet) + '`')
    .addFields(
      { name: 'لعبة النرد 🎲', value: '> يفوز صاحب أعلى مجموع من ثلاث رميات.' },
      { name: 'الرقم التقريبي 📊', value: '> حاول الاقتراب من الرقم المستهدف؛ يفوز صاحب أقل فرق.' },
      { name: 'أكس أو ❌', value: '> أكمل ثلاثة رموز متتالية أفقياً أو عمودياً أو قطرياً.' },
      { name: 'حجرة ورقة مقص ✂️', value: '> يختار كل لاعب سراً ثم تتم مقارنة الاختيارين.' },
    );
  const sent = await challengeChannel.send({ content: message.author.toString(), embeds: [embed], components: gameRows(g), allowedMentions: { users: [message.author.id] } }).catch(() => null);
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
function xoEmbed(g) {
  const board = (g.board || Array(9).fill(null)).map((v, i) => v || String(i + 1));
  const lines = [board.slice(0, 3), board.slice(3, 6), board.slice(6, 9)].map(row => row.join(' │ '));
  return new EmbedBuilder().setColor(0x5865f2).setTitle('❌ لعبة أكس أو')
    .setDescription(lines.join('\n─────────\n') + '\n\nالدور: <@' + g.turn + '>\nX: <@' + g.p1 + '> • O: <@' + g.p2 + '>')
    .setFooter({ text: 'الرهان: ' + fmt(g.bet) });
}
function rpsEmbed(g) {
  const labels = { rock: '🪨 حجر', paper: '📄 ورقة', scissors: '✂️ مقص' };
  const p1 = g.choices && g.choices[g.p1];
  const p2 = g.choices && g.choices[g.p2];
  return new EmbedBuilder().setColor(0x5865f2).setTitle('✂️ حجرة ورقة مقص')
    .setDescription('<@' + g.p1 + '>: ' + (p1 ? labels[p1] : 'بانتظار الاختيار') + '\n<@' + g.p2 + '>: ' + (p2 ? labels[p2] : 'بانتظار الاختيار'))
    .setFooter({ text: 'الرهان: ' + fmt(g.bet) });
}
function gameRows(g) {
  if (g.status === 'pending') return [new ActionRowBuilder().addComponents(
    btn('g:dice:' + g.id, 'النرد 🎲', ButtonStyle.Primary),
    btn('g:close:' + g.id, 'الرقم التقريبي 📊', ButtonStyle.Primary),
    btn('g:selectxo:' + g.id, 'أكس أو ❌', ButtonStyle.Primary),
    btn('g:rps:' + g.id, 'حجرة ورقة مقص ✂️', ButtonStyle.Primary),
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
  if (g.status === 'playing' && g.mode === 'rps') return [new ActionRowBuilder().addComponents(
    btn('g:rock:' + g.id, '🪨 حجر', ButtonStyle.Primary),
    btn('g:paper:' + g.id, '📄 ورقة', ButtonStyle.Primary),
    btn('g:scissors:' + g.id, '✂️ مقص', ButtonStyle.Primary),
  )];
  if (g.status === 'playing' && g.mode === 'xo') {
    const board = g.board || Array(9).fill(null);
    return [0, 1, 2].map(row => {
      const buttons = [0, 1, 2].map(col => {
        const cell = row * 3 + col;
        const value = board[cell];
        return new ButtonBuilder()
          .setCustomId('g:xo:' + cell + ':' + g.id)
          .setLabel(value || String(cell + 1))
          .setStyle(value === 'X' ? ButtonStyle.Danger : value === 'O' ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(Boolean(value));
      });
      return new ActionRowBuilder().addComponents(...buttons);
    });
  }
  return [];
}
async function editGame(g, title, description, components) {
  const ch = await client.channels.fetch(g.channel).catch(() => null);
  if (!ch || !ch.isTextBased()) return;
  const msg = await ch.messages.fetch(g.message).catch(() => null);
  const embed = g.mode === 'close' ? legacyCloseEmbed(g)
    : g.mode === 'xo' ? xoEmbed(g)
    : g.mode === 'rps' ? rpsEmbed(g)
    : legacyGameEmbed(g);
  if (msg) await msg.edit({ content: description || null, embeds: [embed], components: components || [] }).catch(() => {});
}
async function settle(g, winner, result) {
  if (!g || g.status !== 'playing') return;
  g.status = 'finished';
  if (winner) {
    const loser = winner === g.p1 ? g.p2 : g.p1;
    const fee = Math.floor(g.bet * CFG.fee);
    const payout = g.bet * 2 - fee;
    if (!canAddCoins(account(winner), payout)) {
      account(g.p1).coins += g.bet;
      account(g.p2).coins += g.bet;
      g.status = 'cancelled';
      g.result = 'تم إلغاء التحدي لحماية الرصيد من تجاوز الحد الآمن؛ تمت إعادة الرهانات.';
      await save();
      await editGame(g, 'تم إلغاء التحدي', g.result, []);
      return;
    }
    account(winner).coins += payout;
    const loserWallet = account(loser);
    const cashbackEarned = Math.floor(g.bet * 0.025);
    loserWallet.cashback = (Number(loserWallet.cashback) || 0) + cashbackEarned;
    if (g.mode === 'dice' || g.mode === 'close') {
      const winnerScore = g.mode === 'close'
        ? Number((g.closeSums && g.closeSums[winner]) || 0)
        : diceTotal(g, winner);
      const loserScore = g.mode === 'close'
        ? Number((g.closeSums && g.closeSums[loser]) || 0)
        : diceTotal(g, loser);
      g.result = '<@' + winner + '> فائز بمجموع ' + winnerScore + ' نقطة.\n<@' + loser + '> خسر بمجموع ' + loserScore + ' نقطة.\nاللعبة: ' + (g.mode === 'dice' ? 'النرد' : 'الرقم التقريبي') + ' • الرهان: ' + fmt(g.bet);
    } else {
      g.result = result + '\n\nالفائز: <@' + winner + '> • الجائزة بعد الرسوم: ' + fmt(payout) + ' كوين.';
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
  for (const tournament of Object.values(db.tournaments || {})) {
    if (tournament && tournament.status === 'active' && Number(tournament.endsAt) <= now) await finishTournament(tournament);
  }
  for (const game of Object.values(db.blackjack || {})) {
    if (game && game.status === 'playing' && Number(game.expiresAt) <= now) await finishBlackjack(game, 'expired');
  }
  for (const room of Object.values(db.privateRooms || {})) {
    if (room && room.status === 'active' && Number(room.expiresAt) <= now) await expirePrivateRoom(room);
  }
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
  const aDiff = Math.abs(a - g.closeMax);
  const bDiff = Math.abs(b - g.closeMax);
  const winner = aDiff === bDiff ? null : (aDiff < bDiff ? g.p1 : g.p2);
  const result = 'الرقم المستهدف: **' + g.closeMax + '**\n' +
    '<@' + g.p1 + '> : ' + (g.closeNumbers[g.p1].join(' + ') || '—') + ' = **' + a + '** (الفرق: **' + aDiff + '** )\n' +
    '<@' + g.p2 + '> : ' + (g.closeNumbers[g.p2].join(' + ') || '—') + ' = **' + b + '** (الفرق: **' + bDiff + '** )\n' +
    (winner ? 'الفائز هو الأقرب إلى الرقم المستهدف، سواء كان مجموعه أعلى أو أقل.' : 'تعادل! اللاعبان على نفس البعد من الرقم المستهدف.') +
    (reason ? '\n' + reason : '');
  await settle(g, winner, result);
}
async function gameButton(i, parts) {
  const action = parts[1];
  const id = parts[parts.length - 1];
  const g = db.games[id];
  if (!g) return ephemeral(i, 'هذا التحدي غير موجود أو انتهى.');
  const uid = i.user.id;
  if (action === 'cancel' || ['dice', 'close', 'selectxo', 'rps'].includes(action)) {
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
    g.mode = action === 'selectxo' ? 'xo' : action;
    g.status = 'awaiting_accept';
    g.expires = Date.now() + CFG.inviteMs;
    const descriptions = {
      dice: { name: '🎲 لعبة النرد:', value: '> يفوز صاحب أعلى مجموع من ثلاث رميات.' },
      close: { name: '📊 الرقم التقريبي:', value: '> حاول الاقتراب من الرقم المستهدف؛ يفوز صاحب أقل فرق.' },
      xo: { name: '❌ أكس أو:', value: '> أكمل ثلاثة رموز متتالية أفقياً أو عمودياً أو قطرياً.' },
      rps: { name: '✂️ حجرة ورقة مقص:', value: '> يختار كل لاعب سراً، ثم تتم مقارنة الاختيارين.' },
    };
    const details = descriptions[g.mode];
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
      content: '> تم اختيار لعبة: ' + details.name + ' !!',
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
    else if (g.mode === 'xo') {
      g.board = Array(9).fill(null);
      g.turn = crypto.randomInt(2) === 0 ? g.p1 : g.p2;
    } else if (g.mode === 'rps') {
      g.choices = {};
      g.turn = null;
    } else g.turn = crypto.randomInt(2) === 0 ? g.p1 : g.p2;
    await save();
    await trackTournamentBet(g.p1, g.bet);
    await trackTournamentBet(g.p2, g.bet);
    await i.deferReply({ ephemeral: true });
    await i.editReply({
      content: '> تم قبول التحدي: ' + (g.mode === 'dice' ? 'النرد' : g.mode === 'close' ? 'الرقم التقريبي' : g.mode === 'xo' ? 'أكس أو' : 'حجرة ورقة مقص') + ' مع <@' + g.p1 + '>.',
    });
    // Legacy behavior: confirm privately, then publish the first turn after 2.5 seconds.
    setTimeout(() => {
      editGame(
        g,
        'بدأ التحدي',
        g.mode === 'rps'
          ? 'يختار كل لاعب الآن حجرة أو ورقة أو مقص.'
          : '<@' + (g.mode === 'close' ? g.closeTurn : g.turn) + '>\n اصبح دورك',
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
          (total === g.closeMax ? 'ممتاز! وصلت إلى الرقم المستهدف تماماً وتم إنهاء دورك.' : 'تجاوزت الرقم المستهدف، وسيتم احتسابك حسب الأقرب إليه سواء أعلى أو أقل.'),
        ephemeral: true,
      }).catch(() => {});
      await finishApproximateTurn(g, total === g.closeMax ? 'وصل إلى الرقم المستهدف تماماً.' : 'تجاوز الرقم المستهدف؛ ويُحسب الفائز حسب أقرب مجموع.');
      return;
    }
    await save();
    await editGame(g, 'لعبة الرقم التقريبي', '<@' + uid + '>\n اصبح مجموعك **' + total + '** — أكمل أو اضغط finish لإنهاء دورك.', gameRows(g));
    await i.followUp({
      content: 'لقد حصلت على **' + number + '**\nاصبح مجموعك **' + total + '**\nحاول الاقتراب من الرقم المستهدف؛ يمكنك إنهاء دورك بالضغط على finish.',
      ephemeral: true,
    }).catch(() => {});
    return;
  }
  if (['rock', 'paper', 'scissors'].includes(action)) {
    if (g.status !== 'playing' || g.mode !== 'rps') return ephemeral(i, 'لعبة حجرة ورقة مقص غير نشطة.');
    if (uid !== g.p1 && uid !== g.p2) return ephemeral(i, 'أنت لست أحد لاعبي هذا التحدي.');
    if (g.choices && g.choices[uid]) return ephemeral(i, 'لقد سجلت اختيارك بالفعل.');
    if (!g.choices) g.choices = {};
    g.choices[uid] = action;
    g.expires = Date.now() + CFG.gameMs;
    await save();
    await i.deferUpdate();
    if (!g.choices[g.p1] || !g.choices[g.p2]) {
      await editGame(g, 'حجرة ورقة مقص', 'تم تسجيل اختيار لاعب؛ بانتظار اللاعب الآخر.', gameRows(g));
      return;
    }
    const a = g.choices[g.p1], b = g.choices[g.p2];
    const winner = rpsWinner(a, b, g.p1, g.p2);
    const labels = { rock: '🪨 حجر', paper: '📄 ورقة', scissors: '✂️ مقص' };
    const result = '<@' + g.p1 + '> اختار ' + labels[a] + '\n<@' + g.p2 + '> اختار ' + labels[b];
    await settle(g, winner, result);
    return;
  }
  if (action === 'xo') {
    if (g.status !== 'playing' || g.mode !== 'xo') return ephemeral(i, 'لعبة أكس أو غير نشطة.');
    if (uid !== g.p1 && uid !== g.p2) return ephemeral(i, 'أنت لست أحد لاعبي هذا التحدي.');
    if (uid !== g.turn) return ephemeral(i, 'ليس دورك الآن.');
    const cell = Number(parts[2]);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return ephemeral(i, 'الخانة غير صحيحة.');
    if (!Array.isArray(g.board)) g.board = Array(9).fill(null);
    if (g.board[cell]) return ephemeral(i, 'هذه الخانة مستخدمة بالفعل.');
    const mark = uid === g.p1 ? 'X' : 'O';
    g.board[cell] = mark;
    const won = xoWinner(g.board, mark);
    const draw = !won && xoIsDraw(g.board);
    g.expires = Date.now() + CFG.gameMs;
    await i.deferUpdate();
    if (won) {
      await save();
      await settle(g, uid, 'فاز <@' + uid + '> بعد إكمال ثلاثة رموز متتالية.');
      return;
    }
    if (draw) {
      await save();
      await settle(g, null, 'انتهت لعبة أكس أو بالتعادل.');
      return;
    }
    g.turn = uid === g.p1 ? g.p2 : g.p1;
    await save();
    await editGame(g, 'لعبة أكس أو', 'الدور الآن عند <@' + g.turn + '>.', gameRows(g));
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
      await editGame(g, 'لعبة النرد — 3 رميات', '<@' + nextPlayer + '>\n اصبح دورك', gameRows(g));
      return;
    }
    const a = diceTotal(g, g.p1), b = diceTotal(g, g.p2);
    const winner = a === b ? null : (a > b ? g.p1 : g.p2);
    const result =
      '<@' + g.p1 + '> رمياته: **' + diceRollList(g, g.p1).join(' + ') + ' = ' + a + '**\n' +
      '<@' + g.p2 + '> رمياته: **' + diceRollList(g, g.p2).join(' + ') + ' = ' + b + '**';
    await i.deferUpdate();
    await settle(g, winner, result);
  }
}
function withdrawPanel() {
  const description = [
    'لسحب رصيدك وتحويله إلى كريدت قم باتباع الخطوات التالية:',
    '',
    '1️⃣ اضغط على الزر بالأسفل (**طلب سحب**)',
    '2️⃣ اكتب القيمة التي تريد سحبها',
    '3️⃣ ستصلك رسالة تأكيد السحب عند اكتمال العملية',
    '',
    '**تنويه:**',
    '- أقل مبلغ للسحب هو: **' + fmt(CFG.minWithdraw) + '**',
    '- أعلى مبلغ للسحب هو: **' + fmt(CFG.maxWithdraw) + '**',
    '- قد تستغرق العملية **24 ساعة كحد أقصى**',
  ].join('\n');
  return {
    embeds: [makeEmbed('💳 سحب الرصيد', description).setColor(0x57f287)],
    components: [new ActionRowBuilder().addComponents(btn('w:open', 'طلب سحب', ButtonStyle.Success))],
  };
}
function withdrawalRequestEmbed(req, restored = false) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('💸 طلب سحب رصيد جديد')
    .setDescription(
      'تم استلام طلب سحب جديد، يرجى مراجعته واتخاذ القرار المناسب.\n\n' +
      '👤 **صاحب الطلب**\n<@' + req.user + '>\n\n' +
      '💰 **المبلغ المطلوب**\n`' + fmt(req.amount) + ' كوين`\n\n' +
      '🟢 **الحالة**\nقيد المراجعة'
    )
    .addFields(
      { name: '🆔 رقم الطلب', value: '`' + req.id + '`', inline: true },
      { name: '📅 وقت الطلب', value: '<t:' + Math.floor(req.created / 1000) + ':R>', inline: true }
    )
    .setFooter({ text: restored ? 'Batoot Casino • استعادة طلب محفوظ' : 'Batoot Casino • نظام السحب' })
    .setTimestamp(req.created);
}
async function recoverWithdrawalRequests() {
  const channel = await client.channels.fetch(CFG.requestsRoom).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('Withdrawal recovery skipped: requests channel is unavailable.');
    return;
  }
  for (const req of Object.values(db.withdrawals)) {
    if (!req || req.status !== 'pending') continue;
    if (req.message) {
      const existing = await channel.messages.fetch(req.message).catch(() => null);
      if (existing) continue;
    }
    const msg = await channel.send({
      embeds: [withdrawalRequestEmbed(req, true)],
      components: [new ActionRowBuilder().addComponents(
        btn('w:approve:' + req.id, 'قبول', ButtonStyle.Success),
        btn('w:reject:' + req.id, 'رفض وإرجاع الرصيد', ButtonStyle.Danger),
      )],
    }).catch(error => {
      console.error('Could not restore withdrawal request ' + req.id + ':', error);
      return null;
    });
    if (msg) {
      req.message = msg.id;
      req.messageChannel = channel.id;
      await save();
    }
  }
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
  db.withdrawals[id] = { id, user: i.user.id, amount: n, status: 'pending', created: Date.now(), message: null, messageChannel: CFG.requestsRoom };
  await save();
  const msg = await ch.send({
    embeds: [withdrawalRequestEmbed(db.withdrawals[id])],
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
    if (await handleGoldenUtilities(message, { isAdmin: admin })) return;
    if (await handleGoldenExtras(message, { account, save, premiumRoleId: process.env.GOLDEN_PREMIUM_ROLE_ID || '', suggestionChannelId: process.env.SUGGESTION_CHANNEL_ID || '' })) return;
    if (await handleGoldenSocial(message, { account, save, premiumRoleId: process.env.GOLDEN_PREMIUM_ROLE_ID || '' })) return;
    if (await handleGoldenCatalog(message, { ownerId: CFG.owner, ownerIds: CFG.owners })) return;
    if (cmd === 'ربط') return requestAccountLink(message, args);
    if (cmd === 'سحب') return withLock('linked-withdraw:' + message.author.id, () => requestLinkedWithdrawal(message, args));
    if (cmd === 'إيداع' || cmd === 'ايداع') {
      const partnerId = linkedTo(message.author.id);
      const lockKey = 'linked-deposit:' + [message.author.id, partnerId || 'none'].sort().join(':');
      return withLock(lockKey, () => depositToLinkedPartner(message, args));
    }
    if (cmd === 'فصل') return unlinkAccounts(message, args);
    if (['تحويل', 'transfer', 'pay'].includes(cmd)) return createMemberTransfer(message, args);
    if (cmd === 'شحن') {
      const parsed = legacyAdminAmount(args[1]);
      if (parsed.error) return message.reply('❎ **صيغة الشحن غير صحيحة**\nمثال: `شحن 10m`');
      return message.channel.send('#credit ' + CFG.creditRecipient + ' ' + String(parsed.value));
    }
    if (cmd === 'withdraw' && message.channel.id === CFG.withdrawRoom) return message.channel.send(withdrawPanel());
    if (['فلوس', 'money', 'رصيدي', 'balance'].includes(cmd)) return balance(message, message.mentions.users.first() || message.author);
    if (['يومي', 'دايلي', 'daily'].includes(cmd)) return withLock('daily:' + message.author.id, () => claimDaily(message));
    if (['عمل', 'work'].includes(cmd)) return withLock('work:' + message.author.id, () => workForCoins(message));
    if (['ملفي', 'profile', 'بروفايل'].includes(cmd)) return showProfile(message, message.mentions.users.first() || message.author);
    if (['تحويلاتي', 'history'].includes(cmd)) return showTransferHistory(message, message.author);
    if (['سجل-اداري', 'adminlog'].includes(cmd)) return showAdminLog(message);
    if (['توب', 'top'].includes(cmd)) {
      await message.guild.members.fetch().catch(() => {});
      const ranked = Object.entries(db.users)
        .filter(([id, data]) => message.guild.members.cache.has(id) && data.hideBalance !== true)
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
    if (['hideme', 'اخفاء-رصيدي'].includes(cmd)) {
      const wallet = account(message.author.id);
      if (wallet.hideBalance === true) return message.reply('🔒 رصيدك مخفي بالفعل. استخدم `unhideme` لإظهاره.');
      wallet.hideBalance = true;
      await save();
      return message.reply('🔒 تم إخفاء رصيدك من أمر فلوس والترتيب. رصيدك الحقيقي لم يتغير.');
    }
    if (['unhideme', 'اظهار-رصيدي'].includes(cmd)) {
      const wallet = account(message.author.id);
      if (wallet.hideBalance !== true) return message.reply('رصيدك ظاهر بالفعل.');
      wallet.hideBalance = false;
      await save();
      return message.reply('🔓 تم إظهار رصيدك مجدداً.');
    }
    if (cmd === 'كاش') {
      const wallet = account(message.author.id);
      const amount = Math.max(0, Number(wallet.cashback) || 0);
      const embed = makeEmbed('💸 رصيد الكاش باك',
        'رصيدك المتاح: **' + fmt(amount) + '** كوين\\nتحصل على 2.5% من قيمة الرهان عند الخسارة في التحديات.')
        .setColor(0x2ecc71);
      const row = new ActionRowBuilder().addComponents(btn('cash:withdraw', 'سحب الكاش باك', ButtonStyle.Success));
      return message.reply({ embeds: [embed], components: [row] });
    }
    if (['tax', 'ضريبة', 'ضريبه'].includes(cmd)) {
      const amount = amountOf(args.slice(1).join(''));
      if (!amount) return message.reply('الاستخدام: `tax 1m` أو `ضريبة 500k`');
      const total = Math.floor(amount * 20 / 19 + 1);
      const tax = total - amount;
      return message.reply({ embeds: [makeEmbed('🧾 حاسبة الضريبة',
        'المبلغ الصافي: **' + fmt(amount) + '** كوين\nالضريبة: **' + fmt(tax) + '** كوين\nالمبلغ المطلوب إرساله: **' + fmt(total) + '** كوين').setColor(0x3498db)] });
    }
    if (['totalcoins', 'مجموع-الفلوس'].includes(cmd)) {
      if (!admin(message.author.id)) return message.reply('هذا الأمر للإدارة فقط.');
      const total = Object.values(db.users).reduce((sum, user) => sum + (Number.isSafeInteger(Number(user.coins)) && Number(user.coins) > 0 ? Number(user.coins) : 0), 0);
      return message.reply({ embeds: [makeEmbed('💰 مجموع أرصدة الأعضاء', 'الإجمالي: **' + fmt(total) + '** كوين\nعدد الحسابات: **' + fmt(Object.keys(db.users).length) + '**').setColor(0x2ecc71)] });
    }
    if (['totalwithdraw', 'مجموع-السحوبات'].includes(cmd)) {
      if (!admin(message.author.id)) return message.reply('هذا الأمر للإدارة فقط.');
      const rows = Object.values(db.withdrawals || {});
      const approved = rows.filter(row => row && row.status === 'approved');
      const total = approved.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      return message.reply({ embeds: [makeEmbed('📤 إحصائيات السحوبات',
        'إجمالي السحوبات المقبولة والمسجلة: **' + fmt(total) + '** كوين\nعدد الطلبات المقبولة: **' + fmt(approved.length) + '**\nالطلبات المعلقة: **' + fmt(rows.filter(row => row && row.status === 'pending').length) + '**').setColor(0x3498db)] });
    }
    if (['بلاك', 'blackjack', 'بلاكجاك'].includes(cmd)) return startBlackjack(message, amountOf(args[1]));
    if (cmd === 'رومي' || ['add', 'اضافة', 'إضافة', 'rem', 'remove', 'حذف', 'ازالة', 'إزالة'].includes(cmd)) {
      const handled = await privateRoomCommand(message, args);
      if (handled !== false) return handled;
    }
    if (cmd === 'سعر-الروم') {
      if (!CFG.owners.includes(message.author.id)) return message.reply('هذا الأمر للأونرز فقط.');
      const price = amountOf(args[1]);
      if (!price) return message.reply('الاستخدام: `سعر-الروم 1m`');
      db.settings.privateRoomPrice = price;
      await save();
      await refreshPrivateRoomPanel();
      return message.reply('تم تحديث سعر حجز الروم إلى **' + fmt(price) + '** كوين.');
    }
    if (cmd === '!competition') {
      if (!CFG.owners.includes(String(message.author.id))) return message.reply('❌ هذا الأمر للأونرز فقط.');
      if (activeTournament()) return message.reply('توجد بطولة نشطة بالفعل. ألغها أولاً باستخدام `!cancelcompetition`.');
      const days = Number(String(args[1] || '').replace(/[^0-9]/g, ''));
      const top10 = amountOf(args[2]), first = amountOf(args[3]), second = amountOf(args[4]), third = amountOf(args[5]);
      if (!Number.isInteger(days) || days < 1 || days > 30 || !top10 || !first || !second || !third) {
        return message.reply('الاستخدام: `!competition 2d 100m 500m 1000m 3000m`\nالترتيب: مدة البطولة، جائزة المراكز 4-10، الأول، الثاني، الثالث.');
      }
      const tournament = {
        id: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
        status: 'active', startsAt: Date.now(), endsAt: Date.now() + days * 86400000,
        prizes: { top10, first, second, third }, participants: {}, messageId: null,
      };
      db.tournaments[tournament.id] = tournament;
      const channel = await client.channels.fetch(CFG.tournamentRoom).catch(() => null);
      if (!channel || !channel.isTextBased()) { delete db.tournaments[tournament.id]; return message.reply('روم البطولة غير متاح. تحقق من TOURNAMENT_ROOM_ID.'); }
      const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🏆 بطولة Golden Casino')
        .setDescription('**المدة:** ' + days + ' يوم\n**المركز الأول:** ' + fmt(first) + '\n**المركز الثاني:** ' + fmt(second) +
          '\n**المركز الثالث:** ' + fmt(third) + '\n**المراكز 4-10:** ' + fmt(top10) + ' لكل مركز\n\nتنتهي <t:' + Math.floor(tournament.endsAt / 1000) + ':R>.')
        .setFooter({ text: 'يتم احتساب نقاط البطولة من رهانات التحديات المقبولة.' }).setTimestamp();
      const announcement = await channel.send({ embeds: [embed] }).catch(() => null);
      if (!announcement) { delete db.tournaments[tournament.id]; return message.reply('تعذر نشر إعلان البطولة.'); }
      tournament.announcementId = announcement.id;
      await save();
      await refreshTournamentBoard(tournament);
      return message.reply('✅ تم إنشاء البطولة ونشرها في روم البطولات.');
    }
    if (cmd === '!cancelcompetition') {
      if (!CFG.owners.includes(String(message.author.id))) return message.reply('❌ هذا الأمر للأونرز فقط.');
      const tournament = activeTournament();
      if (!tournament) return message.reply('لا توجد بطولة نشطة حالياً.');
      await finishTournament(tournament, true);
      return message.reply('تم إلغاء البطولة.');
    }
    if (cmd === 'توب-البطولة') {
      const tournament = activeTournament();
      if (!tournament) return message.reply('لا توجد بطولة نشطة حالياً.');
      await refreshTournamentBoard(tournament);
      return message.reply('تم تحديث ترتيب البطولة في روم البطولات.');
    }
    if (cmd === 'setmoney') {
      if (!CFG.owners.includes(String(message.author.id))) return message.reply('هذا الأمر للأونرز فقط.');
      const target = await targetUser(message, args[1]);
      const amount = amountOf(args[2]);
      if (!target || !amount) return message.reply('الاستخدام: `setmoney @عضو 500k`');
      const wallet = account(target.id);
      const previous = wallet.coins;
      wallet.coins = amount;
      logAdminAction({ admin: message.author.id, target: target.id, amount, action: 'تعيين الرصيد (كان ' + fmt(previous) + ')', balanceAfter: amount });
      await save();
      return message.reply('✅ تم تعيين رصيد ' + target + ' إلى **' + fmt(amount) + '** كوين.');
    }
    if (['add', 'اضافة', 'إضافة'].includes(cmd)) return adminBalance(message, args, true);
    if (['rmv', 'remove', 'ازالة', 'إزالة'].includes(cmd)) return adminBalance(message, args, false);
    if (['تحدي', 'challenge'].includes(cmd)) return challenge(message, args);
    if (['مساعدة', 'help'].includes(cmd)) {
      return message.reply({ embeds: [makeEmbed('أوامر Batoot Casino',
        'فلوس @عضو — عرض الرصيد\nيومي — مكافأة كل 24 ساعة\nعمل — عمل كل ساعة\nملفي — عرض ملفك وإحصائياتك\nتحويل @عضو مبلغ — تحويل مع تأكيد\nربط @عضو — ربط محفظتين بموافقة الطرف الثاني\nإيداع مبلغ / سحب مبلغ — نقل رصيد بين المحفظتين المرتبطتين\nفك @عضو — فصل الحساب المرتبط\ntax مبلغ / ضريبة مبلغ — حساب الضريبة\nhideme / unhideme — إخفاء أو إظهار رصيدك\nتحويلاتي — سجل تحويلاتك\nتوب — أعلى الأرصدة الظاهرة\nadd / اضافة @عضو مبلغ — إضافة رصيد للإدارة\nrmv / ازالة @عضو مبلغ — خصم رصيد للإدارة\nsetmoney @عضو مبلغ — تعيين الرصيد (الأونر فقط)\ntotalcoins / totalwithdraw — إحصائيات مالية للإدارة\nشحن مبلغ — شحن عبر ProBot\nwithdraw — لوحة طلب السحب\nسجل-اداري — سجل عمليات الإدارة\nبلاك جاك مبلغ — لعبة بلاك جاك ضد الموزّع\nحجز روم — من لوحة الرومات الخاصة في روم الحجوزات\nرومي — تفاصيل رومك الخاصة\nadd @عضو / rem @عضو — إدارة أعضاء رومك\nسعر-الروم مبلغ — تغيير سعر الحجز (الأونرز فقط)')] });
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
      return withLock('withdrawal-modal:' + i.user.id, () => withdrawalModal(i));
    }
    if (!i.isButton()) return;
    if (i.customId === 'cash:withdraw') {
      return withLock('cashback:' + i.user.id, async () => {
        const wallet = account(i.user.id);
        const base = Math.floor(Number(wallet.cashback) || 0);
        if (base <= 0) return ephemeral(i, 'ليس لديك رصيد كاش باك للسحب.');
        const expiry = typeof wallet.primeExpires === 'number' ? wallet.primeExpires : (Date.parse(wallet.primeExpires) || 0);
        const isPrime = expiry > Date.now();
        const payout = isPrime ? base * 2 : base;
        if (!Number.isSafeInteger(payout) || !canAddCoins(wallet, payout)) return ephemeral(i, 'تعذر سحب الكاش باك بسبب تجاوز الحد الآمن للرصيد.');
        wallet.cashback = 0;
        wallet.coins += payout;
        await save();
        const embed = makeEmbed('✅ تم سحب الكاش باك',
          'تمت إضافة **' + fmt(payout) + '** كوين إلى محفظتك.' + (isPrime ? '\\n👑 تمت مضاعفة المكافأة بسبب Prime.' : ''))
          .setColor(0x2ecc71);
        return i.update({ embeds: [embed], components: [] });
      });
    }
    const parts = i.customId.split(':');
    const family = parts[0];
    if (i.customId === 'r:buy') return withLock('private-room-buy:' + i.user.id, () => buyPrivateRoom(i));
    if (i.customId.startsWith('bj:')) return withLock('blackjack:' + i.customId.split(':')[2], () => blackjackButton(i));
    if (!['t', 'c', 'g', 'w', 'l'].includes(family)) return;
    // Lock by the underlying request/game ID, not by button action. A confirm,
    // reject, roll, or duplicate click on the same object cannot race another.
    const resourceId = family === 'w' && parts[1] === 'open'
      ? 'open:' + i.user.id
      : (family === 'w' && parts[1] === 'rate' ? parts[2] : parts[parts.length - 1]);
    return withLock(family + ':' + resourceId, async () => {
      if (family === 't') return transferButton(i, parts);
      if (family === 'c') return creditReviewButton(i, parts);
      if (family === 'g') return gameButton(i, parts);
      if (family === 'w') return withdrawalButton(i, parts);
      if (family === 'l') return linkedAccountButton(i, parts);
    });
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
  await recoverCreditReviews().catch(console.error);
  await recoverWithdrawalRequests().catch(console.error);
  await ensurePrivateRoomPanel().catch(console.error);
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
