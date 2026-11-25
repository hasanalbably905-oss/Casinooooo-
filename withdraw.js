// نظام السحب: أي عضو يكتب withdraw في أي روم عام -> واجهة -> مبلغ -> تحقق خلال ثواني -> طلب في روم الطلبات
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const wallet = require('./wallet');

const COLOR = 0x2ecc71;
const MIN = 4000000;
const MAX = 10000000000;
const TEMP_MS = 5000;
const REQUESTS_CHANNEL_ID = process.env.REQUESTS_CHANNEL_ID;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

const base = () => new EmbedBuilder().setColor(COLOR).setFooter({ text: 'batoot casino' });
const row = (...c) => new ActionRowBuilder().addComponents(...c);

function setupWithdraw(client, { fmt, parseAmount }) {
  const finished = new Set(); // طلبات انتهت، تمنع الضغط المزدوج

  function panel() {
    return {
      embeds: [base().setTitle('💳 Withdraw').setDescription(
        'اضغط الزر واكتب المبلغ اللي تبي تسحبه.\n\n' +
        `• أقل مبلغ: **${fmt(MIN)}**\n` +
        `• أعلى مبلغ: **${fmt(MAX)}**\n` +
        '• قد تستغرق العملية **24 ساعة** كحد أقصى')],
      components: [row(new ButtonBuilder().setCustomId('wd_open').setLabel('Withdraw').setStyle(ButtonStyle.Success))],
    };
  }

  function requestView(user, amount, status) {
    const embed = base()
      .setTitle(status ? status.title : 'طلب سحب رصيد')
      .setDescription(status ? status.desc : null)
      .addFields(
        { name: '👤 العضو', value: `${user}` },
        { name: '💸 المبلغ', value: `**${fmt(amount)}**` },
        { name: '💳 الرصيد الحالي', value: `**${fmt(wallet.get(user.id))}**` },
      )
      .setTimestamp();
    if (status) return { embeds: [embed], components: [] };
    return {
      embeds: [embed],
      components: [row(
        new ButtonBuilder().setCustomId(`wd_ok_${user.id}_${amount}`).setLabel('✅ قبول').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`wd_no_${user.id}_${amount}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger),
      )],
    };
  }

  // رد مؤقت: يختفي بعد 5 ثواني
  async function tempReply(i, text) {
    await i.editReply({ content: text }).catch(() => {});
    setTimeout(() => i.deleteReply().catch(() => {}), TEMP_MS);
  }

  client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    if (msg.content.trim().toLowerCase() !== 'withdraw') return;
    await msg.channel.send(panel());
  });

  client.on('interactionCreate', async (i) => {
    // 1) زر السحب يفتح الواجهة
    if (i.isButton() && i.customId === 'wd_open') {
      const modal = new ModalBuilder().setCustomId('wd_modal').setTitle('Withdraw');
      modal.addComponents(row(
        new TextInputBuilder().setCustomId('amount').setLabel('المبلغ (مثال: 10m أو 4000000)')
          .setStyle(TextInputStyle.Short).setRequired(true),
      ));
      return i.showModal(modal);
    }

    // 2) تعبئة الواجهة: تحقق خلال ثواني ثم إرسال الطلب
    if (i.isModalSubmit() && i.customId === 'wd_modal') {
      await i.deferReply({ ephemeral: true });

      const amount = parseAmount(i.fields.getTextInputValue('amount'));
      if (!amount || amount < MIN || amount > MAX) {
        return tempReply(i, `❌ المبلغ لازم يكون بين ${fmt(MIN)} و ${fmt(MAX)}.`);
      }
      if (get(i.user.id) < amount) {
        return tempReply(i, `❌ رصيدك ما يكفي. رصيدك الحالي: **${fmt(get(i.user.id))}**`);
      }
      if (!REQUESTS_CHANNEL_ID) return tempReply(i, '❌ روم الطلبات غير مضبوط. كلم الأدمن.');

      const channel = await client.channels.fetch(REQUESTS_CHANNEL_ID).catch(() => null);
      if (!channel) return tempReply(i, '❌ ما قدرت أوصل لروم الطلبات.');

      if (!(await wallet.debit(i.user.id, amount))) {
        return tempReply(i, '❌ رصيدك ما يكفي.');
      }
      try {
        await channel.send({ content: '🆕 طلب سحب جديد', ...requestView(i.user, amount) });
      } catch (err) {
        await wallet.credit(i.user.id, amount);
        return tempReply(i, '❌ ما قدرت أرسل الطلب، رجعت الفلوس لرصيدك.');
      }
      return tempReply(i, `✅ تم إرسال طلب السحب بقيمة **${fmt(amount)}**، بانتظار الموافقة.`);
    }

    // 3) قبول أو رفض من الأدمن
    if (i.isButton() && (i.customId.startsWith('wd_ok_') || i.customId.startsWith('wd_no_'))) {
      if (!ADMIN_IDS.includes(i.user.id)) {
        return i.reply({ content: '❌ القبول والرفض للأدمن فقط.', ephemeral: true });
      }
      if (finished.has(i.message.id)) return i.reply({ content: '⚠️ هذا الطلب انتهى.', ephemeral: true });
      finished.add(i.message.id);

      const [, action, userId, amountStr] = i.customId.split('_');
      const amount = parseInt(amountStr, 10);
      const user = await client.users.fetch(userId).catch(() => null);
      const who = user || { id: userId, toString: () => `<@${userId}>` };

      if (action === 'ok') {
        await i.update(requestView(who, amount, {
          title: '✅ تمت الموافقة على السحب',
          desc: `وافق عليه: ${i.user}`,
        }));
        if (user) await user.send(`✅ تمت الموافقة على طلب سحبك بقيمة **${fmt(amount)}** كوين.`).catch(() => {});
      } else {
        await wallet.credit(userId, amount);
        await i.update(requestView(who, amount, {
          title: '❌ تم رفض طلب السحب ورجعت الفلوس',
          desc: `رفضه: ${i.user}`,
        }));
        if (user) await user.send(`❌ تم رفض طلب سحبك بقيمة **${fmt(amount)}** كوين، ورجعت الفلوس لرصيدك.`).catch(() => {});
      }
    }
  });
}

const get = wallet.get;

module.exports = { setupWithdraw };
