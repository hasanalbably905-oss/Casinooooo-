'use strict';
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
  probotOwners: (process.env.PROBOT_OWNER_IDS || '992561603046293596').split(',').map(x => x.trim()).filter(Boolean),
  minWithdraw: 4000000, maxWithdraw: 10000000000, fee: 0.04,
  inviteMs: 120000, gameMs: 600000,
};

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'store.json');
fs.mkdirSync(DIR, { recursive: true });

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
  ? { users: old.users || importOldUsers(), games: old.games || {}, withdrawals: old.withdrawals || {} }
  : { users: importOldUsers(), games: {}, withdrawals: {} };

let writeChain = Promise.resolve();
function save() {
  writeChain = writeChain.then(async () => {
    const temp = FILE + '.tmp';
    await fs.promises.writeFile(temp, JSON.stringify(db, null, 2), 'utf8');
    await fs.promises.rename(temp, FILE);
  });
  return writeChain;
}
function account(id) {
  const key = String(id);
  if (!db.users[key]) db.users[key] = { coins: 0 };
  const n = Number(db.users[key].coins);
  db.users[key].coins = Number.isSafeInteger(n) && n >= 0 ? n : 0;
  return db.users[key];
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
  return Object.values(db.games).some(g => g && g.id !== excludeId && ['pending', 'selecting', 'playing'].includes(g.status) && (g.p1 === id || g.p2 === id));
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
    owners: CFG.probotOwners,
  }],
});

