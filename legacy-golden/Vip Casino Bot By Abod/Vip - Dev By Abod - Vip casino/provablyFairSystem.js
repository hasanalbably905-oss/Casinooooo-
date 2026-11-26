const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EmbedBuilder, MessageEmbed } = require('discord.js');

const PFEmbed = EmbedBuilder || MessageEmbed;
const PF_COLOR_PRE = 0x5865f2;
const PF_COLOR_OK = 0x22c55e;
const PF_COLOR_ERR = 0xef4444;

const roundSchema = new mongoose.Schema(
  {
    nonce: { type: Number, required: true },
    min: { type: Number },
    max: { type: Number },
    value: { type: Number },
    label: { type: String, default: 'roll' },
    forcedByRule: { type: Boolean, default: false },
  },
  { _id: false }
);

const provablyFairSessionSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, unique: true, index: true },
    channelId: { type: String, required: true },
    guildId: { type: String, default: '' },
    user1: { type: String, required: true },
    user2: { type: String, required: true },
    no3: { type: String, default: '' },
    modeLabelAr: { type: String, default: '' },
    serverSeed: { type: String, required: true },
    serverSeedHash: { type: String, required: true },
    clientSeed1: { type: String, required: true },
    clientSeed2: { type: String, required: true },
    nonce: { type: Number, default: -1 },
    rounds: { type: [roundSchema], default: [] },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const ProvablyFairSession =
  mongoose.models.ProvablyFairSession ||
  mongoose.model('ProvablyFairSession', provablyFairSessionSchema);

function readProvablyFairConfig() {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed.provablyFair && typeof parsed.provablyFair === 'object' ? parsed.provablyFair : {};
  } catch (_) {
    return {};
  }
}

