import { createHash } from 'crypto';
import axios from 'axios';

let Reg = /(.*)[.|] ?([0-9]+)$/i;

let handler = async function (m, { conn, text, usedPrefix, command }) {
  text = text || '';
  let user = global.db.data.users[m.sender];
  let name2 = conn.getName(m.sender);

  if (command === 'الغاء_التسجيل' || command === 'unreg') {
    if (!user.registered) {
      await m.reply('❌ لم تقم بالتسجيل بعد.');
      return;
    }
    let sn = createHash('md5').update(m.sender).digest('hex');
    if (!text || text.trim() !== sn) {
      await m.reply(`⚠️ الرقم التسلسلي غير صحيح.\n\n📌 استخدم هذا الأمر:\n*${usedPrefix}unreg* <الرقم التسلسلي>\n\n🔑 الرقم التسلسلي الخاص بك:\n${sn}`);
      return;
    }
    delete user.name;
    delete user.age;
    delete user.regTime;
    user.registered = false;
    await m.reply('✅ تم إلغاء تسجيلك بنجاح.');
    return;
  }

  if (user.registered === true) {
    throw `✳️ لقد قمت بالتسجيل بالفعل.\n\nهل ترغب في إعادة التسجيل؟\n\n📌 استخدم هذا الأمر لحذف تسجيلك:\n*${usedPrefix}unreg* <الرقم التسلسلي>`;
  }

  if (!Reg.test(text)) {
    throw `⚠️ تنسيق غير صحيح.\n\n✳️ استخدم هذا الأمر: *${usedPrefix + command} الاسم.العمر*\n📌 مثال: *${usedPrefix + command}* ${name2}.16`;
  }

  let [_, name, age] = text.match(Reg);

  if (!name) throw '✳️ الاسم لا يمكن أن يكون فارغًا.';
  if (!age) throw '✳️ العمر لا يمكن أن يكون فارغًا.';
  if (name.length >= 30) throw '✳️ الاسم طويل جدًا.';
  age = parseInt(age);
  if (age > 100) throw '👴🏻 يبدو أن شخصًا مسنًا يريد اللعب مع البوت!';
  if (age < 5) throw '🚼 صغير جدًا للعب مع البوت!';

  user.name = name.trim();
  user.age = age;
  user.regTime = +new Date();
  user.registered = true;
  let sn = createHash('md5').update(m.sender).digest('hex');

  let txt = `
╭─「 تسجيل ناجح! 」 
│........................................ 
│🌸 الاسم: ${name} 
│🧸 العمر: ${age} سنوات 
│🔑 الرقم التسلسلي: 
│    ${sn} 
│ شكرًا لتسجيلك 
│📂 استخدم ${usedPrefix}menu لرؤية قائمة الأوامر. 
│🔒 رصيد: ${user.bank} ذهب 
│⚠️ التحذيرات: ${user.warn} 
│🌟 مميز: ${user.premium ? 'نعم' : 'لا'} 
╰─「──────────────」
`.trim();

  const url = "https://files.catbox.moe/v23rau.mp4";
  const responseVideo = await axios.get(url, { responseType: 'arraybuffer' });

  let fkontak = {
    key: {
      fromMe: false,
      participant: '0@s.whatsapp.net',
      remoteJid: 'status@broadcast'
    },
    message: {
      contactMessage: {
        displayName: `${name}`,
        vcard: `BEGIN:VCARD
VERSION:3.0
N:;${name};;;
FN:${name}
item1.TEL;waid=${m.sender.split('@')[0]}:${m.sender.split('@')[0]}
item1.X-ABLabel:Ponsel
END:VCARD`
      }
    }
  };

  await conn.sendMessage(m.chat, { video: responseVideo.data, caption: txt, gifPlayback: true }, { quoted: fkontak });
  await m.react("✅");
};

handler.help = ['reg <الاسم.العمر>', 'unreg <الرقم التسلسلي>'];
handler.tags = ['rg'];
handler.command = ['تحقق', 'تسجيل', 'سجل', 'reg', 'الغاء_التسجيل', 'unreg'];

export default handler;
