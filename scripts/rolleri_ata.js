#!/usr/bin/env node
/*
 * scripts/rolleri_ata.js — Firebase hesaplarına rol etiketi (custom claim) koyar.
 * Elle çalıştırılır:  cd scripts && node rolleri_ata.js --dry   (önce sadece rapor)
 *                                    node rolleri_ata.js         (etiketleri yazar)
 *
 * Neden: Admin yetkisi eskiden yalnızca e-posta uzantısından (@admin...) anlaşılıyordu. Etiketi ise
 * yalnızca servis hesabı anahtarı olan biri (bu betik) koyabilir; veritabanı kuralları (kurallar.json)
 * yetkiyi bu etikete bakarak verir.
 *
 * Her hesaba konan etiket:  { rol: "admin" | "sube" | "grup", u: "<kullanıcı adı>" }
 *   - admin : yalnızca ADMIN_LISTESI'ndeki kullanıcı adları + @admin.disticaretradar.local
 *   - sube  : @sube.disticaretradar.local (şubeler ve misafir hesapları)
 *   - grup  : @grup.disticaretradar.local (departman hesapları)
 * Listede olmayan admin hesapları ve tanınmayan e-postalar etiketsiz kalır (kurallar onlara hiçbir şey açmaz).
 *
 * Konsoldan yeni hesap eklediğinde bu betiği tekrar çalıştır. Etiket kullanıcının tarayıcısına en geç
 * 1 saat içinde ya da yeniden girişte ulaşır (index_153'ten itibaren uygulama açılışta kendisi yeniler).
 */
"use strict";
require("dotenv").config();
const path = require("path");
const admin = require("firebase-admin");

// Admin olabilecek tek kullanıcı adları. Yeni admin eklemek için buraya da yaz.
const ADMIN_LISTESI = ["dtpadmin"];

const ALAN = {
  "admin.disticaretradar.local": "admin",
  "sube.disticaretradar.local": "sube",
  "grup.disticaretradar.local": "grup",
};

const DRY = process.argv.includes("--dry");
const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(SA_PATH))) });

function hedefEtiket(email){
  const [u, alan] = String(email || "").toLowerCase().split("@");
  const rol = ALAN[alan];
  if (!u || !rol) return null;
  if (rol === "admin" && !ADMIN_LISTESI.includes(u)) return null;
  return { rol, u };
}

(async () => {
  const sayac = { admin: 0, sube: 0, grup: 0, etiketsiz: 0, degisen: 0 };
  let sayfa;
  do {
    const sonuc = await admin.auth().listUsers(1000, sayfa);
    for (const user of sonuc.users) {
      const hedef = hedefEtiket(user.email);
      const mevcut = user.customClaims || {};
      if (hedef) sayac[hedef.rol]++; else sayac.etiketsiz++;
      const ayni = hedef ? (mevcut.rol === hedef.rol && mevcut.u === hedef.u) : (!mevcut.rol && !mevcut.u);
      if (ayni) continue;
      sayac.degisen++;
      console.log(`${DRY ? "[deneme] " : ""}${user.email || user.uid}: ${JSON.stringify(mevcut)} → ${JSON.stringify(hedef || {})}`);
      if (!DRY) {
        // Diğer etiketlere dokunma, yalnızca rol/u alanlarını güncelle
        const { rol, u, ...digerleri } = mevcut;
        await admin.auth().setCustomUserClaims(user.uid, hedef ? { ...digerleri, ...hedef } : digerleri);
      }
    }
    sayfa = sonuc.pageToken;
  } while (sayfa);

  console.log(`\nAdmin: ${sayac.admin} · Şube/misafir: ${sayac.sube} · Departman: ${sayac.grup} · Etiketsiz: ${sayac.etiketsiz}`);
  console.log(DRY ? `${sayac.degisen} hesap değişecekti (--dry: hiçbir şey yazılmadı).` : `${sayac.degisen} hesabın etiketi güncellendi.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
