'use strict';

const { EmbedBuilder } = require('discord.js');

function fmt(value) {
  return Math.max(0, Number(value) || 0).toLocaleString('en-US');
}
function parseAmount(raw) {
  const match = String(raw || '').trim().toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(k|m|ك|م)?$/);
  if (!match) return 0;
  const n = Number(match[1]) * (['k', 'ك'].includes(match[2]) ? 1e3 : ['m', 'م'].includes(match[2]) ? 1e6 : 1);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}
function getTarget(message, args) {
  return message.mentions.users.first() || null;
}
async function handleGoldenExtras(message, options = {}) {
  if (!message?.guild || message.author?.bot) return false;
  const fullText = String(message.content || '').trim();
  const args = fullText.split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (fullText.toLowerCase() === 'برايم دايلي') { args.length = 0; }
  const me = options.account(message.author.id);

  if (['بري', 'بريميوم', 'prime'].includes(cmd)) {
    const expiry = typeof me.primeExpires === 'number'
      ? me.primeExpires
      : (Date.parse(me.primeExpires) || 0);
    const active = expiry > Date.now();
    const embed = new EmbedBuilder()
      .setColor(active ? 0xf1c40f : 0x808080)
      .setTitle('👑 حالة اشتراك Prime')
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setDescription(active
        ? 'اشتراك Prime الخاص بك **نشط** وينتهي ' + '<t:' + Math.floor(expiry / 1000) + ':F>' + ' (' + '<t:' + Math.floor(expiry / 1000) + ':R>' + ').'
        : 'لا يوجد اشتراك Prime نشط على حسابك حالياً.')
      .addFields(
        { name: 'الكاش باك', value: active ? 'مضاعف ×2' : 'عادي', inline: true },
        { name: 'مكافأة Prime اليومية', value: active ? 'متاحة كل 24 ساعة' : 'غير متاحة', inline: true },
      )
      .setFooter({ text: 'Batoot Casino • Prime' })
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    return true;
  }

  if (cmd === 'ريب') {
    const roleId = String(options.premiumRoleId || '');
    if (!roleId || !message.member?.roles.cache.has(roleId)) {
      await message.reply('هذا الأمر مخصص لحاملي رتبة Premium.');
      return true;
    }
    const target = getTarget(message, args);
    if (!target) { await message.reply('استخدم: ريب @عضو'); return true; }
    if (target.id === message.author.id) { await message.reply('لا يمكنك منح ريب لنفسك.'); return true; }
    const now = Date.now();
    const cooldown = 24 * 60 * 60 * 1000;
    const last = Number(me.lastRepAt) || 0;
    if (now - last < cooldown) {
      const hours = Math.ceil((cooldown - (now - last)) / 3600000);
      await message.reply('يمكنك منح ريب مرة أخرى بعد ' + hours + ' ساعة.');
      return true;
    }
    const recipient = options.account(target.id);
    recipient.reps = (Number(recipient.reps) || 0) + 1;
    me.lastRepAt = now;
    await options.save();
    await message.reply('🎉 تم منح ' + target + ' نقطة ريب بنجاح.');
    return true;
  }

  if (cmd === 'اقتراح') {
    const suggestion = args.join(' ').trim();
    if (!suggestion) { await message.reply('اكتب اقتراحك بعد الأمر. مثال: اقتراح إضافة لعبة جديدة'); return true; }
    const now = Date.now();
    const cooldown = 10 * 60 * 1000;
    const last = Number(me.lastSuggestionAt) || 0;
    if (now - last < cooldown) {
      const seconds = Math.ceil((cooldown - (now - last)) / 1000);
      await message.reply('انتظر ' + Math.floor(seconds / 60) + ' دقيقة و' + (seconds % 60) + ' ثانية قبل إرسال اقتراح آخر.');
      return true;
    }
    const channelId = String(options.suggestionChannelId || '');
    const channel = channelId ? await message.guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased()) {
      await message.reply('قناة الاقتراحات غير مضبوطة. أضف SUGGESTION_CHANNEL_ID إلى إعدادات الاستضافة.');
      return true;
    }
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📢 اقتراح جديد')
      .setDescription(suggestion).addFields({ name: 'المرسل', value: message.author.toString(), inline: true })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    me.lastSuggestionAt = now;
    await options.save();
    await message.react('✅').catch(() => {});
    return true;
  }

  if (cmd === 'بوست') {
    const member = message.member;
    if (!member?.premiumSince) { await message.reply('يجب أن تعمل Boost للسيرفر حتى تحصل على المكافأة.'); return true; }
    const now = Date.now();
    const last = Number(me.lastBoostRewardAt) || 0;
    const week = 7 * 24 * 60 * 60 * 1000;
    if (now - last < week) {
      await message.reply('يمكنك استلام مكافأة البوست مرة أخرى في <t:' + Math.floor((last + week) / 1000) + ':R>.');
      return true;
    }
    const days = Math.max(0, Math.floor((now - member.premiumSince.getTime()) / 86400000));
    const reward = days >= 28 ? 200000 : days >= 14 ? 140000 : days >= 7 ? 120000 : 100000;
    me.coins = (Number(me.coins) || 0) + reward;
    me.lastBoostRewardAt = now;
    await options.save();
    await message.reply('🎉 مكافأة البوست: **' + fmt(reward) + '** كوين. رصيدك الآن: **' + fmt(me.coins) + '**.');
    return true;
  }

  if (fullText.toLowerCase() === 'برايم دايلي') {
    const expiry = Number(me.primeExpires) || (Date.parse(me.primeExpires) || 0);
    if (!expiry || expiry <= Date.now()) {
      await message.reply('هذا الأمر مخصص لمشتركي Prime النشطين فقط.');
      return true;
    }
    const cooldown = 24 * 60 * 60 * 1000;
    const last = Number(me.lastPrimeDailyAt) || 0;
    if (Date.now() - last < cooldown) {
      await message.reply('مكافأتك اليومية جاهزة <t:' + Math.ceil((last + cooldown) / 1000) + ':R>.');
      return true;
    }
    const reward = 3000000 + Math.floor(Math.random() * 5000001);
    me.coins = (Number(me.coins) || 0) + reward;
    me.lastPrimeDailyAt = Date.now();
    await options.save();
    await message.reply('🎁 استلمت مكافأة Prime اليومية: **' + fmt(reward) + '** كوين.');
    return true;
  }

  if (cmd === 'معلومات' || cmd === 'file' || cmd === 'ملف') {
    const target = message.mentions.users.first() || message.author;
    const data = options.account(target.id);
    const embed = new EmbedBuilder().setColor(0x5865f2)
      .setTitle('💼 معلومات الحساب')
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'العضو', value: target.toString(), inline: true },
        { name: 'الرصيد', value: fmt(data.coins) + ' كوين', inline: true },
        { name: 'الريب', value: fmt(data.reps), inline: true },
        { name: 'التحديات', value: fmt(data.challenges), inline: true },
        { name: 'الأصدقاء', value: fmt(Array.isArray(data.friends) ? data.friends.length : 0), inline: true },
        { name: 'المحظورون', value: fmt(Array.isArray(data.blocked) ? data.blocked.length : 0), inline: true },
      ).setFooter({ text: 'Batoot Casino • ملف اللاعب' }).setTimestamp();
    await message.reply({ embeds: [embed] });
    return true;
  }
  return false;
}

module.exports = { handleGoldenExtras, parseAmount };
