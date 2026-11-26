'use strict';
const { EmbedBuilder } = require('discord.js');
async function handleGoldenOwnerCommands(message, options = {}) {
 if (!message?.guild || message.author?.bot) return false;
 const args=String(message.content||'').trim().split(/\s+/); const command=(args.shift()||'').toLowerCase();
 const owners=(options.ownerIds||[]).map(String); const isOwner=owners.includes(String(message.author.id));
 const db=options.db||{}; const save=options.save||(async()=>{}); const reply=content=>message.reply(content);
 const activeTournament=()=>Object.values(db.tournaments||{}).find(row=>row&&row.status==='active');
 const known=['rsall','resetdata','rstdatagames','resetplaygame','resetcodes','!resetcodes','debughidden','showteam','!showteam','rmvusr','botolacancel','deletebotola','botola'];
 if(!known.includes(command)) return false; if(!isOwner){await reply('🚫 هذا الأمر مخصص للأونرز فقط.');return true;}
 if(command==='showteam'||command==='!showteam'){const team=[...new Set([...(options.ownerIds||[]),...(options.adminIds||[])].map(String))];return reply({embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('👥 فريق العمل').setDescription(team.map((id,i)=>'**'+(i+1)+'.** <@'+id+'> — '+id).join('\n')||'لا يوجد أعضاء مسجلون.').setTimestamp()]});}
 if(command==='debughidden'){const hidden=Object.entries(db.users||{}).filter(([,u])=>u&&(u.hidden===true||u.hideBalance===true||u.hiddenBalance===true));return reply({embeds:[new EmbedBuilder().setColor(0x5865f2).setTitle('🔎 Debug Hidden').setDescription('الحسابات المخفية المكتشفة: **'+hidden.length+'**\n'+(hidden.slice(0,25).map(([id])=>'<@'+id+'> ('+id+')').join('\n')||'لا توجد حسابات مخفية حسب حقول البيانات المعروفة.')).setTimestamp()]});}
 if(command==='resetcodes'||command==='!resetcodes'){const count=Object.keys(db.redeemCodes||{}).length;if(args[0]!=='تأكيد')return reply('⚠️ سيحذف هذا الأمر جميع أكواد الاسترداد ('+count+'). للتأكيد اكتب: !resetcodes تأكيد');db.redeemCodes={};await save();return reply('✅ تم حذف جميع أكواد الاسترداد ('+count+').');}
 if(command==='rstdatagames'||command==='resetplaygame'){const count=Object.keys(db.games||{}).length;if(args[0]!=='تأكيد')return reply('⚠️ سيحذف بيانات جلسات الألعاب الحالية ('+count+'). للتأكيد اكتب: '+command+' تأكيد');db.games={};db.botChallenges={};await save();return reply('✅ تمت إعادة تعيين بيانات جلسات الألعاب والتحديات.');}
 if(command==='rmvusr'){const id=String(args[0]||'').replace(/[<@!>]/g,'');if(!/^\d{15,22}$/.test(id))return reply('الاستخدام: rmvusr USER_ID');const t=activeTournament();if(!t||!t.participants||!t.participants[id])return reply('هذا العضو غير مسجل في البطولة النشطة.');delete t.participants[id];await save();if(typeof options.refreshTournamentBoard==='function')await options.refreshTournamentBoard(t);return reply('✅ تمت إزالة <@'+id+'> من البطولة النشطة.');}
 if(command==='botolacancel'||command==='deletebotola'){const t=activeTournament();if(!t)return reply('لا توجد بطولة نشطة حالياً.');if(typeof options.finishTournament!=='function')return reply('تعذر تنفيذ الإلغاء: وظيفة إدارة البطولة غير متاحة.');await options.finishTournament(t,true);return reply('✅ تم إلغاء البطولة النشطة.');}
 if(command==='botola')return reply('صيغة إنشاء البطولة المتاحة حالياً:\n!competition 2d 100m 500m 1000m 3000m\nالترتيب: المدة، جائزة المراكز 4-10، الأول، الثاني، الثالث.');
 if(command==='resetdata'||command==='rsall'){const count=Object.keys(db.users||{}).length;if(args[0]!=='تأكيد')return reply('⚠️ إعادة تعيين بيانات الحسابات عملية نهائية. عدد الحسابات: '+count+'. للتأكيد اكتب: '+command+' تأكيد');db.users={};db.games={};db.liveBets=[];db.withdrawals={};db.processedTransfers={};db.creditReviews={};db.transfers={};db.linkRequests={};db.linkedAccounts={};db.linkCooldowns={};db.linkedWithdrawals={};db.tournaments={};db.privateRooms={};db.blackjack={};db.wheel={};db.botChallenges={};db.redeemCodes={};db.adminLogs=[];await save();return reply('✅ تمت إعادة تعيين بيانات الكازينو. أُبقيت إعدادات البوت كما هي.');}
 return false;
}
module.exports={handleGoldenOwnerCommands};
