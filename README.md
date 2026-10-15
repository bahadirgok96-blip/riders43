# Riders 43

Bağımlılıksız (yalnızca Node.js 20+) üye uygulaması.

## Çalıştırma
    npm start          # üretim modu, http://localhost:3000 (HTTPS arkasında çalıştırın)
    npm test           # yetki testleri
    npm run build      # sözdizimi + test + gizli anahtar taraması + dist/

## İlk kurulum
Sunucu ilk açılışta konsola iki ayrı **tek kullanımlık kurulum kodu** yazar (başkan, teknik yönetici).
1. Tarayıcıda "Başkan kurulumunu başlat" → konsoldaki başkan kodu + kendi bilgilerin.
2. Teknik yönetici için ayrı kod ve ayrı e-posta ile ikinci hesap oluşturulur (roller ayrıdır).
Kurulum tamamlanınca uç nokta kalıcı olarak 404 döner; sonrasında üyelik yalnızca davet kodu + başkan onayıyla olur.
5 yanlış denemede kod yenilenir. Veriler `data/db.json` içinde (git'e eklenmez). Şifreler scrypt ile saklanır.

## Roller
- Başkan: başvuru, davet, duyuru, toplantı
- Sürüş odası yöneticisi: toplantı
- Teknik yönetici: rol/durum yönetimi, işlem kayıtları
