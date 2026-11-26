const { Client, Intents, MessageEmbed, MessageActionRow, MessageButton, Modal, TextInputComponent } = require("discord.js");
const mongoose = require("mongoose");
const dns = require("dns");
const fs = require("fs");
const { Probot } = require("discord-probot-transfer");
const db = require("./models/databaseusers");
const S7b = require("./models/s7b");
const game = require("./models_games/game");
const {
  chargeBotToken,
  probotId,
  ownertr,
  s7nguild,
  transferserverid,
  TAX_RATE,
  logsall,
  logChargeChannelId,
  logWithdrawChannelId,
  withdrawPanelChannelId,
  serverColor,
  owners,
  withdraw_results_channel,
  withdrawid,
} = require("./config.json");

const MONGO_URI = "mongodb+srv://ABod20844:JiCdK9u3oeLlYWDr@cluster0.jkq8v27.mongodb.net/?appName=Cluster0";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {}

const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS],
});
const activeRains = new Map();
function firstNonEmptyChannelId(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s !== "") return s;
  }
  return null;
}

/** قناة طلبات السحب + الأزرار (موافقة / رفض / إلغاء) */
const WITHDRAW_PANEL_CHANNEL_ID = firstNonEmptyChannelId(
  withdrawPanelChannelId,
  withdraw_results_channel,
  withdrawid
);
/** قناة اللوق فقط (موافقة، رفض، إلغاء، طلب جديد) — إن لم تُضبط تُستخدم قناة البانل */
const WITHDRAW_LOG_CHANNEL_ID = firstNonEmptyChannelId(
  logWithdrawChannelId,
  WITHDRAW_PANEL_CHANNEL_ID
);
const CHARGE_LOG_CHANNEL_ID = logChargeChannelId || logsall;

// حالة البونص النشط
let activeBonus = null;