client.probot.on('transfered', async (guild, data, error) => {
  try {
    if (error) return console.error('ProBot transfer error:', error);
    if (!data || data.isOwner !== true || !data.member) return;
    const memberId = data.member.id || (data.member.user && data.member.user.id);
    const credited = Number(data.price);
    if (!memberId || !Number.isSafeInteger(credited) || credited <= 0) return;
    account(memberId).coins += credited;
    await save();
    const destination = data.channel || (guild && guild.channel);
    if (destination && typeof destination.send === 'function') {
      await destination.send({
        embeds: [makeEmbed('تم شحن الرصيد بنجاح',
          'العضو: <@' + memberId + '>\nالمبلغ المضاف: **' + fmt(credited) +
          '**\nالرصيد الحالي: **' + fmt(account(memberId).coins) + '**')],
      }).catch(() => {});
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
async function balance(message, user) {
  return message.reply({ embeds: [makeEmbed('رصيد ' + user.username, 'رصيدك الحالي: **' + fmt(account(user.id).coins) + '** كوين.')] });
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
  if (message.author.id !== CFG.owner) return message.reply('هذا الأمر للأونر فقط.');
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
  await save();
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setDescription(add ? 'تم الإضافة بنجاح' : 'تم حذف بنجاح')
    .addFields(
      { name: 'بواسطة', value: message.author.toString() },
      { name: add ? 'اضاف' : 'حذف', value: '$' + String(n) },
      { name: add ? 'المستلم' : 'من', value: user.toString() },
      { name: 'الرصيد الحالي للمستلم', value: String(a.coins) },
    );
  return message.reply({ embeds: [embed] });
}
async function challenge(message, args) {
  if (!CFG.gameRooms.includes(message.channel.id)) return message.reply('أوامر التحدي تعمل فقط في رومات الألعاب المحددة.');
  const user = await targetUser(message, args[1]);
  const bet = amountOf(args[2]);
  if (!user || user.bot || user.id === message.author.id || !bet) return message.reply('الاستخدام: تحدي @العضو المبلغ');
  if (active(message.author.id) || active(user.id)) return message.reply('أحد اللاعبين لديه تحدٍ لم ينتهِ بعد.');
  if (account(message.author.id).coins < bet || account(user.id).coins < bet) return message.reply('يجب أن يمتلك كل لاعب رصيداً يكفي للرهان: **' + fmt(bet) + '**.');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const g = db.games[id] = {
    id, p1: message.author.id, p2: user.id, bet, status: 'pending',
    escrow: false, channel: message.channel.id, message: null,
    expires: Date.now() + CFG.inviteMs, created: Date.now(),
  };
  const sent = await message.channel.send({
    content: user.toString(),
    embeds: [makeEmbed('تحدي جديد', message.author.toString() + ' يتحدى ' + user.toString() + '\nالرهان لكل لاعب: **' + fmt(bet) + '** كوين.\nهل تقبل؟')],
    components: [new ActionRowBuilder().addComponents(
      btn('g:accept:' + id, 'قبول التحدي', ButtonStyle.Success),
      btn('g:decline:' + id, 'رفض', ButtonStyle.Danger),
    )],
  }).catch(() => null);
  if (!sent) { delete db.games[id]; return message.reply('تعذر إرسال التحدي.'); }
  g.message = sent.id;
  await save();
}
function gameRows(g) {
  if (g.status === 'selecting') return [new ActionRowBuilder().addComponents(
    btn('g:dice:' + g.id, '🎲 النرد', ButtonStyle.Primary),
    btn('g:close:' + g.id, '🔢 الرقم التقريبي', ButtonStyle.Primary),
  )];
  if (g.status === 'playing') return [new ActionRowBuilder().addComponents(
    btn('g:roll:' + g.id, g.mode === 'dice' ? 'ارمِ النرد' : 'اختر رقمك', ButtonStyle.Success),
  )];
  return [];
}
async function editGame(g, title, description, components) {
  const ch = await client.channels.fetch(g.channel).catch(() => null);
  if (!ch || !ch.isTextBased()) return;
  const msg = await ch.messages.fetch(g.message).catch(() => null);
  if (msg) await msg.edit({ embeds: [makeEmbed(title, description)], components: components || [] }).catch(() => {});
}
async function settle(g, winner, result) {
  if (!g || g.status !== 'playing') return;
  g.status = 'finished';
  if (winner) {
    const pot = g.bet * 2;
    const payout = pot - Math.floor(pot * CFG.fee);
    account(winner).coins += payout;
    g.result = result + '\nالفائز: <@' + winner + '> — الجائزة: **' + fmt(payout) + '** بعد رسوم 4%.';
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
  account(g.p1).coins += g.bet;
  account(g.p2).coins += g.bet;
  g.result = reason;
  await save();
  await editGame(g, 'تم إلغاء التحدي', reason, []);
}
async function sweep() {
  const now = Date.now();
  for (const g of Object.values(db.games)) {
    if (!g || !g.expires || g.expires > now) continue;
    if (g.status === 'pending') {
      g.status = 'expired';
      await editGame(g, 'انتهت صلاحية التحدي', 'لم يتم قبول التحدي خلال الوقت المحدد.', []);
    } else if (g.status === 'selecting' || g.status === 'playing') {
      await refund(g, 'انتهى الوقت؛ أُعيد الرهان للطرفين.');
    }
  }
  await save();
}
async function gameButton(i, parts) {
  const action = parts[1];
  const id = parts[parts.length - 1];
  const g = db.games[id];
  if (!g) return ephemeral(i, 'هذا التحدي غير موجود أو انتهى.');
  const uid = i.user.id;
  if (action === 'accept' || action === 'decline') {
    if (g.status !== 'pending') return ephemeral(i, 'تم التعامل مع التحدي مسبقاً.');
    if (uid !== g.p2) return ephemeral(i, 'هذا التحدي موجّه للاعب الآخر فقط.');
    if (action === 'decline') {
      g.status = 'declined';
      await save();
      return i.update({ embeds: [makeEmbed('تم رفض التحدي', i.user.toString() + ' رفض التحدي.')], components: [] });
    }
    if (active(g.p1, g.id) || active(g.p2, g.id)) return ephemeral(i, 'أحد اللاعبين دخل تحدياً آخر.');
    if (account(g.p1).coins < g.bet || account(g.p2).coins < g.bet) return ephemeral(i, 'رصيد أحد اللاعبين لم يعد كافياً.');
    account(g.p1).coins -= g.bet;
    account(g.p2).coins -= g.bet;
    g.escrow = true;
    g.status = 'selecting';
    g.expires = Date.now() + CFG.gameMs;
    await save();
    return i.update({ embeds: [makeEmbed('اختيار اللعبة', 'تم حجز الرهان من الطرفين. اختاروا نوع اللعبة:')], components: gameRows(g) });
  }
  if (action === 'dice' || action === 'close') {
    if (g.status !== 'selecting') return ephemeral(i, 'اختيار اللعبة لم يعد متاحاً.');
    if (uid !== g.p1 && uid !== g.p2) return ephemeral(i, 'هذا التحدي ليس لك.');
    g.mode = action;
    g.status = 'playing';
    g.rolls = {};
    g.target = action === 'close' ? crypto.randomInt(1, 101) : null;
    g.expires = Date.now() + CFG.gameMs;
    await save();
    const rules = action === 'dice'
      ? 'كل لاعب يرمي مرة واحدة، والرقم الأعلى يفوز.'
      : 'يوجد رقم سري من 1 إلى 100؛ الأقرب إليه يفوز. كل لاعب يختار مرة واحدة.';
    return i.update({ embeds: [makeEmbed(action === 'dice' ? 'لعبة النرد' : 'لعبة الرقم التقريبي', rules + '\nالرهان: **' + fmt(g.bet) + '** لكل لاعب.')], components: gameRows(g) });
  }
  if (action === 'roll') {
    if (g.status !== 'playing') return ephemeral(i, 'اللعبة ليست في مرحلة اللعب.');
    if (uid !== g.p1 && uid !== g.p2) return ephemeral(i, 'أنت لست أحد لاعبي هذا التحدي.');
    if (g.rolls[uid] !== undefined) return ephemeral(i, 'لقد لعبت دورك بالفعل.');
    g.rolls[uid] = g.mode === 'dice' ? crypto.randomInt(1, 7) : crypto.randomInt(1, 101);
    await save();
    if (g.rolls[g.p1] === undefined || g.rolls[g.p2] === undefined) {
      return i.update({ embeds: [makeEmbed('تم تسجيل دورك', 'تم تسجيل نتيجتك بشكل مخفي. بانتظار اللاعب الآخر.')], components: gameRows(g) });
    }
    const a = g.rolls[g.p1], b = g.rolls[g.p2];
    let winner = null;
    if (g.mode === 'dice') winner = a === b ? null : (a > b ? g.p1 : g.p2);
    else {
      const da = Math.abs(a - g.target), dbb = Math.abs(b - g.target);
      winner = da === dbb ? null : (da < dbb ? g.p1 : g.p2);
    }
    const result = g.mode === 'dice'
      ? '<@' + g.p1 + '> حصل على **' + a + '**\n<@' + g.p2 + '> حصل على **' + b + '**'
      : 'الرقم السري: **' + g.target + '**\n<@' + g.p1 + '> اختار **' + a + '**\n<@' + g.p2 + '> اختار **' + b + '**';
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
  if (user) await user.send((req.status === 'approved' ? 'تمت الموافقة على طلب السحب، والتسليم إن وجد يتم يدوياً من الإدارة.' : 'تم رفض طلب السحب وإرجاع الرصيد.') + ' المبلغ: ' + fmt(req.amount)).catch(() => {});
}

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  if (CFG.guild && message.guild.id !== CFG.guild) return;
  const text = message.content.trim();
  if (!text) return;
  const args = text.split(/\s+/);
  const cmd = args[0].toLowerCase();
  try {
    if (cmd === 'withdraw' && message.channel.id === CFG.withdrawRoom) return message.channel.send(withdrawPanel());
    if (['فلوس', 'money', 'رصيدي', 'balance'].includes(cmd)) return balance(message, message.mentions.users.first() || message.author);
    if (['توب', 'top'].includes(cmd)) {
      await message.guild.members.fetch().catch(() => {});
      const ranked = Object.entries(db.users)
        .filter(([id]) => message.guild.members.cache.has(id))
        .sort((a, b) => b[1].coins - a[1].coins)
        .slice(0, 10);
      const lines = ranked.map(([id, data], i) =>
        '**#' + (i + 1) + '. ' + (client.users.cache.get(id) || message.guild.members.cache.get(id).user).toString() + '** - \`' + fmt(data.coins) + '\`'
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
        'فلوس — عرض الرصيد\nتوب — أعلى 10 أرصدة\nتحدي @عضو مبلغ — تحدٍ في رومات الألعاب\nwithdraw — لوحة السحب في روم السحب\nadd @عضو مبلغ — إضافة رصيد (للأونر فقط)\nrmv / remove @عضو مبلغ — حذف رصيد (للأونر فقط)')] });
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
    if (parts[0] === 'g') return gameButton(i, parts);
    if (parts[0] === 'w') return withdrawalButton(i, parts);
  } catch (error) {
    console.error('interactionCreate:', error);
    await ephemeral(i, 'حدث خطأ أثناء تنفيذ العملية. تواصل مع الإدارة إذا لاحظت تغييراً في رصيدك.');
  }
});

client.once('ready', async () => {
  console.log('Batoot Casino ready: ' + client.user.tag);
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
client.login(process.env.DISCORD_TOKEN);
 + String(n) },
      { name: add ? 'المستلم' : 'من', value: user.toString() },
      { name: 'الرصيد الحالي للمستلم', value: String(a.coins) },
    );
  return message.reply({ embeds: [embed] });
}
async function challenge(message, args) {
  if (!CFG.gameRooms.includes(message.channel.id)) return message.reply('أوامر التحدي تعمل فقط في رومات الألعاب المحددة.');
  const user = await targetUser(message, args[1]);
  const bet = amountOf(args[2]);
  if (!user || user.bot || user.id === message.author.id || !bet) return message.reply('الاستخدام: تحدي @العضو المبلغ');
  if (active(message.author.id) || active(user.id)) return message.reply('أحد اللاعبين لديه تحدٍ لم ينتهِ بعد.');
  if (account(message.author.id).coins < bet || account(user.id).coins < bet) return message.reply('يجب أن يمتلك كل لاعب رصيداً يكفي للرهان: **' + fmt(bet) + '**.');
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const g = db.games[id] = {
    id, p1: message.author.id, p2: user.id, bet, status: 'pending',
    escrow: false, channel: message.channel.id, message: null,
    expires: Date.now() + CFG.inviteMs, created: Date.now(),
  };
  const sent = await message.channel.send({
    content: user.toString(),
    embeds: [makeEmbed('تحدي جديد', message.author.toString() + ' يتحدى ' + user.toString() + '\nالرهان لكل لاعب: **' + fmt(bet) + '** كوين.\nهل تقبل؟')],
    components: [new ActionRowBuilder().addComponents(
      btn('g:accept:' + id, 'قبول التحدي', ButtonStyle.Success),
      btn('g:decline:' + id, 'رفض', ButtonStyle.Danger),
    )],
  }).catch(() => null);
  if (!sent) { delete db.games[id]; return message.reply('تعذر إرسال التحدي.'); }
  g.message = sent.id;
  await save();
}
function gameRows(g) {
  if (g.status === 'selecting') return [new ActionRowBuilder().addComponents(
    btn('g:dice:' + g.id, '🎲 النرد', ButtonStyle.Primary),
    btn('g:close:' + g.id, '🔢 الرقم التقريبي', ButtonStyle.Primary),
  )];
  if (g.status === 'playing') return [new ActionRowBuilder().addComponents(
    btn('g:roll:' + g.id, g.mode === 'dice' ? 'ارمِ النرد' : 'اختر رقمك', ButtonStyle.Success),
  )];
  return [];
}
async function editGame(g, title, description, components) {
  const ch = await client.channels.fetch(g.channel).catch(() => null);
  if (!ch || !ch.isTextBased()) return;
  const msg = await ch.messages.fetch(g.message).catch(() => null);
  if (msg) await msg.edit({ embeds: [makeEmbed(title, description)], components: components || [] }).catch(() => {});
}
async function settle(g, winner, result) {
  if (!g || g.status !== 'playing') return;
  g.status = 'finished';
  if (winner) {
    const pot = g.bet * 2;
    const payout = pot - Math.floor(pot * CFG.fee);
    account(winner).coins += payout;
    g.result = result + '\nالفائز: <@' + winner + '> — الجائزة: **' + fmt(payout) + '** بعد رسوم 4%.';
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
  account(g.p1).coins += g.bet;
  account(g.p2).coins += g.bet;
  g.result = reason;
  await save();
  await editGame(g, 'تم إلغاء التحدي', reason, []);
}
async function sweep() {
  const now = Date.now();
  for (const g of Object.values(db.games)) {
    if (!g || !g.expires || g.expires > now) continue;
    if (g.status === 'pending') {
      g.status = 'expired';
      await editGame(g, 'انتهت صلاحية التحدي', 'لم يتم قبول التحدي خلال الوقت المحدد.', []);
    } else if (g.status === 'selecting' || g.status === 'playing') {
      await refund(g, 'انتهى الوقت؛ أُعيد الرهان للطرفين.');
    }
  }
  await save();
}
async function gameButton(i, parts) {
  const action = parts[1];
  const id = parts[parts.length - 1];
  const g = db.games[id];
  if (!g) return ephemeral(i, 'هذا التحدي غير موجود أو انتهى.');
  const uid = i.user.id;
  if (action === 'accept' || action === 'decline') {
    if (g.status !== 'pending') return ephemeral(i, 'تم التعامل مع التحدي مسبقاً.');
    if (uid !== g.p2) return ephemeral(i, 'هذا التحدي موجّه للاعب الآخر فقط.');
    if (action === 'decline') {
      g.status = 'declined';
      await save();
      return i.update({ embeds: [makeEmbed('تم رفض التحدي', i.user.toString() + ' رفض التحدي.')], components: [] });
    }
    if (active(g.p1, g.id) || active(g.p2, g.id)) return ephemeral(i, 'أحد اللاعبين دخل تحدياً آخر.');
    if (account(g.p1).coins < g.bet || account(g.p2).coins < g.bet) return ephemeral(i, 'رصيد أحد اللاعبين لم يعد كافياً.');
    account(g.p1).coins -= g.bet;
    account(g.p2).coins -= g.bet;
    g.escrow = true;
    g.status = 'selecting';
    g.expires = Date.now() + CFG.gameMs;
    await save();
    return i.update({ embeds: [makeEmbed('اختيار اللعبة', 'تم حجز الرهان من الطرفين. اختاروا نوع اللعبة:')], components: gameRows(g) });
  }
  if (action === 'dice' || action === 'close') {
    if (g.status !== 'selecting') return ephemeral(i, 'اختيار اللعبة لم يعد متاحاً.');
    if (uid !== g.p1 && uid !== g.p2) return ephemeral(i, 'هذا التحدي ليس لك.');
    g.mode = action;
    g.status = 'playing';
    g.rolls = {};
    g.target = action === 'close' ? crypto.randomInt(1, 101) : null;
    g.expires = Date.now() + CFG.gameMs;
    await save();
    const rules = action === 'dice'
      ? 'كل لاعب يرمي مرة واحدة، والرقم الأعلى يفوز.'
      : 'يوجد رقم سري من 1 إلى 100؛ الأقرب إليه يفوز. كل لاعب يختار مرة واحدة.';
    return i.update({ embeds: [makeEmbed(action === 'dice' ? 'لعبة النرد' : 'لعبة الرقم التقريبي', rules + '\nالرهان: **' + fmt(g.bet) + '** لكل لاعب.')], components: gameRows(g) });
  }
  if (action === 'roll') {
    if (g.status !== 'playing') return ephemeral(i, 'اللعبة ليست في مرحلة اللعب.');
    if (uid !== g.p1 && uid !== g.p2) return ephemeral(i, 'أنت لست أحد لاعبي هذا التحدي.');
    if (g.rolls[uid] !== undefined) return ephemeral(i, 'لقد لعبت دورك بالفعل.');
    g.rolls[uid] = g.mode === 'dice' ? crypto.randomInt(1, 7) : crypto.randomInt(1, 101);
    await save();
    if (g.rolls[g.p1] === undefined || g.rolls[g.p2] === undefined) {
      return i.update({ embeds: [makeEmbed('تم تسجيل دورك', 'تم تسجيل نتيجتك بشكل مخفي. بانتظار اللاعب الآخر.')], components: gameRows(g) });
    }
    const a = g.rolls[g.p1], b = g.rolls[g.p2];
    let winner = null;
    if (g.mode === 'dice') winner = a === b ? null : (a > b ? g.p1 : g.p2);
    else {
      const da = Math.abs(a - g.target), dbb = Math.abs(b - g.target);
      winner = da === dbb ? null : (da < dbb ? g.p1 : g.p2);
    }
    const result = g.mode === 'dice'
      ? '<@' + g.p1 + '> حصل على **' + a + '**\n<@' + g.p2 + '> حصل على **' + b + '**'
      : 'الرقم السري: **' + g.target + '**\n<@' + g.p1 + '> اختار **' + a + '**\n<@' + g.p2 + '> اختار **' + b + '**';
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
  if (user) await user.send((req.status === 'approved' ? 'تمت الموافقة على طلب السحب، والتسليم إن وجد يتم يدوياً من الإدارة.' : 'تم رفض طلب السحب وإرجاع الرصيد.') + ' المبلغ: ' + fmt(req.amount)).catch(() => {});
}

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  if (CFG.guild && message.guild.id !== CFG.guild) return;
  const text = message.content.trim();
  if (!text) return;
  const args = text.split(/\s+/);
  const cmd = args[0].toLowerCase();
  try {
    if (cmd === 'withdraw' && message.channel.id === CFG.withdrawRoom) return message.channel.send(withdrawPanel());
    if (['فلوس', 'money', 'رصيدي', 'balance'].includes(cmd)) return balance(message, message.mentions.users.first() || message.author);
    if (['توب', 'top'].includes(cmd)) {
      const top = Object.entries(db.users).sort((a, b) => b[1].coins - a[1].coins).slice(0, 10);
      const lines = await Promise.all(top.map(async ([id, data], i) => {
        const user = await client.users.fetch(id).catch(() => null);
        return '**' + (i + 1) + '.** ' + (user ? user.username : 'عضو') + ' — **' + fmt(data.coins) + '**';
      }));
      return message.reply({ embeds: [makeEmbed('🏆 أعلى الأرصدة', lines.length ? lines.join('\n') : 'لا توجد أرصدة مسجلة.')] });
    }
    if (cmd === 'add') return adminBalance(message, args, true);
    if (['rmv', 'remove'].includes(cmd)) return adminBalance(message, args, false);
    if (['تحدي', 'challenge'].includes(cmd)) return challenge(message, args);
    if (['مساعدة', 'help'].includes(cmd)) {
      return message.reply({ embeds: [makeEmbed('أوامر Batoot Casino',
        'فلوس — عرض الرصيد\nتوب — أعلى 10 أرصدة\nتحدي @عضو مبلغ — تحدٍ في رومات الألعاب\nwithdraw — لوحة السحب في روم السحب\nadd / rmv — للأونر والإدارة فقط')] });
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
    if (parts[0] === 'g') return gameButton(i, parts);
    if (parts[0] === 'w') return withdrawalButton(i, parts);
  } catch (error) {
    console.error('interactionCreate:', error);
    await ephemeral(i, 'حدث خطأ أثناء تنفيذ العملية. تواصل مع الإدارة إذا لاحظت تغييراً في رصيدك.');
  }
});

client.once('ready', async () => {
  console.log('Batoot Casino ready: ' + client.user.tag);
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
client.login(process.env.DISCORD_TOKEN);