function createProvablyFairSystem(options = {}) {
  const cfg = readProvablyFairConfig();
  const logChannelProvablyFairPre = String(
    options.logChannelProvablyFairPre ||
      cfg.logChannelProvablyFairPre ||
      options.logChannelProvablyFair ||
      cfg.logChannelProvablyFair ||
      ''
  ).trim();
  const logChannelProvablyFairEnd = String(
    options.logChannelProvablyFairEnd ||
      cfg.logChannelProvablyFairEnd ||
      options.logChannelProvablyFair ||
      cfg.logChannelProvablyFair ||
      ''
  ).trim();
  const logChannelProvablyFairVerify = String(
    options.logChannelProvablyFairVerify ||
      cfg.logChannelProvablyFairVerify ||
      options.logChannelProvablyFair ||
      cfg.logChannelProvablyFair ||
      ''
  ).trim();
  const verifyCommandChannelId = String(options.verifyCommandChannelId || cfg.verifyCommandChannelId || '').trim();
  const allowedCommandPrefixes = Array.isArray(options.allowedCommandPrefixes)
    ? options.allowedCommandPrefixes.map((x) => String(x || '').trim())
    : Array.isArray(cfg.allowedCommandPrefixes)
    ? cfg.allowedCommandPrefixes.map((x) => String(x || '').trim())
    : ['!', '$', ''];
  const isDatabaseReady =
    typeof options.isDatabaseReady === 'function' ? options.isDatabaseReady : () => true;

  function randomIntInclusive(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (lo === hi) return lo;
    return crypto.randomInt(lo, hi + 1);
  }

  function calcProvablyFairRoll({ serverSeed, clientSeed1, clientSeed2, nonce, min, max }) {
    const lo = Math.min(Number(min), Number(max));
    const hi = Math.max(Number(min), Number(max));
    const parsedNonce = Number(nonce);
    const combined = `${String(clientSeed1)}:${String(clientSeed2)}:${parsedNonce}`;
    const hmacHex = crypto.createHmac('sha256', String(serverSeed)).update(combined).digest('hex');
    const x = parseInt(hmacHex.slice(0, 12), 16);
    const range = hi - lo + 1;
    const value = lo + (x % range);
    return { value, min: lo, max: hi, nonce: parsedNonce, combined, hmacHex };
  }

  function embedAddProvablyFairHash(embed, serverSeedHash) {
    if (!serverSeedHash || !embed) return embed;
    const existingFields = Array.isArray(embed.fields)
      ? embed.fields
      : Array.isArray(embed?.data?.fields)
      ? embed.data.fields
      : [];
    const hasProvablyFairField = existingFields.some((field) =>
      String(field?.name || '').includes('Provably Fair')
    );
    if (hasProvablyFairField) return embed;
    const pfField = {
      name: '🔐 Provably Fair',
      value: `**Server Seed Hash (قبل اللعب):**\n\`\`\`${serverSeedHash}\`\`\``,
      inline: false,
    };
    if (typeof embed.addFields === 'function') {
      return embed.addFields(pfField);
    }
    if (Array.isArray(embed.fields)) {
      embed.fields.push(pfField);
      return embed;
    }
    if (embed.data && Array.isArray(embed.data.fields)) {
      embed.data.fields.push(pfField);
      return embed;
    }
    if (embed && typeof embed === 'object') {
      embed.fields = [pfField];
      return embed;
    }
    return embed.addFields({
      ...pfField,
    });
  }

  async function patchMessageEditWithPfHash(messageObj) {
    if (!messageObj?.id || typeof messageObj.edit !== 'function') return;
    if (messageObj.__pfHashEditPatched) return;

    const originalEdit = messageObj.edit.bind(messageObj);
    Object.defineProperty(messageObj, '__pfHashEditPatched', {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    messageObj.edit = async function patchedEdit(payload, ...rest) {
      try {
        if (payload && typeof payload === 'object' && Array.isArray(payload.embeds) && payload.embeds.length) {
          const pf = isDatabaseReady()
            ? await ProvablyFairSession.findOne({ messageId: String(messageObj.id) })
                .select('serverSeedHash')
                .lean()
            : null;
          if (pf?.serverSeedHash) {
            for (let i = 0; i < payload.embeds.length; i++) {
              const originalEmbed = payload.embeds[i];
              const embed = originalEmbed && typeof originalEmbed.addFields === 'function'
                ? originalEmbed
                : new PFEmbed(originalEmbed || {});
              embedAddProvablyFairHash(embed, pf.serverSeedHash);
              payload.embeds[i] = embed;
            }
          }
        }
      } catch (_) {}
      return originalEdit(payload, ...rest);
    };
  }

  async function applyPfHashToTakribiEmbed(embed, messageId) {
    if (!embed || !messageId || !isDatabaseReady()) return embed;
    try {
      const pf = await ProvablyFairSession.findOne({ messageId: String(messageId) }).select('serverSeedHash').lean();
      if (pf?.serverSeedHash) embedAddProvablyFairHash(embed, pf.serverSeedHash);
    } catch (_) {}
    return embed;
  }

  async function createTakribiProvablyFairSession(client, opts) {
    if (!isDatabaseReady()) return null;
    const { messageId, channelId, guildId, user1, user2, no3, modeLabelAr } = opts;
    try {
      await ProvablyFairSession.deleteMany({ messageId: String(messageId) });
    } catch (_) {}

    const serverSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = crypto.createHash('sha256').update(serverSeed, 'utf8').digest('hex');
    const clientSeed1 = crypto.randomBytes(16).toString('hex');
    const clientSeed2 = crypto.randomBytes(16).toString('hex');

    let doc;
    try {
      doc = await ProvablyFairSession.create({
        messageId: String(messageId),
        channelId: String(channelId || ''),
        guildId: String(guildId || ''),
        user1: String(user1),
        user2: String(user2),
        no3: String(no3 || ''),
        modeLabelAr: String(modeLabelAr || ''),
        serverSeed,
        serverSeedHash,
        clientSeed1,
        clientSeed2,
        nonce: -1,
        rounds: [],
        status: 'active',
      });
    } catch (e) {
      console.error('createTakribiProvablyFairSession', e);
      return null;
    }

    await sendProvablyFairPreLog(client, doc);
    return doc;
  }

  async function sendProvablyFairPreLog(client, doc) {
    if (!logChannelProvablyFairPre || !doc) return;
    const ch =
      client.channels.cache.get(logChannelProvablyFairPre) ||
      (await client.channels.fetch(logChannelProvablyFairPre).catch(() => null));
    if (!ch || typeof ch.send !== 'function') return;

    const emb = new PFEmbed()
      .setColor(PF_COLOR_PRE)
      .setTitle('🔐 Provably Fair — قبل بدء القيمة')
      .setDescription('هذه البيانات تتسجل قبل الجولة حتى يثبت إن النتائج ما انعدلت بعدين.')
      .addFields(
        { name: '👤 اللاعب الأول', value: `<@${doc.user1}>`, inline: true },
        { name: '👤 اللاعب الثاني', value: `<@${doc.user2}>`, inline: true },
        { name: '🎮 نوع اللعبة', value: `\`${doc.no3}\``, inline: true },
        { name: '⚙️ الوضع', value: doc.modeLabelAr || '—', inline: false },
        { name: '🔐 Server Hash', value: `\`\`\`${doc.serverSeedHash}\`\`\``, inline: false },
        { name: `🎲 Client Seed — <@${doc.user1}>`, value: `\`${doc.clientSeed1}\``, inline: false },
        { name: `🎲 Client Seed — <@${doc.user2}>`, value: `\`${doc.clientSeed2}\``, inline: false }
      )
      .setFooter({ text: `Message ID: ${doc.messageId}` })
      .setTimestamp();

    await ch.send({ embeds: [emb] }).catch((e) => console.error('sendProvablyFairPreLog', e));
  }

  async function pfNextRoll(messageId, min, max, label) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (!isDatabaseReady()) return randomIntInclusive(lo, hi);
    const s = await ProvablyFairSession.findOne({ messageId: String(messageId), status: 'active' });
    if (!s) return randomIntInclusive(lo, hi);

    const nextN = (typeof s.nonce === 'number' ? s.nonce : -1) + 1;
    const combined = `${s.clientSeed1}:${s.clientSeed2}:${nextN}`;
    const h = crypto.createHmac('sha256', s.serverSeed).update(combined).digest('hex');
    const x = parseInt(h.slice(0, 12), 16);
    const range = hi - lo + 1;
    const value = lo + (x % range);

    s.nonce = nextN;
    s.rounds.push({ nonce: nextN, min: lo, max: hi, value, label: label || 'roll', forcedByRule: false });
    await s.save().catch((e) => console.error('pfNextRoll save', e));
    return value;
  }

  async function pfLogForcedRuleRoll(messageId, value, label) {
    if (!isDatabaseReady()) return;
    const s = await ProvablyFairSession.findOne({ messageId: String(messageId), status: 'active' });
    if (!s) return;
    const nextN = (typeof s.nonce === 'number' ? s.nonce : -1) + 1;
    s.nonce = nextN;
    s.rounds.push({
      nonce: nextN,
      min: value,
      max: value,
      value,
      label: label || 'قاعدة لعبة',
      forcedByRule: true,
    });
    await s.save().catch(() => {});
  }

  async function endProvablyFairSession(client, messageId, endMeta = {}) {
    const s = await ProvablyFairSession.findOne({ messageId: String(messageId) });
    if (!s || s.status === 'ended') return s;
    s.status = 'ended';
    s.endedAt = new Date();
    await s.save().catch(() => {});

    const logEndId =
      String(logChannelProvablyFairEnd || '').trim() ||
      String(logChannelProvablyFair || '').trim();
    if (!logEndId) return s;

    const ch =
      client.channels.cache.get(logEndId) ||
      (await client.channels.fetch(logEndId).catch(() => null));
    if (!ch || typeof ch.send !== 'function') return s;

    const recomputed = crypto.createHash('sha256').update(String(s.serverSeed || ''), 'utf8').digest('hex');
    const hashMatch = recomputed === String(s.serverSeedHash || '');
    const dataPayload = `${s.serverSeedHash}|${s.clientSeed1}|${s.clientSeed2}|${s.messageId}`;
    const dataHash = crypto.createHash('sha256').update(dataPayload, 'utf8').digest('hex');
    const dataHashCheck = crypto.createHash('sha256').update(dataPayload, 'utf8').digest('hex');
    const dataHashMatch = dataHash === dataHashCheck;

    const botId = client.user?.id || '';
    const p2IsBot = String(s.user2) === String(botId);
    const winnerId = endMeta.winnerUserId != null ? String(endMeta.winnerUserId) : '';
    const winnerLine = winnerId
      ? `<@${winnerId}>`
      : endMeta.winnerLabel != null
      ? String(endMeta.winnerLabel)
      : '—';
    const betAmt = Number(endMeta.betAmount);
    const betLine = Number.isFinite(betAmt) && betAmt > 0 ? betAmt.toLocaleString() : endMeta.betAmountText || '—';
    const gameLabel =
      String(endMeta.gameTypeLabel || '').trim() ||
      `${s.no3 || 'game'} · ${s.modeLabelAr || '—'}`;

    const lines = (s.rounds || [])
      .slice(-24)
      .map((r) => `\`#${r.nonce}\` **${r.value}** _${r.label}_${r.forcedByRule ? ' `(قاعدة)`' : ''}`);

    const emb = new PFEmbed()
      .setColor(hashMatch && dataHashMatch ? 0xfbbf24 : PF_COLOR_ERR)
      .setTitle('🔓 Provably Fair — نهاية لعبة')
      .setDescription(
        '**Server Seed** مكشوف الآن — يمكن التحقق من عشوائية الأرقام | استخدم `verify <MessageID>` في قناة التحقق.'
      )
      .addFields(
        { name: 'اللاعب الأول', value: `<@${s.user1}>`, inline: true },
        {
          name: p2IsBot ? 'اللاعب الثاني (البوت)' : 'اللاعب الثاني',
          value: p2IsBot ? (client.user ? `${client.user}` : `<@${s.user2}>`) : `<@${s.user2}>`,
          inline: true,
        },
        { name: 'الفائز 👑', value: winnerLine, inline: true },
        { name: 'نوع اللعبة 🎮', value: `\`${gameLabel}\``, inline: true },
        { name: 'المبلغ 💰', value: `\`${betLine}\``, inline: true },
        { name: '🔓 Server Seed (مكشوف)', value: `\`\`\`${s.serverSeed}\`\`\``, inline: false },
        { name: '🔓 Server Hash', value: `\`\`\`${s.serverSeedHash}\`\`\``, inline: false },
        { name: '🔓 Hash المحسوب', value: `\`\`\`${recomputed}\`\`\``, inline: false },
        { name: '🔓 Data Hash (يشمل كل البيانات)', value: `\`\`\`${dataHash}\`\`\``, inline: false },
        { name: '🔓 Data Hash المحسوب', value: `\`\`\`${dataHashCheck}\`\`\``, inline: false },
        { name: `🎲 Client Seed — <@${s.user1}>`, value: `\`${s.clientSeed1}\``, inline: false },
        { name: `🎲 Client Seed — <@${s.user2}>`, value: `\`${s.clientSeed2}\``, inline: false },
        {
          name: 'التحقق',
          value:
            `Server Hash: ${hashMatch ? 'متطابق تماماً ✅' : '❌ لا يطابق'}\n` +
            `Data Hash: ${dataHashMatch ? 'متطابق تماماً ✅' : '❌ لا يطابق'}\n` +
            (lines.length ? `📋 آخر الدورات:\n${lines.join('\n').slice(0, 900)}` : '📋 الدورات: —'),
          inline: false,
        }
      )
      .setFooter(
        `🔓 Provably Fair | ${client.user?.username || 'Bot'} — Message ID: ${messageId}`,
        client.user?.displayAvatarURL?.({ dynamic: true, size: 64 }) || undefined
      )
      .setTimestamp();

    await ch.send({ embeds: [emb] }).catch((e) => console.error('endProvablyFairSession log', e));

    try {
      if (s.channelId && s.messageId) {
        const gameChannel =
          client.channels.cache.get(String(s.channelId)) ||
          (await client.channels.fetch(String(s.channelId)).catch(() => null));
        if (gameChannel?.messages?.fetch) {
          const gameMsg = await gameChannel.messages.fetch(String(s.messageId)).catch(() => null);
          if (gameMsg) {
            const existingRows = Array.isArray(gameMsg.components) ? gameMsg.components : [];
            const alreadyExists = existingRows.some((row) =>
              (row.components || []).some((btn) => String(btn.customId || '').startsWith('pf_view_'))
            );
            if (!alreadyExists && existingRows.length < 5) {
              const pfRow = {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 2,
                    custom_id: `pf_view_${s.messageId}`,
                    label: 'Provably Fair',
                    emoji: { name: '🔐' },
                  },
                ],
              };
              await gameMsg.edit({ components: [...existingRows, pfRow] }).catch(() => {});
            }
          }
        }
      }
    } catch (_) {}
    return s;
  }

  async function replyProvablyFairVerify(message, messageIdArg) {
    if (!isDatabaseReady()) return message.reply('> ❌ قاعدة البيانات غير جاهزة.').catch(() => {});
    if (verifyCommandChannelId && message.channel.id !== verifyCommandChannelId) {
      return message.reply(`> ❌ أمر verify متاح فقط في <#${verifyCommandChannelId}>`).catch(() => {});
    }

    const mid = String(messageIdArg || '').replace(/\D/g, '');
    if (!mid || mid.length < 10) {
      return message.reply('> الاستخدام: `verify <MessageID>` مثال: `verify 1492228502865318102`').catch(() => {});
    }

    const s = await ProvablyFairSession.findOne({ messageId: mid });
    if (!s) return message.reply('> ❌ لا يوجد سجل Provably Fair لهذا الآيدي.').catch(() => {});

    const recomputed = crypto.createHash('sha256').update(s.serverSeed, 'utf8').digest('hex');
    const match = recomputed === s.serverSeedHash;
    const lines = (s.rounds || []).map(
      (r) => `\`#${r.nonce}\` **${r.value}** (${r.min}–${r.max}) _${r.label}_${r.forcedByRule ? ' `قاعدة`' : ''}`
    );

    const emb = new PFEmbed()
      .setColor(match ? PF_COLOR_OK : PF_COLOR_ERR)
      .setTitle('🔐 نتيجة التحقق — Provably Fair')
      .setDescription(
        match
          ? '**الهاش صحيح** والسيد المكشوف يطابق المسجل قبل اللعب ✅'
          : '**تحذير:** الهاش المحسوب لا يطابق المسجل.'
      )
      .addFields(
        { name: 'نوع اللعبة', value: `\`${s.no3}\` · ${s.modeLabelAr || '—'}`, inline: false },
        { name: '🔧 Server Seed Hash (قديم)', value: `\`${s.serverSeedHash}\``, inline: false },
        {
          name: s.status === 'ended' ? '🔓 Server Seed (بعد اللعب)' : '⏳ Server Seed',
          value: s.status === 'ended' ? `\`\`\`${s.serverSeed}\`\`\`` : 'يتكشف عند نهاية الجولة.',
          inline: false,
        },
        { name: '🔒 Hash من السيد الحالي', value: `\`${recomputed}\``, inline: false },
        { name: '📋 الدورات', value: lines.length ? lines.join('\n').slice(0, 3800) : 'لا توجد دورات.', inline: false }
      )
      .setFooter({ text: `Provably Fair · ID: ${mid}` })
      .setTimestamp();

    await message.reply({ embeds: [emb], allowedMentions: { repliedUser: false } }).catch(() => {});
    if (logChannelProvablyFairVerify) {
      const ch =
        message.client.channels.cache.get(logChannelProvablyFairVerify) ||
        (await message.client.channels.fetch(logChannelProvablyFairVerify).catch(() => null));
      if (ch && typeof ch.send === 'function') {
        await ch
          .send({
            content: `🔎 verify by <@${message.author.id}> · messageId: \`${mid}\` · result: ${
              match ? 'MATCH' : 'MISMATCH'
            }`,
          })
          .catch(() => {});
      }
    }
    return null;
  }

  async function replyProvablyFairSeedVerify(message, args) {
    if (verifyCommandChannelId && message.channel.id !== verifyCommandChannelId) {
      return message.reply(`> ❌ أوامر verify متاحة فقط في <#${verifyCommandChannelId}>`).catch(() => {});
    }

    const [serverSeed, serverSeedHash, clientSeed1, clientSeed2, nonceRaw, minRaw, maxRaw] = args;
    const nonce = Number(nonceRaw);
    const min = Number(minRaw);
    const max = Number(maxRaw);
    if (
      !serverSeed ||
      !serverSeedHash ||
      !clientSeed1 ||
      !clientSeed2 ||
      !Number.isFinite(nonce) ||
      !Number.isFinite(min) ||
      !Number.isFinite(max)
    ) {
      return message
        .reply(
          '> الاستخدام:\n`verifyseed <serverSeed> <serverSeedHash> <clientSeed1> <clientSeed2> <nonce> <min> <max>`\nمثال:\n`verifyseed abcd1234... efgh5678... c1seed c2seed 0 1 100`'
        )
        .catch(() => {});
    }

    const recomputedHash = crypto.createHash('sha256').update(serverSeed, 'utf8').digest('hex');
    const hashMatch = recomputedHash === String(serverSeedHash).toLowerCase();
    const roll = calcProvablyFairRoll({ serverSeed, clientSeed1, clientSeed2, nonce, min, max });

    const emb = new PFEmbed()
      .setColor(hashMatch ? PF_COLOR_OK : PF_COLOR_ERR)
      .setTitle('🧪 Verify Seed — Provably Fair')
      .setDescription(
        hashMatch
          ? 'الـ `serverSeed` يطابق الهاش، وتم حساب نفس نتيجة اللعب من السيدات ✅'
          : '⚠️ الـ `serverSeed` لا يطابق `serverSeedHash` المرسل.'
      )
      .addFields(
        { name: 'Server Seed', value: `\`\`\`${serverSeed}\`\`\``, inline: false },
        { name: 'Hash (محسوب)', value: `\`${recomputedHash}\``, inline: false },
        { name: 'Hash (مرسل)', value: `\`${serverSeedHash}\``, inline: false },
        { name: 'Client Seeds', value: `\`${clientSeed1}\`\n\`${clientSeed2}\``, inline: false },
        { name: 'Nonce / Range', value: `nonce: \`${roll.nonce}\` | min-max: \`${roll.min}-${roll.max}\``, inline: false },
        { name: 'Result (roll)', value: `**${roll.value}**`, inline: true },
        { name: 'HMAC (sha256)', value: `\`${roll.hmacHex}\``, inline: false }
      )
      .setFooter({ text: 'Formula: HMAC_SHA256(serverSeed, client1:client2:nonce)' })
      .setTimestamp();

    await message.reply({ embeds: [emb], allowedMentions: { repliedUser: false } }).catch(() => {});
    return null;
  }

  async function handleProvablyFairCommand(message, prefix = '') {
    const content = String(message?.content || '').trim();
    const candidatePrefixes = [prefix, ...allowedCommandPrefixes]
      .map((x) => String(x || '').trim())
      .filter((x, i, arr) => arr.indexOf(x) === i);
    let withoutPrefix = content;
    for (const p of candidatePrefixes) {
      if (!p) continue;
      if (content.toLowerCase().startsWith(p.toLowerCase())) {
        withoutPrefix = content.slice(p.length).trim();
        break;
      }
    }

    const parts = withoutPrefix.split(/\s+/).filter(Boolean);
    const cmd = (parts[0] || '').toLowerCase();
    if (cmd === 'verify') {
      await replyProvablyFairVerify(message, parts[1]);
      return true;
    }
    if (cmd === 'verifyseed' || cmd === 'pfroll') {
      await replyProvablyFairSeedVerify(message, parts.slice(1));
      return true;
    }
    return false;
  }

  return {
    model: ProvablyFairSession,
    embedAddProvablyFairHash,
    applyPfHashToTakribiEmbed,
    patchMessageEditWithPfHash,
    createTakribiProvablyFairSession,
    sendProvablyFairPreLog,
    pfNextRoll,
    pfLogForcedRuleRoll,
    endProvablyFairSession,
    replyProvablyFairVerify,
    replyProvablyFairSeedVerify,
    calcProvablyFairRoll,
    handleProvablyFairCommand,
  };
}

module.exports = { ProvablyFairSession, createProvablyFairSystem };