function parseAmount(rawAmount) {
  if (!rawAmount) return null;
  const normalized = String(rawAmount).trim().toLowerCase().replace(/,/g, "");
  const match = normalized.match(/^(\d+)([kmbكمنب])?$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  const suffix = (match[2] || "").toLowerCase();
  const multipliers = { k: 1e3, m: 1e6, b: 1e9, ك: 1e3, م: 1e6, ب: 1e9, ن: 1e9 };
  return Math.floor(value * (multipliers[suffix] || 1));
}

async function getOrCreateUser(userId) {
  let userData = await db.findOne({ id: userId });
  if (!userData) {
    userData = await db.create({
      id: userId,
      coins: 0,
      prembank: 0,
      status_playing: "no",
      isontransfersure: "no",
      outcomingtransactions: 0,
    });
  }
  return userData;
}

function buildChargeEmbed(userId, oldBalance, addedAmount, newBalance, bonusInfo = null) {
  const embed = new MessageEmbed()
    .setColor(serverColor || "#39d353")
    .setTitle("تم الشحن بنجاح ✅")
    .setThumbnail("https://cdn.discordapp.com/emojis/1315409020508586014.png")
    .addFields(
      { name: "المستخدم 👤", value: `<@${userId}>`, inline: true },
      { name: "المبلغ الأصلي 💰", value: `\`${oldBalance.toLocaleString()}\``, inline: true },
      { name: "الرصيد الجديد 🧮", value: `\`${newBalance.toLocaleString()}\``, inline: true },
      { name: "المبلغ المضاف", value: `\`${addedAmount.toLocaleString()}\``, inline: false },
      { name: "الوقت", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    );

  if (bonusInfo) {
    embed.addFields(
      { name: "🎉 نسبة البونص", value: `\`${bonusInfo.percentage}%\``, inline: true },
      { name: "💰 مبلغ البونص", value: `\`${bonusInfo.amount.toLocaleString()}\``, inline: true }
    );
  }

  return embed
    .setFooter({ text: `ID:${Date.now()} ${new Date().toLocaleString("en-US")}` })
    .setTimestamp();
}

async function sendChargeLog(embed, channel) {
  if (channel) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
  if (CHARGE_LOG_CHANNEL_ID) {
    const logChannel = client.channels.cache.get(CHARGE_LOG_CHANNEL_ID);
    if (logChannel && (!channel || logChannel.id !== channel.id)) {
      await logChannel.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function isOwner(userId) {
  return owners.includes(String(userId));
}

function isBlacklisted(userId) {
  try {
    const content = fs.readFileSync("./blacklist.json", "utf8");
    const raw = JSON.parse(content);
    if (Array.isArray(raw)) return raw.map(String).includes(String(userId));
    if (raw && typeof raw === "object") {
      if (Array.isArray(raw.users)) return raw.users.map(String).includes(String(userId));
      return Object.prototype.hasOwnProperty.call(raw, String(userId));
    }
  } catch (_) {}
  return false;
}

function buildWithdrawPanelEmbed(guildName, guildIconURL) {
  return new MessageEmbed()
    .setTitle("💳 سحب رصيد")
    .setDescription(
      `لسحب رصيدك وتحويله إلى كريدت قم باتباع الخطوات التالية:
1️⃣ اضغط على الزر بالأسفل (طلب سحب)
2️⃣ اكتب القيمة التي تريد سحبها في الشات
3️⃣ ستصلك رسالة تأكيد السحب عند اكتمال العملية

**تنويه**:
- أقل مبلغ للسحب هو: **10,000,000**
- أعلى مبلغ للسحب هو: **9,999,999,999**
- قد تستغرق العملية **24 ساعة كحد أقصى**`
    )
    .setColor(serverColor || "#c8ae03")
    .setFooter({ text: guildName || "Withdraw System", iconURL: guildIconURL || undefined })
    .setTimestamp();
}

function buildWithdrawRequestEmbed(userId, amount, remainingBalance) {
  return new MessageEmbed()
    .setTitle("طلب سحب رصيد")
    .setColor(serverColor || "#c8ae03")
    .addFields(
      { name: "العضو", value: `<@${userId}>`, inline: true },
      { name: "المبلغ", value: `${amount.toLocaleString()}`, inline: true },
      { name: "الرصيد الحالي", value: `${remainingBalance.toLocaleString()}`, inline: true }
    )
    .setTimestamp();
}

async function sendWithdrawLog(title, color, fields, requestId) {
  if (!WITHDRAW_LOG_CHANNEL_ID) return;
  const logChannel = await client.channels.fetch(WITHDRAW_LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel) return;
  const embed = new MessageEmbed()
    .setTitle(title)
    .setColor(color)
    .addFields(fields)
    .setFooter({ text: `Request ID: ${requestId}` })
    .setTimestamp();
  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

function buildRainPanelEmbed({ amount, hostId, participantsCount, remainingSeconds }) {
  const eachAmount = participantsCount > 0 ? Math.floor(amount / participantsCount) : amount;
  return new MessageEmbed()
    .setColor(serverColor || "#4f46e5")
    .setTitle("Rain Panel ⛅")
    .setDescription("اضغط على الزر للمشاركة في الرين.")
    .addFields(
      { name: "المضيف", value: `<@${hostId}>`, inline: true },
      { name: "قيمة الجائزة", value: `\`${amount.toLocaleString()}\``, inline: true },
      { name: "المشاركين", value: `\`${participantsCount}\``, inline: true },
      { name: "نصيب كل مشارك الآن", value: `\`${eachAmount.toLocaleString()}\``, inline: true },
      { name: "الوقت المتبقي", value: `\`${formatSeconds(remainingSeconds)}\``, inline: true }
    )
    .setTimestamp();
}



function getBonusPercentage(minPercent, maxPercent) {
  // أقصى نسبة فعلية = 20% (حتى لو كتبت 70% في الأمر سيتم تجاهل الزيادة)
  const effectiveMax = Math.min(maxPercent, 25);
  if (effectiveMax <= minPercent) return minPercent;

  // النسب ≤ 15% تكون موزعة بشكل طبيعي
  if (effectiveMax <= 15) {
    return Math.floor(Math.random() * (effectiveMax - minPercent + 1)) + minPercent;
  }

  // النسب من 15% إلى 20% نادرة جداً (احتمال 2% فقط)
  const highChance = 0.02;
  if (Math.random() < highChance) {
    // بين 15% و 20%
    return Math.floor(Math.random() * (effectiveMax - 15 + 1)) + 15;
  } else {
    // بين minPercent و 15%
    const upperBound = Math.min(effectiveMax, 15);
    return Math.floor(Math.random() * (upperBound - minPercent + 1)) + minPercent;
  }
}

// Helper function to check if user meets bonus withdrawal condition
async function checkBonusWithdrawalCondition(userId) {
  const userData = await db.findOne({ id: userId });
  if (!userData) return { canWithdraw: true, reason: null };

  // Check if bonus is expired
  if (!userData.activeBonusId || !userData.bonusEndTime || Date.now() > userData.bonusEndTime) {
    // Bonus expired, can withdraw
    return { canWithdraw: true, reason: null };
  }

  // Bonus still active, check condition
  const rechargedAmount = userData.bonusRechargedAmount || 0;
  const bonusAmount = userData.bonusBonusAmount || 0;
  const playedAmount = userData.bonusPlayedAmount || 0;
  const condition = userData.bonusCondition;

  let requiredPlayAmount = 0;

  if (condition === "half") {
    // Must play at least 50% of the recharged amount
    requiredPlayAmount = Math.ceil(rechargedAmount * 0.5);
  } else if (condition === "bonus_only") {
    // Must play at least the bonus amount
    requiredPlayAmount = bonusAmount;
  } else if (condition === "full") {
    // Must play the full recharged amount
    requiredPlayAmount = rechargedAmount;
  }

  if (playedAmount >= requiredPlayAmount) {
    return { canWithdraw: true, reason: null };
  }

  return {
    canWithdraw: false,
    reason: `❌ لديك بونص نشط! لا يمكنك السحب حتى الآن.\n\n**معلومات البونص:**\n- الشرط: ${getConditionName(condition)}\n- المبلغ المطلوب لعبه: **${requiredPlayAmount.toLocaleString()}**\n- المبلغ الذي لعبته: **${playedAmount.toLocaleString()}**\n- المتبقي: **${Math.max(0, requiredPlayAmount - playedAmount).toLocaleString()}**\n- انتهاء البونص: <t:${Math.floor(userData.bonusEndTime / 1000)}:R>`,
    bonusActive: true,
    requiredPlayAmount,
    playedAmount,
    condition
  };
}

function getConditionName(condition) {
  const conditionNames = {
    "half": "لعب 50% من المبلغ المشحون",
    "bonus_only": "لعب مبلغ البونص فقط",
    "full": "لعب المبلغ المشحون كاملاً"
  };
  return conditionNames[condition] || "شرط غير معروف";
}

// Helper function to track played amount during games
async function trackGamePlayedAmount(userId, amountBet) {
  try {
    const userData = await db.findOne({ id: userId });
    if (!userData) return;

    // Check if user has active bonus
    if (!userData.activeBonusId || !userData.bonusEndTime || Date.now() > userData.bonusEndTime) {
      return; // Bonus expired
    }

    // Track the amount bet
    userData.bonusPlayedAmount = (userData.bonusPlayedAmount || 0) + Math.abs(amountBet);

    // Check if withdrawal condition is met
    const rechargedAmount = userData.bonusRechargedAmount || 0;
    const bonusAmount = userData.bonusBonusAmount || 0;
    const playedAmount = userData.bonusPlayedAmount;
    const condition = userData.bonusCondition;

    let requiredPlayAmount = 0;

    if (condition === "half") {
      requiredPlayAmount = Math.ceil(rechargedAmount * 0.5);
    } else if (condition === "bonus_only") {
      requiredPlayAmount = bonusAmount;
    } else if (condition === "full") {
      requiredPlayAmount = rechargedAmount;
    }

    if (playedAmount >= requiredPlayAmount) {
      userData.bonusWithdrawalAllowed = true;
    }

    await userData.save().catch(() => {});
  } catch (e) {
    console.error("Error tracking game played amount:", e);
  }
}

// dالة توليد نسبة عشوائية مع ندرة النسب العالية
client.once("ready", () => {
  console.log(`Charge bot ready as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const ohelpNorm = String(message.content || "")
    .replace(/[\u200B-\u200D\uFEFF\u061C\u2066-\u2069]/g, "")
    .trim()
    .toLowerCase();
  if (ohelpNorm === "ohelp" || ohelpNorm === "!ohelp") {
    const isOwn = owners.some((o) => String(o) === String(message.author.id));
    if (!isOwn) {
      return message.reply("❌ أمر `ohelp` للأونر فقط.").catch(() => {});
    }
    return message
      .reply(
        "📘 **دليل الأونر (`ohelp`)** يعمل على **البوت الرئيسي** (`index.js`) وليس على بوت الشحن.\n" +
          "افتح روماً في السيرفر حيث يعمل البوت الرئيسي واكتب: `ohelp`"
      )
      .catch(() => {});
  }

  const trimmed = (message.content || "").trim();
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();

  if (cmd === "!withdrawpanel") {
    if (!message.guild) return;
    if (!isOwner(message.author.id)) return;
    if (!WITHDRAW_PANEL_CHANNEL_ID) {
      return message.reply("❌ لم يُضبط `withdrawPanelChannelId` أو قنوات السحب في config.json").catch(() => {});
    }

    const panelChannel = await client.channels.fetch(WITHDRAW_PANEL_CHANNEL_ID).catch(() => null);
    if (!panelChannel || !panelChannel.isText()) {
      return message.reply("❌ قناة بانل السحب غير موجودة أو ليست قناة نصية.").catch(() => {});
    }

    const button = new MessageButton().setCustomId("s7bb").setLabel("طلب سحب").setStyle("SECONDARY");
    const row = new MessageActionRow().addComponents(button);
    const guildForEmbed = panelChannel.guild || message.guild;
    const panelEmbed = buildWithdrawPanelEmbed(
      guildForEmbed.name,
      guildForEmbed.iconURL ? guildForEmbed.iconURL({ dynamic: true }) : null
    );
    await panelChannel.send({ embeds: [panelEmbed], components: [row] }).catch(() => {});
    await message.delete().catch(() => {});
    return;
  }

  // أمر تفعيل البونص (#bonus)
  if (cmd === "#bonus") {
    if (!owners.includes(message.author.id)) {
      return message.reply("❌ هذا الأمر مخصص للمالكين فقط.").catch(() => {});
    }

    const rangeStr = parts[1];
    const timeStr = parts[2];
    const conditionStr = parts[3]; // الشرط: half, bonus_only, full

    if (!rangeStr || !timeStr || !conditionStr) {
      return message.reply(
        "❌ الصيغة الصحيحة:\n" +
        "`#bonus <النسبة> <المدة> <الشرط>`\n\n" +
        "**أمثلة النسب:**\n`10-70` أو `10%-70%`\n\n" +
        "**أمثلة المدة:**\n`2h30m` أو `1h` أو `45m`\n\n" +
        "**الشروط المتاحة:**\n" +
        "`half` - لعب 50% من المبلغ المشحون\n" +
        "`bonus_only` - لعب مبلغ البونص فقط\n" +
        "`full` - لعب المبلغ المشحون كاملاً (الشحن + البونص)\n\n" +
        "**مثال كامل:**\n`#bonus 10-70 2h30m half`"
      ).catch(() => {});
    }

    // التحقق من صحة الشرط
    const validConditions = ["half", "bonus_only", "full"];
    if (!validConditions.includes(conditionStr.toLowerCase())) {
      return message.reply(
        "❌ الشرط غير صحيح!\n\n**الشروط المتاحة:**\n" +
        "`half` - لعب 50% من المبلغ المشحون\n" +
        "`bonus_only` - لعب مبلغ البونص فقط\n" +
        "`full` - لعب المبلغ المشحون كاملاً"
      ).catch(() => {});
    }

    const condition = conditionStr.toLowerCase();

    const rangeMatch = rangeStr.match(/^(\d{1,3})-(\d{1,3})%?$/);
    if (!rangeMatch) {
      return message.reply("❌ نطاق غير صالح. استخدم صيغة مثل `10-70` أو `10%-70%`").catch(() => {});
    }

    const minPercent = parseInt(rangeMatch[1], 10);
    const maxPercent = parseInt(rangeMatch[2], 10);
    if (isNaN(minPercent) || isNaN(maxPercent) || minPercent < 0 || maxPercent > 10001 || minPercent > maxPercent) {
      return message.reply("❌ النطاق يجب أن يكون من 0% إلى 1001% والحد الأدنى ≤ الأقصى.").catch(() => {});
    }

    // تحليل الوقت: يدعم صيغ مثل 2h30m , 1h , 45m , 90m , 1.5h
    let totalMinutes = 0;
    const hourMatch = timeStr.match(/(\d+(?:\.\d+)?)\s*h/i);
    const minuteMatch = timeStr.match(/(\d+(?:\.\d+)?)\s*m/i);
    if (hourMatch) totalMinutes += parseFloat(hourMatch[1]) * 60;
    if (minuteMatch) totalMinutes += parseFloat(minuteMatch[1]);
    if (totalMinutes <= 0) {
      return message.reply("❌ المدة غير صالحة. استخدم مثل `2h30m` أو `1h` أو `45m`.").catch(() => {});
    }

    const durationMs = totalMinutes * 60 * 1000;
    const now = Date.now();
    const expiresAt = now + durationMs;
    const expireTimestamp = Math.floor(expiresAt / 1000);

    // إلغاء بونص قديم إن وجد
    if (activeBonus) {
      if (activeBonus.timeout) clearTimeout(activeBonus.timeout);
      if (activeBonus.updateInterval) clearInterval(activeBonus.updateInterval);
    }

    // إنشاء حالة البونص الجديدة
    const bonusId = `bonus_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    activeBonus = {
      bonusId,
      minPercent,
      maxPercent,
      expiresAt,
      condition,
      timeout: setTimeout(() => {
        // انتهاء تلقائي
        if (activeBonus) {
          if (activeBonus.updateInterval) clearInterval(activeBonus.updateInterval);
          activeBonus = null;
        }
      }, durationMs),
      updateInterval: null,
      message: null,
      hostId: message.author.id,
    };

    // تجهيز الإيمبد الأولي
    const conditionDisplay = getConditionName(condition);
    const embed = new MessageEmbed()
      .setColor(serverColor || "#c8ae03")
      .setTitle("🎉 تفعيل بونص عام جديد! 😍")
      .setDescription("كل عملية شحن ستحصل على نسبة عشوائية جديدة! 😍")
      .addFields(
        { name: "👤 المضيف", value: `<@${message.author.id}>`, inline: true },
        { name: "🎲 نطاق النسبة", value: `\`${minPercent}%\` - \`${maxPercent}%\``, inline: true },
        { name: "🎯 الشرط المطلوب", value: `\`${conditionDisplay}\``, inline: true },
        { name: "⏳ ينتهي بعد", value: `<t:${expireTimestamp}:R>`, inline: true },
        { name: "📅 وقت الانتهاء", value: `<t:${expireTimestamp}:F>`, inline: false },
        { name: "ℹ️ ملاحظة", value: `كل مستخدم يشحن سيحصل على نسبة عشوائية ضمن النطاق المحدد، لكن سيتمكن من السحب فقط بعد: **${conditionDisplay}**` }
      )
      .setFooter({ text: "Super Bank [APP] • استخدم #stopbonus للإيقاف" })
      .setTimestamp();

    const replyMsg = await message.reply({ embeds: [embed] }).catch(() => {});
    if (replyMsg) {
      activeBonus.message = replyMsg;
    }

    // دالة تحديث العداد التنازلي (كل 30 ثانية)
    const updateEmbed = async () => {
      if (!activeBonus || !activeBonus.message) return;
      const remainingMs = activeBonus.expiresAt - Date.now();
      if (remainingMs <= 0) {
        if (activeBonus.updateInterval) clearInterval(activeBonus.updateInterval);
        const endedEmbed = new MessageEmbed(activeBonus.message.embeds[0] || embed)
          .setTitle("⏰ انتهى البونص العام")
          .setDescription("انتهت صلاحية البونص العشوائي.")
          .spliceFields(2, 1, { name: "⏳ الحالة", value: "منتهي", inline: true });
        await activeBonus.message.edit({ embeds: [endedEmbed] }).catch(() => {});
        activeBonus = null;
        return;
      }

      const newEmbed = new MessageEmbed(activeBonus.message.embeds[0] || embed)
        .spliceFields(2, 1, { name: "⏳ ينتهي بعد", value: `<t:${Math.floor(activeBonus.expiresAt / 1000)}:R>`, inline: true });
      await activeBonus.message.edit({ embeds: [newEmbed] }).catch(() => {});
    };

    activeBonus.updateInterval = setInterval(updateEmbed, 30_000);
    return;
  }

  // أمر إيقاف البونص (#stopbonus)
  if (cmd === "#stopbonus") {
    if (!owners.includes(message.author.id)) {
      return message.reply("❌ هذا الأمر مخصص للمالكين فقط.").catch(() => {});
    }

    if (!activeBonus) {
      return message.reply("❌ لا يوجد بونص نشط حاليًا.").catch(() => {});
    }

    if (activeBonus.timeout) clearTimeout(activeBonus.timeout);
    if (activeBonus.updateInterval) clearInterval(activeBonus.updateInterval);

    if (activeBonus.message) {
      const stoppedEmbed = new MessageEmbed(activeBonus.message.embeds[0])
        .setTitle("🛑 تم إيقاف البونص")
        .setDescription("تم إيقاف البونص من قبل أحد المالكين.")
        .spliceFields(2, 1, { name: "⏳ الحالة", value: "متوقف", inline: true });
      await activeBonus.message.edit({ embeds: [stoppedEmbed] }).catch(() => {});
    }

    activeBonus = null;
    await message.reply("✅ تم إيقاف البونص العام بنجاح.").catch(() => {});
    return;
  }

  // باقي الأوامر القديمة
  if (cmd === "شحن") {
    const amount = parseAmount(parts[1]);
    const target = `<@${ownertr}>`;
    const content = amount ? `c ${target} ${amount}` : `c ${target}`;
    await message.reply({ content }).catch(() => {});
    return;
  }

  if (cmd === "نكح") {
    const targetMember = message.mentions.members.first();
    if (!targetMember || targetMember.user.bot) {
      await message.reply("❌ منشن عضو صحيح: `نكح @user`").catch(() => {});
      return;
    }
    if (!message.guild) {
      await message.reply("❌ هذا الأمر يعمل داخل السيرفر فقط.").catch(() => {});
      return;
    }
    if (!message.member.permissions.has("BAN_MEMBERS")) {
      await message.reply("❌ ما عندك صلاحية `BAN_MEMBERS`.").catch(() => {});
      return;
    }
    if (!targetMember.bannable) {
      await message.reply("❌ ما أقدر أبند هذا العضو (رتبته أعلى أو صلاحيات البوت ناقصة).").catch(() => {});
      return;
    }

    await targetMember.user.send("تم نكحك من قبل عمك").catch(() => {});
    await message.guild.members
      .ban(targetMember.id, { reason: `By ${message.author.tag} via نجح command` })
      .then(() => message.reply(`✅ تم النكح بنجاح ${targetMember.user.tag} بنجاح.`).catch(() => {}))
      .catch(() => message.reply("❌ العضو غير قابل للنكح.").catch(() => {}));
    return;
  }

  if (cmd === "come") {
    if (!message.guild || !message.member) {
      await message.reply("❌ الأمر يعمل داخل السيرفر فقط.").catch(() => {});
      return;
    }
    if (!message.member.permissions.has("ADMINISTRATOR")) {
      await message.reply("❌ أمر `come` للي معهم صلاحية **Administrator** فقط.").catch(() => {});
      return;
    }
    const targetUser = message.mentions.users.first();
    if (!targetUser || targetUser.bot) {
      await message.reply("❌ منشن شخص حقيقي: `come @user`").catch(() => {});
      return;
    }
    await targetUser
      .send(
        `تم استدعاؤك من طرف ${message.author} إلى روم ${message.channel} في سيرفر **${message.guild?.name || "Unknown"}**.`
      )
      .then(() => message.reply("✅ تم إرسال الاستدعاء  بنجاح.").catch(() => {}))
      .catch(() => message.reply("❌ ما قدرت أرسل له رسالة خاصة.").catch(() => {}));
    return;
  }

  if (cmd === "cancelrain" || cmd === "!cancelrain") {
    const rainState = activeRains.get(message.channel.id);
    if (!rainState) {
      await message.reply("❌ لا يوجد Rain نشط في هذا الروم.").catch(() => {});
      return;
    }
    if (message.author.id !== rainState.hostId && message.author.id !== String(ownertr) && !owners.some((o) => String(o) === String(message.author.id))) {
      await message.reply("❌ فقط صاحب الرين أو أونر يقدر يوقفه.").catch(() => {});
      return;
    }

    rainState.cancelled = true;
    if (rainState.intervalId) clearInterval(rainState.intervalId);
    if (rainState.collector) rainState.collector.stop("cancelled");

    if (!rainState.houseFunded) {
      const hostUser = await getOrCreateUser(rainState.hostId);
      hostUser.coins += rainState.amount;
      await hostUser.save().catch(() => {});
    }

    const disabledRow = new MessageActionRow().addComponents(
      new MessageButton().setCustomId("rain_join").setLabel("تم إلغاء الرين").setStyle("DANGER").setDisabled(true)
    );
    const cancelDesc = rainState.houseFunded
      ? `تم إلغاء الرين من طرف ${message.author}.`
      : `تم إلغاء الرين من طرف ${message.author} وتم إرجاع المبلغ لصاحب الرين.`;
    const cancelledEmbed = buildRainPanelEmbed({
      amount: rainState.amount,
      hostId: rainState.hostId,
      participantsCount: rainState.participants.size,
      remainingSeconds: 0,
    }).setDescription(cancelDesc);

    if (rainState.rainMsg) {
      await rainState.rainMsg.edit({ embeds: [cancelledEmbed], components: [disabledRow] }).catch(() => {});
    }
    activeRains.delete(message.channel.id);
    await message.reply("✅ تم إلغاء الرين بنجاح.").catch(() => {});
    return;
  }

  if (cmd === "rain" || cmd === "!rain") {
    if (!owners.some((o) => String(o) === String(message.author.id))) {
      await message.reply("❌ أمر الرين للأونرز فقط.").catch(() => {});
      return;
    }
    if (activeRains.has(message.channel.id)) {
      await message.reply("❌ يوجد Rain شغال حاليًا في هذا الروم، انتظر حتى ينتهي.").catch(() => {});
      return;
    }

    const amount = parseAmount(parts[1]);
    if (!amount || amount <= 0) {
      await message.reply("❌ الصيغة: `!rain <amount>`").catch(() => {});
      return;
    }

    const houseFunded = true;

    const durationSeconds = 100;
    const rainState = {
      hostId: message.author.id,
      amount,
      participants: new Set(),
      endsAt: Date.now() + durationSeconds * 1000,
      intervalId: null,
      collector: null,
      rainMsg: null,
      cancelled: false,
      houseFunded,
    };

    const initialEmbed = buildRainPanelEmbed({
      amount,
      hostId: message.author.id,
      participantsCount: 0,
      remainingSeconds: durationSeconds,
    });
    const joinButton = new MessageButton()
      .setCustomId("rain_join")
      .setLabel("مشاركة")
      .setStyle("SUCCESS");
    const row = new MessageActionRow().addComponents(joinButton);
    const rainMsg = await message.channel.send({ embeds: [initialEmbed], components: [row] }).catch(() => null);
    if (!rainMsg) {
      return;
    }
    rainState.rainMsg = rainMsg;

    activeRains.set(message.channel.id, rainState);

    const collector = rainMsg.createMessageComponentCollector({
      filter: (i) => i.customId === "rain_join" && i.user.id !== message.author.id && !i.user.bot,
      time: durationSeconds * 1000,
    });
    rainState.collector = collector;

    collector.on("collect", async (interaction) => {
      rainState.participants.add(interaction.user.id);
      const remainingSeconds = Math.max(0, Math.ceil((rainState.endsAt - Date.now()) / 1000));
      const updatedEmbed = buildRainPanelEmbed({
        amount: rainState.amount,
        hostId: rainState.hostId,
        participantsCount: rainState.participants.size,
        remainingSeconds,
      });
      await interaction.update({ embeds: [updatedEmbed], components: [row] }).catch(() => {});
    });

    rainState.intervalId = setInterval(async () => {
      const remainingSeconds = Math.max(0, Math.ceil((rainState.endsAt - Date.now()) / 1000));
      const updatedEmbed = buildRainPanelEmbed({
        amount: rainState.amount,
        hostId: rainState.hostId,
        participantsCount: rainState.participants.size,
        remainingSeconds,
      });
      await rainMsg.edit({ embeds: [updatedEmbed], components: [row] }).catch(() => {});
      if (remainingSeconds <= 0) clearInterval(rainState.intervalId);
    }, 1000);

    collector.on("end", async () => {
      if (rainState.intervalId) clearInterval(rainState.intervalId);
      if (rainState.cancelled) return;
      activeRains.delete(message.channel.id);

      const participants = [...rainState.participants];
      const disabledRow = new MessageActionRow().addComponents(
        new MessageButton().setCustomId("rain_join").setLabel("انتهى الرين").setStyle("SECONDARY").setDisabled(true)
      );

      if (!participants.length) {
        const noOneDesc = rainState.houseFunded
          ? "انتهى الرين بدون مشاركين."
          : "انتهى الرين بدون مشاركين، تم إرجاع المبلغ لصاحب الرين.";
        const noOneEmbed = buildRainPanelEmbed({
          amount: rainState.amount,
          hostId: rainState.hostId,
          participantsCount: 0,
          remainingSeconds: 0,
        }).setDescription(noOneDesc);
        await rainMsg.edit({ embeds: [noOneEmbed], components: [disabledRow] }).catch(() => {});
        return;
      }

      const eachAmount = Math.floor(rainState.amount / participants.length);
      const totalDistributed = eachAmount * participants.length;
      const refund = rainState.amount - totalDistributed;

      if (refund > 0 && !rainState.houseFunded) {
        const senderRefund = await getOrCreateUser(rainState.hostId);
        senderRefund.coins += refund;
        await senderRefund.save().catch(() => {});
      }

      for (const participantId of participants) {
        await db.updateOne(
          { id: participantId },
          {
            $inc: { coins: eachAmount },
            $setOnInsert: {
              id: participantId,
              prembank: 0,
              status_playing: "no",
              isontransfersure: "no",
              outcomingtransactions: 0,
            },
          },
          { upsert: true }
        );
      }

      const finalEmbed = buildRainPanelEmbed({
        amount: rainState.amount,
        hostId: rainState.hostId,
        participantsCount: participants.length,
        remainingSeconds: 0,
      })
        .setDescription("انتهى الرين وتم توزيع الجائزة تلقائيًا على المشاركين.")
        .addField("المبلغ الموزع", `\`${totalDistributed.toLocaleString()}\``, true)
        .addField("نصيب كل مشارك", `\`${eachAmount.toLocaleString()}\``, true);
      await rainMsg.edit({ embeds: [finalEmbed], components: [disabledRow] }).catch(() => {});
    });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "s7bb") {
    const modal = new Modal()
      .setCustomId("s7b_modal")
      .setTitle("طلب سحب")
      .addComponents(
        new MessageActionRow().addComponents(
          new TextInputComponent()
            .setCustomId("amount")
            .setLabel("المبلغ المطلوب")
            .setStyle("SHORT")
            .setPlaceholder("أدخل المبلغ هنا")
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  // Only handle withdrawal-related button interactions
  const customId = String(interaction.customId || "");
  if (!customId.includes("_")) return;
  
  const [action, userId] = customId.split("_");
  
  // Only handle withdrawal actions (approve, reject, s7binfo, cancels7b)
  if (!["approve", "reject", "s7binfo", "cancels7b"].includes(action)) return;
  if (!userId) return;

  const s7bData = await S7b.findOne({ user: userId });
  if (!s7bData) {
    return interaction.reply({ content: "❌ لا يوجد طلب سحب لهذا المستخدم.", ephemeral: true });
  }

  if (["approve", "reject", "s7binfo"].includes(action) && !isOwner(interaction.user.id)) {
    return interaction.reply({ content: "❌ هذا الإجراء مخصص للملاك فقط.", ephemeral: true });
  }

  if (action === "approve") {
    try {
      const configPath = "./config.json";
      const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
      rawConfig.totalwithdraw = (parseInt(rawConfig.totalwithdraw, 10) || 0) + Number(s7bData.coins || 0);
      fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2), "utf8");
    } catch (_) {}

    await interaction.message.edit({ content: "✅ تم الموافقة على السحب!", components: [] }).catch(() => {});
    await S7b.deleteOne({ user: userId }).catch(() => {});

    const guildMember = await interaction.guild?.members.fetch(userId).catch(() => null);
    if (guildMember) {
      const dmEmbed = new MessageEmbed()
        .setTitle("✅ تمت الموافقة على السحب")
        .setColor("#00FF00")
        .setDescription(`تم تسليم عملية السحب الخاصة بك بنجاح.\nالمبلغ المسحوب: **${Number(s7bData.coins).toLocaleString()}**`)
        .setTimestamp();
      await guildMember.send({ embeds: [dmEmbed] }).catch(() => {});
    }

    await sendWithdrawLog(
      "✅ تمت الموافقة على السحب",
      "#00FF00",
      [
        { name: "العضو", value: `<@${userId}>\n\`${userId}\``, inline: true },
        { name: "المبلغ المسحوب", value: `${Number(s7bData.coins).toLocaleString()}`, inline: true },
        { name: "تمت الموافقة بواسطة", value: `<@${interaction.user.id}>`, inline: true },
        { name: "الوقت", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      ],
      interaction.message.id
    );
    return interaction.deferUpdate();
  }

  if (action === "reject") {
    await db.updateOne({ id: userId }, { $inc: { coins: Number(s7bData.coins || 0) } }).catch(() => {});
    const userData = await db.findOne({ id: userId });
    await interaction.message.edit({ content: "❌ تم رفض السحب.", components: [] }).catch(() => {});
    await S7b.deleteOne({ user: userId }).catch(() => {});

    await sendWithdrawLog(
      "❌ تم رفض السحب",
      "#FF0000",
      [
        { name: "العضو", value: `<@${userId}>\n\`${userId}\``, inline: true },
        { name: "المبلغ", value: `${Number(s7bData.coins).toLocaleString()}`, inline: true },
        { name: "تم الرفض بواسطة", value: `<@${interaction.user.id}>`, inline: true },
        { name: "الرصيد المُعاد", value: `${Number(userData?.coins || 0).toLocaleString()}`, inline: true },
        { name: "الوقت", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      ],
      interaction.message.id
    );
    return interaction.deferUpdate();
  }

  if (action === "s7binfo") {
    const command = `اسحب ${userId} ${s7bData.coins}`;
    return interaction.reply({ content: command, ephemeral: true });
  }

  if (action === "cancels7b") {
    if (interaction.user.id !== userId) {
      return interaction.reply({ content: "❌ لا يمكنك إلغاء طلب شخص آخر!", ephemeral: true });
    }

    await interaction.message.edit({ content: "🚫 تم إلغاء طلب السحب من قبل المستخدم.", components: [] }).catch(() => {});
    await db.updateOne({ id: userId }, { $inc: { coins: Number(s7bData.coins || 0) } }).catch(() => {});
    await S7b.deleteOne({ user: userId }).catch(() => {});
    const updated = await db.findOne({ id: userId });

    await sendWithdrawLog(
      "🚫 تم إلغاء السحب",
      "#808080",
      [
        { name: "العضو", value: `<@${userId}>\n\`${userId}\``, inline: true },
        { name: "المبلغ", value: `${Number(s7bData.coins).toLocaleString()}`, inline: true },
        { name: "تم الإلغاء بواسطة", value: `<@${userId}> (المستخدم نفسه)`, inline: true },
        { name: "الرصيد بعد الإعادة", value: `${Number(updated?.coins || 0).toLocaleString()}`, inline: true },
        { name: "الوقت", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      ],
      interaction.message.id
    );
    return interaction.reply({ content: "✅ تم إلغاء طلب السحب وإعادة المبلغ إلى رصيدك.", ephemeral: true });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== "s7b_modal") return;

  const userId = interaction.user.id;
  if (isBlacklisted(userId)) {
    return interaction.reply({
      content: "⛔ **تم رفض طلبك للسحب. أنت موجود في القائمة السوداء.**",
      ephemeral: true,
    });
  }

  if (!WITHDRAW_PANEL_CHANNEL_ID) {
    return interaction.reply({
      content: "❌ قناة طلبات السحب غير مُعرّفة في الإعدادات (`withdrawPanelChannelId`).",
      ephemeral: true,
    });
  }

  // CHECK: Bonus withdrawal condition
  const bonusCheck = await checkBonusWithdrawalCondition(userId);
  if (!bonusCheck.canWithdraw) {
    return interaction.reply({
      content: bonusCheck.reason || "❌ لا يمكنك السحب في الوقت الحالي.",
      ephemeral: true,
    });
  }

  const amount = parseInt(interaction.fields.getTextInputValue("amount"), 10);
  if (isNaN(amount) || amount < 10000000 || amount > 9999999999) {
    return interaction.reply({
      content: "❌ يرجي ادخال مبلغ مابين 10,000,000 الي 9,999,999,999",
      ephemeral: true,
    });
  }

  let userData = await db.findOne({ id: userId });
  if (!userData || userData.coins < amount) {
    return interaction.reply({ content: "❌ ليس لديك رصيد كافٍ.", ephemeral: true });
  }

  const existingS7b = await S7b.findOne({ user: userId });
  if (existingS7b) {
    return interaction.reply({
      content: "❌ لديك طلب سحب جاري بالفعل. لا يمكنك تقديم طلب جديد حتى يتم تسليمك.",
      ephemeral: true,
    });
  }

  if (userData.isontransfersure === "yes") {
    return interaction.reply({ content: "⚠️ لا يمكنك السحب اثناء تحويل رصيد لشخص اخر", ephemeral: true });
  }
  if (userData.status_playing === "yes") {
    return interaction.reply({ content: "⚠️ لا يمكنك السحب اثناء تحدي", ephemeral: true });
  }

  const activeGame = await game.findOne({ $or: [{ id: userId }, { with: userId }] });
  if (activeGame) {
    return interaction.reply({ content: "⚠️ لا يمكنك السحب أثناء وجود تحدي نشط.", ephemeral: true });
  }

  await S7b.create({ user: userId, msgID: "0", channelID: "0", coins: amount, status: "pending" });
  await interaction.reply({ content: "⏳ جاري معالجة طلب السحب...", ephemeral: true });

  userData = await db.findOne({ id: userId });
  if (!userData || userData.coins < amount) {
    await S7b.deleteOne({ user: userId }).catch(() => {});
    return interaction.followUp({ content: "❌ رصيدك غير كافٍ للسحب.", ephemeral: true });
  }

  if (userData.isontransfersure === "yes" || userData.status_playing === "yes") {
    await S7b.deleteOne({ user: userId }).catch(() => {});
    return interaction.followUp({ content: "⚠️ لا يمكنك السحب حالياً بسبب عملية نشطة.", ephemeral: true });
  }

  const activeGameCheck = await game.findOne({ $or: [{ id: userId }, { with: userId }] });
  if (activeGameCheck) {
    await S7b.deleteOne({ user: userId }).catch(() => {});
    return interaction.followUp({ content: "⚠️ لا يمكنك السحب أثناء وجود تحدي نشط.", ephemeral: true });
  }

  userData.coins -= amount;
  await userData.save().catch(() => {});

  const row = new MessageActionRow().addComponents(
    new MessageButton().setCustomId(`approve_${userId}`).setLabel("✅ موافقة").setStyle("SUCCESS"),
    new MessageButton().setCustomId(`reject_${userId}`).setLabel("❌ رفض").setStyle("DANGER"),
    new MessageButton().setCustomId(`cancels7b_${userId}`).setLabel("🚫 إلغاء").setStyle("SECONDARY"),
    new MessageButton().setCustomId(`s7binfo_${userId}`).setEmoji("ℹ️").setStyle("SECONDARY")
  );

  const withdrawChannel = await client.channels.fetch(WITHDRAW_PANEL_CHANNEL_ID).catch(() => null);
  if (!withdrawChannel) {
    await db.updateOne({ id: userId }, { $inc: { coins: amount } }).catch(() => {});
    await S7b.deleteOne({ user: userId }).catch(() => {});
    return interaction.followUp({ content: "❌ تعذر الوصول لقناة طلبات السحب (`withdrawPanelChannelId`). تم إرجاع الرصيد.", ephemeral: true });
  }

  const reqEmbed = buildWithdrawRequestEmbed(userId, amount, Number(userData.coins || 0));
  const sentMessage = await withdrawChannel.send({ embeds: [reqEmbed], components: [row] }).catch(() => null);
  if (!sentMessage) {
    await db.updateOne({ id: userId }, { $inc: { coins: amount } }).catch(() => {});
    await S7b.deleteOne({ user: userId }).catch(() => {});
    return interaction.followUp({ content: "❌ تعذر إرسال الطلب. تم إرجاع الرصيد.", ephemeral: true });
  }

  await S7b.findOneAndUpdate(
    { user: userId },
    { msgID: sentMessage.id, channelID: sentMessage.channel.id, status: "active" }
  ).catch(() => {});

  await sendWithdrawLog(
    "📝 طلب سحب جديد",
    "#FFA500",
    [
      { name: "العضو", value: `<@${userId}>\n\`${userId}\``, inline: true },
      { name: "المبلغ", value: `${amount.toLocaleString()}`, inline: true },
      { name: "الرصيد المتبقي", value: `${Number(userData.coins || 0).toLocaleString()}`, inline: true },
      { name: "الحالة", value: "⏳ قيد الانتظار", inline: true },
      { name: "الوقت", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
    ],
    sentMessage.id
  );

  return interaction.followUp({ content: "✅ تم تقديم طلب السحب.", ephemeral: true });
});

client.probot = Probot(client, {
  fetchGuilds: true,
  data: [
    {
      fetchMembers: true,
      guildId: s7nguild || transferserverid,
      probotId: probotId,
      owners: [ownertr],
    },
  ],
});

client.probot.on("transfered", async (_guild, data, err) => {
  if (err) return console.log(err);
  const { member, price, isOwner, channel } = data || {};
  const chargedUserId = String(member?.id || data?.memberId || data?.user?.id || "");
  const transferTargetId = String(data?.to?.id || data?.owner?.id || data?.receiver?.id || "");

  if (!isOwner || !chargedUserId) return;
  if (transferTargetId && transferTargetId !== String(ownertr)) return;

  const baseCredit = Math.max(0, Math.floor(Number(price) || 0));
  if (baseCredit <= 0) return;

  const taxValue = Math.floor(baseCredit * Number(0));
  const netAmount = Math.max(0, baseCredit - taxValue);

  let bonusAmount = 0;
  let bonusPercentage = 0;

  // التحقق من وجود بونص نشط
  if (activeBonus && Date.now() < activeBonus.expiresAt) {
    bonusPercentage = getBonusPercentage(activeBonus.minPercent, activeBonus.maxPercent);
    bonusAmount = Math.ceil(baseCredit * (bonusPercentage / 100));
  }

  const totalAdd = netAmount + bonusAmount;
  const userData = await getOrCreateUser(chargedUserId);
  const beforeCoins = Number(userData.coins || 0);
  userData.coins = beforeCoins + totalAdd;

  // If there's an active bonus, track it for the user
  if (bonusAmount > 0 && activeBonus) {
    userData.activeBonusId = activeBonus.bonusId;
    userData.bonusRechargedAmount = netAmount;
    userData.bonusBonusAmount = bonusAmount;
    userData.bonusPlayedAmount = 0;
    userData.bonusEndTime = new Date(activeBonus.expiresAt);
    userData.bonusCondition = activeBonus.condition;
    userData.bonusWithdrawalAllowed = false;
  }

  await userData.save().catch(() => {});

  // إعداد معلومات البونص للامبد
  const bonusInfo = bonusAmount > 0 ? { percentage: bonusPercentage, amount: bonusAmount } : null;
  const chargeEmbed = buildChargeEmbed(chargedUserId, baseCredit, totalAdd, userData.coins, bonusInfo);
  await sendChargeLog(chargeEmbed, channel);
});

async function start() {
  if (!mongoose.connection.readyState) {
    await mongoose.connect(MONGO_URI);
  }
  if (!chargeBotToken) {
    console.error("Missing chargeBotToken in config.json, skipping charge bot startup.");
    return;
  }
  await client.login(chargeBotToken);
}

if (require.main === module) {
  start().catch((err) => {
    console.error("Charge bot failed to start:", err);
    process.exit(1);
  });
}

client.on("messageCreate", async (message) => {
  // تمنع البوتات من تشغيل الأوامر
  if (message.author.bot) return;

  // تعريف المتغيرات المطلوبة لقراءة الأوامر (تأكد من وجود هذه الأسطر)
  const trimmed = (message.content || "").trim();
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();

  // ================= [ أمر بونصي ] =================
  if (cmd === "بونصي") {
    try {
      const userId = message.author.id;
      // الـ await هنا ستعمل بشكل سليم لأن الدالة بالأعلى تحتوي على async
      const result = await checkBonusWithdrawalCondition(userId);

      if (result.canWithdraw) {
        return message.reply("✅ ليس لديك أي بونص نشط حالياً، يمكنك السحب في أي وقت!").catch(() => {});
      }

      if (result.bonusActive) {
        return message.reply(result.reason).catch(() => {});
      }
    } catch (error) {
      console.error("خطأ في أمر بونصي:", error);
      return message.reply("❌ حدث خطأ أثناء جلب بيانات البونص الخاصة بك.").catch(() => {});
    }
    return;
  }

  // ================= [ أمر addbonus# ] =================
  if (cmd === "#addbonus") {
    const isOwn = owners.some((o) => String(o) === String(message.author.id));
    if (!isOwn) {
      return message.reply("❌ هذا الأمر مخصص للمالكين فقط.").catch(() => {});
    }

    const targetUser = message.mentions.users.first();
    const requiredAmount = parseInt(parts[2], 10);

    if (!targetUser) {
      return message.reply("❌ الصيغة الصحيحة: `#addbonus @user <المبلغ>`").catch(() => {});
    }

    if (isNaN(requiredAmount) || requiredAmount <= 0) {
      return message.reply("❌ يرجى تحديد مبلغ صحيح لشرط اللعب.").catch(() => {});
    }

    try {
      let userData = await db.findOne({ id: targetUser.id });
      if (!userData) {
        userData = { id: targetUser.id };
      }

      if (userData.activeBonusId && userData.bonusEndTime && Date.now() <= userData.bonusEndTime) {
        userData.bonusRechargedAmount = (userData.bonusRechargedAmount || 0) + requiredAmount;
      } else {
        userData.activeBonusId = `bonus_manual_${Date.now()}`;
        userData.bonusEndTime = Date.now() + (7 * 24 * 60 * 60 * 1000);
        userData.bonusRechargedAmount = requiredAmount;
        userData.bonusPlayedAmount = 0;
      }

      userData.bonusCondition = "full"; 
      userData.bonusBonusAmount = 0; 

      if (typeof userData.save === 'function') {
        await userData.save();
      } else {
        await db.updateOne({ id: targetUser.id }, { $set: userData }, { upsert: true });
      }

      return message.reply(`✅ تم إضافة **${requiredAmount.toLocaleString()}** إلى شرط اللعب الخاص بـ ${targetUser}.\nالمطلوب الكلي الحالي أصبح: **${userData.bonusRechargedAmount.toLocaleString()}**`).catch(() => {});

    } catch (error) {
      console.error("خطأ أثناء إضافة البونص التراكمي:", error);
      return message.reply("❌ حدث خطأ أثناء تحديث بيانات البونص في قاعدة البيانات.").catch(() => {});
    }
    return;
  }
}); // قوس إغلاق الـ messageCreate الصحيح

module.exports = { 
  startChargeBot: start,
  trackGamePlayedAmount,
  checkBonusWithdrawalCondition,
  getConditionName
};