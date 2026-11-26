'use strict';

const { EmbedBuilder } = require('discord.js');

function parseGoldenAmount(raw) {
  const value = String(raw || '').trim().replace(/,/g, '').toLowerCase();
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(k|m|ك|م)?$/);
  if (!match) return null;
  const multiplier = ['k', 'ك'].includes(match[2]) ? 1000 : ['m', 'م'].includes(match[2]) ? 1000000 : 1;
  const amount = Number(match[1]) * multiplier;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

async function handleGoldenUtilities(message, options = {}) {
  if (!message || !message.guild || message.author.bot) return false;
  const text = String(message.content || '').trim();
  const args = text.split(/\s+/);
  const cmd = (args[0] || '').toLowerCase();

  if (['tax', 'ضريبة', 'ضريبه'].includes(cmd)) {
    const amount = parseGoldenAmount(args[1]);
    if (!amount) {
      await message.reply('يرجى إدخال مبلغ صحيح. مثال: tax 10m');
      return true;
    }
    // Formula preserved from the original Golden tax command.
    const total = Math.floor(amount * 20 / 19 + 1);
    const tax = total - amount;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Tax ' + amount.toLocaleString('en-US'))
      .addFields(
        { name: 'المبلغ مع الضريبة', value: total.toLocaleString('en-US'), inline: true },
        { name: 'قيمة الضريبة', value: tax.toLocaleString('en-US'), inline: true },
      )
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    return true;
  }

  if (cmd === 'بنج' || cmd === 'ping') {
    if (!options.isAdmin || !options.isAdmin(message.author.id)) {
      await message.reply('⚠️ هذا الأمر متاح للإدارة المعتمدة فقط.');
      return true;
    }
    const sent = await message.reply('جارٍ حساب البنج...');
    const response = sent.createdTimestamp - message.createdTimestamp;
    const api = Math.round(message.client.ws.ping);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📡 سرعة البوت الحالية')
      .addFields(
        { name: 'سرعة الاستجابة', value: response + 'ms', inline: true },
        { name: 'بنج Discord API', value: api + 'ms', inline: true },
      )
      .setTimestamp();
    await sent.edit({ content: null, embeds: [embed] });
    return true;
  }

  return false;
}

module.exports = { handleGoldenUtilities, parseGoldenAmount };
