// npm i discord.js
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ---------- الإعدادات ----------
const TOKEN = process.env.DISCORD_TOKEN; // التوكن من متغيرات البيئة، لا تحطه في الكود
if (!TOKEN) throw new Error('ضع DISCORD_TOKEN في متغيرات البيئة');
const BANK_ID = '1483368871032520704';       // الحساب اللي يستلم الكريدت (نفس الايدي في #credit)
const PROBOT_BOT_ID = '282859044593598464';  // ايدي بوت ProBot نفسه
const COVER_TAX = false;                     // true = البوت يكتب مبلغ أكبر شوي (ضريبة 5%) عشان يوصل العضو المبلغ كامل
const PENDING_MINUTES = 15;                  // مدة انتظار التحويل بعد ما العضو يكتب "شحن"
const COLOR = 0xf0a500;                      // لون الايمبد (ذهبي)
const DB_FILE = './db.json';

// بونص الشحن: ضع الشرائح هنا (من الأكبر للأصغر). فاضي = بدون بونص
const BONUS_TIERS = [
  // { min: 100_000_000, percent: 10 },
  // { min: 10_000_000, percent: 5 },
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---------- قاعدة البيانات ----------
let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE)) : {};
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const get = (id) => db[id] ?? 0;
const fmt = (n) => Number(n).toLocaleString('en-US');

// ---------- أدوات ----------
function parseAmount(str) {
  if (!str) return null;
  const m = str.toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)(k|m|b)?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  const n = Math.floor(parseFloat(m[1]) * mult);
  return n > 0 ? n : null;
}

const getBonus = (amount) => {
  const t = BONUS_TIERS.find((x) => amount >= x.min);
  return t ? Math.floor((amount * t.percent) / 100) : 0;
};

const footer = (user) => ({
  text: `# Golden Dice. | ${new Date().toLocaleString('ar-EG', { hour12: false })}`,
  iconURL: user.displayAvatarURL(),
});

// ---------- الشحن التلقائي: قراءة رسالة تأكيد ProBot ----------
let pending = [];            // طلبات "شحن" المنتظرة
const handled = new Set();   // رسائل ProBot اللي تمت معالجتها
const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069*]/g;

async function handleProbot(msg) {
  if (handled.has(msg.id)) return;

  // يدعم رسالة بروبوت بالعربي والانجليزي:
  //   💰 | 6wssss, قام بتحويل `1$` لـ @user
  //   :moneybag: | 6wssss, has transferred `$1` to @user
  const text = msg.content.replace(INVISIBLE, '');
  const m = text.match(/(.+?),\s*(?:قام بتحويل|has transferred)\s*`?\$?\s*([\d,]+)\s*\$?`?/i);
  if (!m) return;
  if (!(text.includes(BANK_ID) || msg.mentions.users.has(BANK_ID))) return;

  const sender = m[1].split('|').pop().trim().toLowerCase();
  const received = parseInt(m[2].replace(/,/g, ''), 10);
  if (!received) return;

  const now = Date.now();
  pending = pending.filter((p) => p.expires > now);
  const i = pending.findIndex((p) =>
    p.names.some((n) => sender === n || sender.endsWith(' ' + n))
  );
  if (i === -1) return; // ما كتب "شحن" قبل

  handled.add(msg.id);
  const [req] = pending.splice(i, 1);
  const bonus = getBonus(received);
  db[req.userId] = get(req.userId) + received + bonus;
  save();

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setDescription('تم الشحن بنجاح')
    .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'المبلغ', value: `> ${fmt(received)}` },
      { name: '👤 المستلم', value: `> <@${req.userId}>` },
      { name: '💳 الرصيد الحالي', value: `> ${fmt(get(req.userId))}` },
      { name: '🎁 بونص الشحن', value: `> ${fmt(bonus)}` },
    )
    .setFooter(footer(req.user))
    .setTimestamp();

  await msg.channel.send({ content: `<@${req.userId}>`, embeds: [embed] });
}

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
      .setDescription(
        `💰 **${target.username}**\n\n` +
        `💳 **${fmt(get(target.id))}** كوين`
      )
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

    const amountStr = args.slice(1).find((a) => !/^<@!?\d+>$/.test(a));
    const amount = parseAmount(amountStr);
    if (!amount) return msg.reply('❌ اكتب مبلغ صحيح. مثال: `تحويل @العضو 500k`');
    if (get(msg.author.id) < amount) return msg.reply('❌ رصيدك غير كافي.');

    db[msg.author.id] = get(msg.author.id) - amount;
    db[target.id] = get(target.id) + amount;
    save();

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ تمت عملية التحويل بنجاح')
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '📤 المرسل', value: `${msg.author}`, inline: true },
        { name: '📥 المستلم', value: `${target}`, inline: true },
        { name: '💸 المبلغ', value: `**${fmt(amount)}** كوين`, inline: false },
        { name: '💳 رصيدك الآن', value: `${fmt(get(msg.author.id))} كوين`, inline: false },
      )
      .setFooter(footer(msg.author))
      .setTimestamp();
    return msg.reply({ embeds: [embed] });
  }

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
client.login("MTU3NTA2NDYyNjQxNTI4MDE1MA.GsS5i7.BoZfL-vl-spjW03YlvsK2NyU5LTvlKA62hQs7I");
