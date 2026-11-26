'use strict';

const { EmbedBuilder } = require('discord.js');

function makeEmbed(text, color = 0x5865f2) {
  return new EmbedBuilder().setColor(color).setDescription(text);
}
async function resolveUser(message, raw) {
  const mention = message.mentions && message.mentions.users.first();
  if (mention) return mention;
  const id = String(raw || '').replace(/[<@!>]/g, '');
  if (!/^\d{15,22}$/.test(id)) return null;
  return message.client.users.fetch(id).catch(() => null);
}

async function handleGoldenSocial(message, options = {}) {
  if (!message || !message.guild || message.author.bot) return false;
  const args = String(message.content || '').trim().split(/\s+/);
  const cmd = (args[0] || '').toLowerCase();
  if (!cmd) return false;
  const data = options.account(message.author.id);
  const needsTarget = ['فرند', 'friend', 'حذف', 'remove', 'بلوك', 'block', 'فك', 'unblock'].includes(cmd);
  const target = needsTarget ? await resolveUser(message, args[1]) : null;

  if (['فرند', 'friend'].includes(cmd)) {
    if (!args[1]) { await message.reply('> يرجى تحديد عضو لإضافته كصديق!'); return true; }
    if (!target) { await message.reply('❎ لم أستطع العثور على هذا الشخص!'); return true; }
    if (target.id === message.author.id) { await message.reply('لا يمكنك إضافة نفسك إلى قائمة الأصدقاء.'); return true; }
    if (!Array.isArray(data.blocked)) data.blocked = [];
    if (!Array.isArray(data.friends)) data.friends = [];
    if (data.blocked.includes(target.id)) {
      await message.reply({ embeds: [makeEmbed('هذا الشخص محظور لديك. فك الحظر عنه أولاً.', 0xed4245)] });
      return true;
    }
    if (data.friends.includes(target.id)) {
      await message.reply('هذا الشخص موجود بالفعل في قائمة أصدقائك!');
      return true;
    }
    data.friends.push(target.id);
    await options.save();
    await message.reply({ embeds: [makeEmbed('تمت إضافة ' + target.toString() + ' إلى قائمة أصدقائك بنجاح.')] });
    return true;
  }

  if (['حذف', 'remove'].includes(cmd)) {
    if (!args[1]) { await message.reply('> يرجى تحديد عضو لحذفه من قائمة الأصدقاء!'); return true; }
    if (!target) { await message.reply('❎ لم أستطع العثور على هذا الشخص!'); return true; }
    if (target.id === message.author.id) { await message.reply('لا يمكنك حذف نفسك من قائمة الأصدقاء.'); return true; }
    if (!Array.isArray(data.friends) || !data.friends.includes(target.id)) {
      await message.reply(target.toString() + ' غير موجود في قائمة أصدقائك!');
      return true;
    }
    data.friends = data.friends.filter(id => id !== target.id);
    await options.save();
    await message.reply({ embeds: [makeEmbed('تم حذف ' + target.toString() + ' من قائمة الأصدقاء.')] });
    return true;
  }

  if (['فرندز', 'friends'].includes(cmd)) {
    const friends = Array.isArray(data.friends) ? data.friends : [];
    const description = friends.length ? 'قائمة أصدقائك: ' + friends.map(id => '<@' + id + '>').join('، ') : 'ليس لديك أصدقاء مسجلون حالياً.';
    await message.reply({ embeds: [makeEmbed(description)] });
    return true;
  }

  if (['بلوك', 'block'].includes(cmd)) {
    const premiumRoleId = String(options.premiumRoleId || '');
    if (!premiumRoleId || !message.member || !message.member.roles.cache.has(premiumRoleId)) {
      await message.reply('هذا الأمر متاح لحاملي رتبة Premium فقط.');
      return true;
    }
    if (!args[1]) { await message.reply('> يرجى تحديد عضو لحظره!'); return true; }
    if (!target) { await message.reply('❎ لم أستطع العثور على هذا الشخص!'); return true; }
    if (target.id === message.author.id) { await message.reply('لا يمكنك حظر نفسك.'); return true; }
    if (!Array.isArray(data.blocked)) data.blocked = [];
    if (!data.blocked.includes(target.id)) data.blocked.push(target.id);
    if (!Array.isArray(data.friends)) data.friends = [];
    data.friends = data.friends.filter(id => id !== target.id);
    await options.save();
    await message.reply({ embeds: [makeEmbed('تم حظر ' + target.toString() + ' من اللعب معك.')] });
    return true;
  }

  if (['فك', 'unblock'].includes(cmd)) {
    const premiumRoleId = String(options.premiumRoleId || '');
    if (!premiumRoleId || !message.member || !message.member.roles.cache.has(premiumRoleId)) {
      await message.reply('هذا الأمر متاح لحاملي رتبة Premium فقط.');
      return true;
    }
    if (!args[1]) { await message.reply('> يرجى تحديد عضو لفك الحظر عنه!'); return true; }
    if (!target) { await message.reply('❎ لم أستطع العثور على هذا الشخص!'); return true; }
    if (!Array.isArray(data.blocked) || !data.blocked.includes(target.id)) {
      await message.reply(target.toString() + ' غير محظور لديك.');
      return true;
    }
    data.blocked = data.blocked.filter(id => id !== target.id);
    await options.save();
    await message.reply({ embeds: [makeEmbed('تم فك الحظر عن ' + target.toString() + '.')] });
    return true;
  }

  if (['بلوكز', 'blocks'].includes(cmd)) {
    const blocked = Array.isArray(data.blocked) ? data.blocked : [];
    const description = blocked.length ? 'قائمة المحظورين: ' + blocked.map(id => '<@' + id + '>').join('، ') : 'قائمة الحظر فارغة.';
    await message.reply({ embeds: [makeEmbed(description)] });
    return true;
  }

  return false;
}

module.exports = { handleGoldenSocial };
