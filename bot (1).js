// npm i discord.js
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const wallet = require('./wallet');
const { setupChallenge } = require('./challenge');
const admin = require('./admin');
const settings = require('./settings');
const lottery = require('./lottery');
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
const isAdmin = (id) => ADMIN_IDS.includes(id);
const { setupWithdraw } = require('./withdraw');

// ---------- الإعدادات ----------
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) throw new Error('ضع DISCORD_TOKEN في متغيرات البيئة');
const BANK_ID = '1483368871032520704';       // الحساب اللي يستلم الكريدت
const PROBOT_BOT_ID = '282859044593598464';  // ايدي بوت ProBot
const COVER_TAX = false;                     // true = يكتب مبلغ أكبر (ضريبة 5%)
const PENDING_MINUTES = 15;                  // مدة انتظار التحويل بعد "شحن"
const COLOR = 0x2ecc71;
const TRANSFER_FEE = 5; // حق التحويل % (المستلم يوصله المبلغ ناقص الحق)

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const get = wallet.get;
const fmt = (n) => Number(n).toLocaleString('en-US');

function parseAmount(str) {
  if (!str) return null;
  const m = str.toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(k|m|b)?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  const n = Math.floor(parseFloat(m[1]) * mult);
  return n > 0 ? n : null;
}

const getBonus = (amount) => Math.floor((amount * settings.get('bonusPercent')) / 100);

const footer = (user) => ({
  text: "batoot casino",
  iconURL: user.displayAvatarURL(),
});

const challenge = setupChallenge(client, { fmt, parseAmount });
setupWithdraw(client, { fmt, parseAmount });

// ---------- الشحن التلقائي من ProBot ----------
let pending = [];
const handled = new Set();
const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069*]/g;

async function handleProbot(msg) {
  if (handled.has(msg.id)) return;

  // يدعم: "💰 | name, قام بتحويل `1$` لـ @user" و "| name, has transferred `$1` to @user"
  const text = msg.content.replace(INVISIBLE, '');
  const m = text.match(/(.+?),\s*(?:قام بتحويل|has transferred)\s*`?\$?\s*([\d,]+)\s*\$?`?/i);
  if (!m) return;
  if (!(text.includes(BANK_ID) || msg.mentions.users.has(BANK_ID))) return;

  const sender = m[1].split('|').pop().trim().toLowerCase();
  const received = parseInt(m[2].replace(/,/g, ''), 10);
  if (!received) return;

  const now = Date.now();
  pending = pending.filter((p) => p.expires > now);
  const i = pending.findIndex((p) => p.names.some((n) => sender === n || sender.endsWith(' ' + n)));
  if (i === -1) return;

  handled.add(msg.id);
  const [req] = pending.splice(i, 1);
  const bonus = getBonus(received);
  // msg.id يمنع إضافة نفس التحويل مرتين حتى لو أعيد التشغيل
  const ok = await wallet.credit(req.userId, received + bonus, msg.id);
  if (!ok) return;
  lottery.addTickets(req.userId, Math.floor(received / settings.get('ticketPrice')));

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setDescription('تم الشحن بنجاح')
    .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'المبلغ', value: `> ${fmt(received)}` },
      { name: '👤 المستلم', value: `> <@${req.userId}>` },
      { name: '💳 الرصيد الحالي', value: `> ${fmt(get(req.userId))}` },
      { name: '🎁 بونص الشحن', value: `> ${fmt(bonus)}` },
      { name: '🎟️ تذاكرك', value: `> ${fmt(lottery.myTickets(req.userId))}` },
    )
    .setFooter(footer(req.user))
    .setTimestamp();

  await msg.channel.send({ content: `<@${req.userId}>`, embeds: [embed] });
}

