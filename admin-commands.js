'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const COLORS = { success: 0x57f287, error: 0xed4245, info: 0x5865f2 };
const durationMs = raw => {
  const match = String(raw || '').trim().toLowerCase().match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const scale = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  const value = Number(match[1]) * scale;
  return Number.isSafeInteger(value) && value > 0 && value <= 28 * 86400000 ? value : null;
};
const formatDuration = ms => ms >= 86400000 ? Math.round(ms / 86400000) + ' يوم' : ms >= 3600000 ? Math.round(ms / 3600000) + ' ساعة' : ms >= 60000 ? Math.round(ms / 60000) + ' دقيقة' : Math.round(ms / 1000) + ' ثانية';

async function handleAdminCommands(message, options = {}) {
  if (!message?.guild || message.author?.bot) return false;
  const args = message.content.trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  const aliases = {
    ban: ['ban', 'حظر'], unban: ['unban', 'فك-حظر'], kick: ['kick', 'طرد'],
    timeout: ['timeout', 'mute', 'اسكات', 'اسكت'], untimeout: ['untimeout', 'unmute', 'فك-اسكات'],
    warn: ['warn', 'تحذير'], warns: ['warns', 'تحذيرات'], clearwarns: ['clearwarns', 'مسح-تحذيرات'],
    clear: ['clear', 'مسح'], lock: ['lock', 'قفل'], unlock: ['unlock', 'فتح'],
    slowmode: ['slowmode', 'بطء'], nick: ['nick', 'لقب'],
    addrole: ['addrole', 'roleadd', 'اعطاء-رتبة'], removerole: ['removerole', 'rolerem', 'سحب-رتبة'],
    userinfo: ['userinfo', 'معلومات-عضو'], serverinfo: ['serverinfo', 'معلومات-السيرفر'],
  };
  const action = Object.keys(aliases).find(key => aliases[key].includes(cmd));
  if (!action) return false;
  const isAdmin = !!(options.isAdmin && options.isAdmin(message.author.id));
  if (!isAdmin) { await message.reply('🚫 هذا الأمر للإدارة المعتمدة فقط.'); return true; }
  const guild = message.guild;
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const fail = text => message.reply('❌ ' + text);
  const ok = text => message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.success).setDescription('✅ ' + text).setTimestamp()] });
  const target = async raw => {
    const id = String(raw || '').replace(/[<@!>]/g, '');
    if (!/^\d{15,22}$/.test(id)) return null;
    return guild.members.fetch(id).catch(() => null);
  };
  const hierarchy = (member, permission) => {
    if (!me || !me.permissions.has(permission)) return 'البوت لا يملك الصلاحية المطلوبة.';
    if (member.id === message.author.id) return 'لا يمكنك تنفيذ هذا الأمر على نفسك.';
    if (member.id === guild.ownerId) return 'لا يمكن تنفيذ الأمر على مالك السيرفر.';
    if (member.roles.highest.position >= me.roles.highest.position) return 'رتبة العضو أعلى من رتبة البوت أو مساوية لها.';
    const actor = guild.members.cache.get(message.author.id);
    if (actor.id !== guild.ownerId && member.roles.highest.position >= actor.roles.highest.position) return 'لا يمكنك استهداف عضو رتبته أعلى من رتبتك أو مساوية لها.';
    return null;
  };

  if (action === 'ban' || action === 'kick' || action === 'timeout' || action === 'warn') {
    const member = await target(args[0]);
    if (!member) return fail('حدد عضواً صحيحاً باستخدام المنشن أو ID.');
    const permission = action === 'ban' ? PermissionFlagsBits.BanMembers : action === 'kick' ? PermissionFlagsBits.KickMembers : action === 'timeout' ? PermissionFlagsBits.ModerateMembers : PermissionFlagsBits.ModerateMembers;
    if (action !== 'warn') { const issue = hierarchy(member, permission); if (issue) return fail(issue); }
    const reason = args.slice(action === 'timeout' ? 2 : 1).join(' ') || 'لم يتم تحديد سبب';
    if (action === 'ban') {
      await member.ban({ reason: reason.slice(0, 500) });
      return ok('تم حظر ' + member.user.tag + '\nالسبب: ' + reason);
    }
    if (action === 'kick') {
      const issue = hierarchy(member, PermissionFlagsBits.KickMembers); if (issue) return fail(issue);
      await member.kick(reason.slice(0, 500));
      return ok('تم طرد ' + member.user.tag + '\nالسبب: ' + reason);
    }
    if (action === 'timeout') {
      const ms = durationMs(args[1]);
      if (!ms) return fail('حدد مدة صحيحة. مثال: timeout @عضو 10m سبب');
      await member.timeout(ms, reason.slice(0, 500));
      return ok('تم إسكات ' + member.user.tag + ' لمدة ' + formatDuration(ms) + '\nالسبب: ' + reason);
    }
    const db = options.db;
    db.moderationWarnings = db.moderationWarnings || {};
    const rows = db.moderationWarnings[member.id] || (db.moderationWarnings[member.id] = []);
    rows.push({ moderator: message.author.id, reason, at: Date.now(), guildId: guild.id });
    if (rows.length > 100) rows.splice(0, rows.length - 100);
    await options.save();
    return ok('تم تسجيل تحذير على ' + member.user.tag + '. عدد التحذيرات: ' + rows.length + '\nالسبب: ' + reason);
  }

  if (action === 'unban') {
    if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) return fail('البوت لا يملك صلاحية حظر الأعضاء.');
    const id = String(args[0] || '').replace(/\D/g, '');
    if (!/^\d{15,22}$/.test(id)) return fail('الاستخدام: unban USER_ID');
    await guild.members.unban(id, args.slice(1).join(' ') || 'تم فك الحظر بواسطة الإدارة');
    return ok('تم فك الحظر عن <@' + id + '>.');
  }
  if (action === 'untimeout') {
    const member = await target(args[0]);
    if (!member) return fail('حدد عضواً صحيحاً.');
    const issue = hierarchy(member, PermissionFlagsBits.ModerateMembers); if (issue) return fail(issue);
    await member.timeout(null, args.slice(1).join(' ') || 'رفع الإسكات بواسطة الإدارة');
    return ok('تم رفع الإسكات عن ' + member.user.tag + '.');
  }
  if (action === 'warns' || action === 'clearwarns') {
    const id = String(args[0] || message.author.id).replace(/[<@!>]/g, '');
    if (!/^\d{15,22}$/.test(id)) return fail('حدد عضواً صحيحاً.');
    const db = options.db; db.moderationWarnings = db.moderationWarnings || {};
    const rows = db.moderationWarnings[id] || [];
    if (action === 'clearwarns') { delete db.moderationWarnings[id]; await options.save(); return ok('تم مسح تحذيرات <@' + id + '>.'); }
    if (!rows.length) return message.reply('📭 لا توجد تحذيرات مسجلة لهذا العضو.');
    const embed = new EmbedBuilder().setColor(COLORS.info).setTitle('⚠️ تحذيرات <@' + id + '>').setDescription(rows.slice(-15).reverse().map((w, i) => '**' + (i + 1) + '.** ' + w.reason + '\nبواسطة <@' + w.moderator + '> • <t:' + Math.floor(w.at / 1000) + ':R>').join('\n\n'));
    return message.reply({ embeds: [embed] });
  }
  if (action === 'userinfo') {
    const member = await target(args[0] || message.author.id);
    if (!member) return fail('لم أجد العضو المحدد.');
    const embed = new EmbedBuilder().setColor(COLORS.info).setTitle('👤 معلومات العضو • ' + member.user.tag).setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'المنشن', value: member.toString(), inline: true },
        { name: 'ID', value: member.id, inline: true },
        { name: 'أعلى رتبة', value: member.roles.highest.toString(), inline: true },
        { name: 'تاريخ إنشاء الحساب', value: '<t:' + Math.floor(member.user.createdTimestamp / 1000) + ':R>', inline: true },
        { name: 'تاريخ دخول السيرفر', value: member.joinedTimestamp ? '<t:' + Math.floor(member.joinedTimestamp / 1000) + ':R>' : 'غير معروف', inline: true },
        { name: 'التحذيرات', value: String((options.db.moderationWarnings?.[member.id] || []).length), inline: true },
        { name: 'الرتب', value: member.roles.cache.filter(role => role.id !== guild.id).map(role => role.toString()).slice(0, 15).join('، ') || 'لا توجد', inline: false },
      ).setTimestamp();
    return message.reply({ embeds: [embed] });
  }
  if (action === 'serverinfo') {
    const owner = await guild.fetchOwner().catch(() => null);
    const embed = new EmbedBuilder().setColor(COLORS.info).setTitle('🏠 معلومات السيرفر • ' + guild.name).setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'المالك', value: owner ? owner.user.tag : 'غير معروف', inline: true },
        { name: 'الأعضاء', value: String(guild.memberCount), inline: true },
        { name: 'القنوات', value: String(guild.channels.cache.size), inline: true },
        { name: 'الرتب', value: String(guild.roles.cache.size), inline: true },
        { name: 'تاريخ الإنشاء', value: '<t:' + Math.floor(guild.createdTimestamp / 1000) + ':R>', inline: true },
        { name: 'معرّف السيرفر', value: guild.id, inline: true },
      ).setTimestamp();
    return message.reply({ embeds: [embed] });
  }
  if (action === 'addrole' || action === 'removerole') {
    const member = await target(args[0]);
    const roleId = String(args[1] || '').replace(/[<@&>]/g, '');
    const role = guild.roles.cache.get(roleId);
    if (!member || !role) return fail('الاستخدام: ' + (action === 'addrole' ? 'addrole' : 'removerole') + ' @عضو @رتبة');
    const issue = hierarchy(member, PermissionFlagsBits.ManageRoles); if (issue) return fail(issue);
    if (role.id === guild.id || role.managed || role.position >= me.roles.highest.position) return fail('لا يمكن للبوت إدارة هذه الرتبة بسبب ترتيبها أو لأنها رتبة مُدارة.');
    const actor = guild.members.cache.get(message.author.id);
    if (actor.id !== guild.ownerId && role.position >= actor.roles.highest.position) return fail('لا يمكنك إدارة رتبة أعلى من رتبتك أو مساوية لها.');
    if (action === 'addrole') {
      if (member.roles.cache.has(role.id)) return fail('العضو يمتلك هذه الرتبة بالفعل.');
      await member.roles.add(role, 'منح رتبة بواسطة ' + message.author.tag);
      return ok('تم منح رتبة ' + role.toString() + ' إلى ' + member.toString() + '.');
    }
    if (!member.roles.cache.has(role.id)) return fail('العضو لا يمتلك هذه الرتبة.');
    await member.roles.remove(role, 'سحب رتبة بواسطة ' + message.author.tag);
    return ok('تم سحب رتبة ' + role.toString() + ' من ' + member.toString() + '.');
  }
  if (action === 'clear') {
    if (!me?.permissions.has(PermissionFlagsBits.ManageMessages)) return fail('البوت لا يملك صلاحية إدارة الرسائل.');
    const count = Number(args[0]);
    if (!Number.isInteger(count) || count < 1 || count > 100) return fail('الاستخدام: clear 1-100');
    const deleted = await message.channel.bulkDelete(count, true);
    const notice = await message.channel.send('🧹 تم حذف ' + deleted.size + ' رسالة.');
    setTimeout(() => notice.delete().catch(() => {}), 4000);
    return true;
  }
  if (action === 'lock' || action === 'unlock') {
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return fail('البوت لا يملك صلاحية إدارة القنوات.');
    await message.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: action === 'unlock' ? null : false });
    return ok(action === 'lock' ? 'تم قفل هذه القناة.' : 'تم فتح هذه القناة.');
  }
  if (action === 'slowmode') {
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return fail('البوت لا يملك صلاحية إدارة القنوات.');
    const seconds = Number(args[0]);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) return fail('الاستخدام: slowmode 0-21600 (بالثواني)');
    await message.channel.setRateLimitPerUser(seconds);
    return ok('تم ضبط التباطؤ إلى ' + seconds + ' ثانية.');
  }
  if (action === 'nick') {
    const member = await target(args[0]);
    if (!member) return fail('حدد عضواً صحيحاً.');
    const issue = hierarchy(member, PermissionFlagsBits.ManageNicknames); if (issue) return fail(issue);
    const nickname = args.slice(1).join(' ').trim();
    await member.setNickname(nickname || null);
    return ok(nickname ? 'تم تغيير لقب ' + member.user.tag + ' إلى ' + nickname : 'تمت إزالة لقب ' + member.user.tag + '.');
  }
  return false;
}

module.exports = { handleAdminCommands };
