// Golden command and game catalog, ported from the original Golden help panels.
// Discord.js v14 / no database dependency.
'use strict';

const { EmbedBuilder } = require('discord.js');

const COMMAND_GROUPS = [
  {
    name: '⚔️ أوامر التحديات والألعاب',
    value: [
      '`تحدي @عضو` — تحدي لاعب محدد.',
      '`تحدي عام` — تفعيل استقبال التحديات من الجميع.',
      '`تحدي فرندز` — قصر استقبال التحديات على الأصدقاء المتبادلين.',
      '`العاب` — عرض قائمة الألعاب.',
      '`اوامر` أو `help` — قائمة الأوامر.',
      '`بنج` — سرعة البوت.',
    ].join('\n'),
  },
  {
    name: '💰 أوامر الاقتصاد والأموال',
    value: [
      '`فلوس @عضو` — عرض الرصيد.',
      '`تحويل @عضو مبلغ` — تحويل مع تأكيد.',
      '`ربط @عضو` — ربط محفظتين بموافقة الطرف الثاني.',
      '`فصل` — فصل الحساب المرتبط.',
      '`سحب مبلغ` — طلب نقل رصيد من الحساب المرتبط بموافقة صاحبه.',
      '`إيداع مبلغ` — نقل رصيد إلى الحساب المرتبط.',
      '`tax مبلغ` أو `ضريبة مبلغ` — حساب الضريبة.',
      '`hideme / unhideme` — إخفاء أو إظهار الرصيد في العرض والترتيب.',
      '`يومي` و`عمل` — مكافآت يومية وعمل كل ساعة.',
      '`كاش` — عرض رصيد الكاش باك وسحبه بزر التأكيد (2.5% من رهانات الخسارة).',
      '`add / اضافة` و`rmv / ازالة` — تعديل رصيد بواسطة الإدارة.',
      '`setmoney` — تعيين رصيد (الأونر فقط).',
      '`totalcoins / totalwithdraw` — إحصائيات مالية للإدارة.',
    ].join('\n'),
  },
  {
    name: '👥 أوامر الأصدقاء والعلاقات',
    value: [
      '`فرند` — إضافة صديق.',
      '`حذف` — حذف صديق.',
      '`فرندز` — قائمة الأصدقاء.',
      '`بلوك` — منع لاعب من اللعب معك.',
      '`فك` — إلغاء الحظر.',
      '`بلوكز` — قائمة المحظورين.',
    ].join('\n'),
  },
  {
    name: '🎁 أوامر المكافآت والهدايا',
    value: [
      '`دايلي` — المكافأة اليومية.',
      '`بوست` — مكافأة البوست.',
      '`كاش` — استرجاع نسبة من الخسائر.',
      '`بري` أو `بريميوم` — معلومات البريميوم.',
    ].join('\n'),
  },
  {
    name: '🏠 أوامر الروم الخاص',
    value: [
      '`ad` أو `add` — إضافة شخص للروم.',
      '`rem` أو `remove` — إزالة شخص من الروم.',
      '`رومي` — معلومات الروم الخاص.',
      '`hide` أو `اخفاء` — إخفاء الروم.',
      '`show` أو `اظهار` — إظهار الروم.',
      '`unallow` — منع شخص من الكتابة.',
      '`reallow` — رفع المنع.',
    ].join('\n'),
  },
  {
    name: '📂 أوامر إضافية',
    value: [
      '`ملف` أو `معلومات` — عرض معلومات اللاعب.',
      '`اقتراح [النص]` — إرسال اقتراح للإدارة (فترة انتظار 10 دقائق).',
      '`ريب @عضو` — منح نقطة ريب (Premium، مرة كل 24 ساعة).',
      '`بوست` — استلام مكافأة Boost أسبوعية.',
      '`برايم دايلي` — المكافأة اليومية لمشتركي Prime النشطين.',
      '`توب` — ترتيب اللاعبين.',
    ].join('\n'),
  },
];

