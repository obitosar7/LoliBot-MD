import { createHash } from 'crypto';
import axios from 'axios';
import { db as database } from '../lib/postgres.js';

const Reg = /(.*)[.|] ?([0-9]+)$/i;

const handler = async function (m, { conn, text = '', usedPrefix, command }) {
  const db = m.db && typeof m.db.query === 'function' ? m.db : database;
  if (!db || typeof db.query !== 'function') {
    throw '⚠️ قاعدة البيانات غير متاحة حاليًا. حاول لاحقًا.';
  }

  const name2 = await conn.getName(m.sender).catch(() => m.pushName || 'مستخدم');
  let user = (await db.query('SELECT * FROM usuarios WHERE id = $1', [m.sender])).rows[0];

  if (!user) {
    const inserted = await db.query(
      `INSERT INTO usuarios (id, nombre, num, registered)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [m.sender, m.pushName || 'sin name', m.sender.split('@')[0]]
    );
    user = inserted.rows[0] || (await db.query('SELECT * FROM usuarios WHERE id = $1', [m.sender])).rows[0];
  }

  if (command === 'الغاء_التسجيل' || command === 'unreg') {
    if (!user?.registered) {
      await m.reply('❌ لم تقم بالتسجيل بعد.');
      return;
    }
    let sn = createHash('md5').update(m.sender).digest('hex');
    if (!text || text.trim() !== sn) {
      await m.reply(`⚠️ الرقم التسلسلي غير صحيح.\n\n📌 استخدم هذا الأمر:\n*${usedPrefix}unreg* <الرقم التسلسلي>\n\n🔑 الرقم التسلسلي الخاص بك:\n${sn}`);
      return;
    }
    await db.query(
      `UPDATE usuarios
       SET nombre = $1, edad = NULL, reg_time = NULL, serial_number = NULL, registered = false
       WHERE id = $2`,
      ['sin name', m.sender]
    );
    await m.reply('✅ تم إلغاء تسجيلك بنجاح.');
    return;
  }

  if (user?.registered) {
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

  let sn = createHash('md5').update(m.sender).digest('hex');

  const updateRes = await db.query(
    `UPDATE usuarios
     SET nombre = $1, edad = $2, reg_time = NOW(), serial_number = $3, registered = true
     WHERE id = $4
     RETURNING *`,
    [name.trim(), age, sn, m.sender]
  );
  user = updateRes.rows[0] || user;

  let txt = `
╭─「 تسجيل ناجح! 」 
│........................................ 
│🌸 الاسم: ${name} 
│🧸 العمر: ${age} سنوات 
│🔑 الرقم التسلسلي: 
│    ${sn} 
│ شكرًا لتسجيلك 
│📂 استخدم ${usedPrefix}menu لرؤية قائمة الأوامر. 
│🔒 رصيد: ${user?.banco ?? 0} ذهب 
│⚠️ التحذيرات: ${user?.warn ?? 0} 
│🌟 مميز: ${(user?.premium ?? false) ? 'نعم' : 'لا'} 
╰─「──────────────」
`.trim();

  const videoUrl = 'https://files.catbox.moe/v23rau.mp4';
  let videoPayload = null;
  try {
    const responseVideo = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    videoPayload = responseVideo?.data || null;
  } catch (error) {
    console.error('Failed to download registration video:', error);
  }

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

  const messageOptions = videoPayload
    ? { video: videoPayload, caption: txt, gifPlayback: true }
    : { video: { url: videoUrl }, caption: txt, gifPlayback: true };

  await conn.sendMessage(m.chat, messageOptions, { quoted: fkontak });
  await m.react("✅");
};

handler.help = ['reg <الاسم.العمر>', 'unreg <الرقم التسلسلي>'];
handler.tags = ['rg'];
handler.command = ['تحقق', 'تسجيل', 'سجل', 'reg', 'الغاء_التسجيل', 'unreg'];

export default handler;