// ---------- الأوامر ----------
client.on('messageCreate', async (msg) => {
  if (!msg.guild) return;
  if (msg.author.id === PROBOT_BOT_ID) return handleProbot(msg);
  if (msg.author.bot) return;

  const args = msg.content.trim().split(/\s+/);
  const cmd = args[0];

  // ===== فلوس =====
  if (cmd === 'فلوس') {
    const target = msg.mentions.users.first() || msg.author;
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`الرصيد الحالي لـ ${target.username}`)
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .setDescription(`💰 **${target.username}**\n\n💳 **${fmt(get(target.id))}** كوين`)
      .setFooter(footer(msg.author))
      .setTimestamp();
    return msg.reply({ embeds: [embed] });
  }

  // ===== تحويل @العضو المبلغ =====
  if (cmd === 'تحويل') {
    const target = msg.mentions.users.first();
    if (!target) return msg.reply('❌ لم تقم بتحديد العضو!\nمثال: `تحويل @العضو 1m`');
    if (target.bot) return msg.reply('❌ ما تقدر تحول لبوت.');
    if (target.id === msg.author.id) return msg.reply('❌ ما تقدر تحول لنفسك.');

    const amount = parseAmount(args.slice(1).find((a) => !/^<@!?\d+>$/.test(a)));
    if (!amount) return msg.reply('❌ اكتب مبلغ صحيح. مثال: `تحويل @العضو 500k`');

    const fee = Math.floor((amount * TRANSFER_FEE) / 100);
    const received = amount - fee;
    const ok = await wallet.debit(msg.author.id, amount);
    if (!ok) return msg.reply('❌ رصيدك غير كافي.');
    await wallet.credit(target.id, received);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ تمت عملية التحويل بنجاح')
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '📤 المرسل', value: `${msg.author}`, inline: true },
        { name: '📥 المستلم', value: `${target}`, inline: true },
        { name: '💸 المبلغ', value: `**${fmt(amount)}** كوين`, inline: true },
        { name: '🧾 حق التحويل', value: `**${fmt(fee)}** كوين (${TRANSFER_FEE}%)`, inline: true },
        { name: '📥 وصل للمستلم', value: `**${fmt(received)}** كوين` },
        { name: '💳 رصيدك الآن', value: `${fmt(get(msg.author.id))} كوين` },
      )
      .setFooter(footer(msg.author))
      .setTimestamp();
    return msg.reply({ embeds: [embed] });
  }

  // ===== تحدي @العضو المبلغ =====
  if (cmd === 'تحدي') return challenge.handleCommand(msg, args);
  if (cmd === 'بوت') return challenge.handleBotCommand(msg, args);

  // ===== اليانصيب والبونص =====
  if (cmd === 'تذاكري') {
    return msg.reply(`🎟️ عندك **${fmt(lottery.myTickets(msg.author.id))}** تذكرة.`);
  }

  if (cmd === 'بونص') {
    if (!isAdmin(msg.author.id)) return msg.reply('❌ هذا الأمر للأدمن فقط.');
    const pct = Number(args[1]);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return msg.reply('❌ اكتب نسبة من 0 إلى 100. مثال: `بونص 5`');
    settings.set('bonusPercent', pct);
    return msg.reply(`✅ بونص الشحن صار **${pct}%**`);
  }

  if (cmd === 'يانصيب') {
    if (!isAdmin(msg.author.id)) return msg.reply('❌ هذا الأمر للأدمن فقط.');
    const prize = parseAmount(args[1]);
    if (!prize) return msg.reply('❌ اكتب قيمة الجائزة. مثال: `يانصيب 50m`');
    const res = await lottery.draw(prize);
    if (!res) return msg.reply('❌ ما فيه تذاكر حالياً.');
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('🎰 نتيجة اليانصيب')
      .setDescription(`🏆 الفائز: <@${res.winner}>\n💰 الجائزة: **${fmt(prize)}** كوين\n🎟️ عدد التذاكر: **${fmt(res.tickets)}**`)
      .setFooter({ text: 'batoot casino' })
      .setTimestamp();
    return msg.channel.send({ content: `<@${res.winner}>`, embeds: [embed] });
  }

  // ===== أدمن + متصدرين =====
  if (['اضافة', 'إضافة', 'خصم', 'توب'].includes(cmd)) return admin.handle(msg, args, cmd, { fmt, parseAmount, get });

  // ===== شحن 10m =====
  if (cmd === 'شحن') {
    const amount = parseAmount(args[1]);
    if (!amount) return msg.reply('❌ اكتب المبلغ. مثال: `شحن 10m`');

    pending.push({
      userId: msg.author.id,
      user: msg.author,
      names: [msg.author.username, msg.author.globalName, msg.member?.displayName]
        .filter(Boolean)
        .map((s) => s.toLowerCase()),
      expires: Date.now() + PENDING_MINUTES * 60 * 1000,
    });

    const toSend = COVER_TAX ? Math.floor((amount * 20) / 19 + 1) : args[1];
    return msg.reply(`#credit ${BANK_ID} ${toSend}`);
  }
});

client.once('ready', () => console.log(`جاهز: ${client.user.tag}`));
client.login(TOKEN);