const GAMES = [
  ['🎲 لعبة النرد', 'ثلاث رميات لكل لاعب؛ يفوز صاحب المجموع الأعلى. التعادل ليس فوزاً.'],
  ['🔢 الرقم التقريبي', 'اجمع الأرقام وحاول الاقتراب من الرقم المستهدف.'],
  ['🔘 البحث عن الزر', 'اضغط الزر الصحيح قبل بقية اللاعبين.'],
  ['❌ أكس أو', 'لعبة XO بين لاعبين؛ أكمل صفاً أو عموداً أو قطراً للفوز.'],
  ['✂️ حجرة ورقة مقص', 'اختر حجراً أو ورقة أو مقصاً وتغلب على خصمك.'],
  ['🧩 التطابق', 'اكشف الأزرار المتطابقة واجمع نقاطاً أكثر من خصمك.'],
  ['💣 Bomb Chips', 'لعبة تخمين مشفرة؛ تجنب القنابل واجمع النقاط.'],
  ['🪙 قلب العملة', 'اختر الوجه أو الكتابة واربح عند صحة توقعك.'],
  ['🎡 عجلة الحظ', 'اختر الأحمر أو الأخضر أو الأسود وحاول إصابة اللون.'],
  ['🂡 بلاك جاك', 'اقترب من 21 دون تجاوزها باستخدام Hit أو Stand.'],
];

const OWNER_GROUPS = [
  {
    name: '💰 إدارة الأموال والبيانات',
    value: '`Rsall` — إعادة تعيين البيانات\n`resetdata` — إعادة تعيين البيانات الأساسية\n`rstdatagames` — إعادة تعيين بيانات الألعاب\n`totalwithdraw` — إجمالي السحوبات\n`totalcoins` — إجمالي الأرصدة',
  },
  {
    name: '🎰 إدارة اليانصيب والمسابقات',
    value: '`botola [ID] [جوائز] [قيمة]` — إنشاء بطولة/يانصيب\n`botolacancel` — إلغاء البطولة\n`deletebotola` — حذف البطولة\n`rmvusr [ID]` — إزالة لاعب\n`resetplaygame` — إعادة تعيين بيانات اللعب',
  },
  {
    name: '🔧 أوامر النظام والتصحيح',
    value: '`!resetcodes` — إعادة تعيين الأكواد\n`debughidden` — معلومات التصحيح\n`!setpermission access @user` — منح صلاحية\n`!showteam` — عرض فريق العمل',
  },
];

async function handleGoldenCatalog(message, options = {}) {
  if (!message?.guild || message.author?.bot) return false;
  const command = String(message.content || '').trim().toLowerCase();
  if (command === 'العاب') {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎮 ألعاب Golden')
      .setDescription('قائمة الألعاب الموجودة في مشروع Golden الأصلي.')
      .addFields(GAMES.map(([name, description]) => ({ name, value: description, inline: true })))
      .setFooter({ text: 'Golden Casino • قائمة الألعاب' })
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    return true;
  }
  if (['اوامر', 'مساعدة', 'help'].includes(command)) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎮 أوامر Golden Casino')
      .setDescription('الأوامر المنقولة من لوحة المساعدة في مشروع Golden.')
      .addFields(COMMAND_GROUPS.map(group => ({ ...group, inline: true })))
      .setFooter({ text: 'اكتب العاب لعرض الألعاب' })
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    return true;
  }
  if (command === 'ahelp') {
    if (!(Array.isArray(options.ownerIds) ? options.ownerIds : [options.ownerId]).filter(Boolean).map(String).includes(String(message.author.id))) {
      await message.reply('🚫 هذا الأمر مخصص للأونرز فقط.');
      return true;
    }
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('⚙️ أوامر الأونرز — AHELP')
      .setDescription('أوامر الإدارة الخاصة المنقولة من Golden.')
      .addFields(OWNER_GROUPS.map(group => ({ ...group, inline: false })))
      .setFooter({ text: 'استخدم أوامر الإدارة بمسؤولية' })
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    return true;
  }
  return false;
}

module.exports = { handleGoldenCatalog, COMMAND_GROUPS, GAMES, OWNER_GROUPS };
