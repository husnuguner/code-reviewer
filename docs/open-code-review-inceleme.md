# alibaba/open-code-review İncelemesi — Bizim Yapıya Katabileceklerimiz

Kaynak: <https://github.com/alibaba/open-code-review> (Go, Apache-2.0, `ocr` CLI).
İnceleme tarihi: 2026-02. Karşılaştırılan bizim taraf: bu repo (`code-reviewer`,
TypeScript, PR odaklı, skill tabanlı).

İki aracın çıkış noktası farklı: OCR **yerel git + CLI + agent (tool kullanan model)**
üzerine kurulu, biz ise **PR merkezli, tek model çağrısı, deterministik posting
politikası** üzerine kuruluyuz. Bu yüzden aşağıdaki maddelerin bir kısmı doğrudan
kopyalanabilir, bir kısmı bizim ADR'lerimizle çelişiyor — her maddede bunu ayrıca
belirttim.

Okuma sırası: önce **Özet** tablosu, sonra ilgilendiğiniz maddenin **D\<n\>** detayı.

---

## Özet

### A. İnceleme kalitesi (precision / recall)

| #   | Özellik                                     | Ne sağlar                                                                                                                                           | Değer  | Efor       | Öneri               |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------- |
| D1  | Yorum doğrulama turu (`REVIEW_FILTER_TASK`) | Model bulgularını ikinci bir "fact-checker" çağrısı eler; yalnız **diff'in kanıtladığı** yanlışlar silinir, hafıza/eşzamanlılık gibi konular vetolu | Yüksek | Düşük-Orta | ✅ **Yapıldı**      |
| D2  | Anchor kurtarma turu (re-location)          | Alıntı eşleşmeyince modelden `existing_code`'u yeniden üretmesini isteyip tekrar dener; bizde `failed` → satırsız bulgu                             | Yüksek | Düşük      | **Al**              |
| D3  | Semantik dosya gruplama                     | İlişkili dosyalar (ör. `message_en/zh.properties`, impl+header) tek incelemede; cross-file tutarsızlık yakalanır, token düşer                       | Yüksek | Yüksek     | Aşamalı al          |
| D4  | Bağlam araçları (tool-use)                  | `file_read`, `code_search`, `file_find`, `file_read_diff` ile model diff dışını okur; "varsayıma dayalı bulgu" azalır                               | Yüksek | Yüksek     | Karar gerekir (ADR) |
| D5  | Plan turu (`PLAN_TASK`)                     | İnceleme öncesi risk noktaları + hangi aracın neden çağrılacağı planı                                                                               | Orta   | Orta       | Opsiyonel           |
| D6  | `--background` / `--background-file`        | İş gereksinimi/bağlamı prompta enjekte edilir; "bu değişiklik neden yapıldı" bilgisi                                                                | Orta   | Çok düşük  | **Al**              |
| D7  | `category` + `suggestion_code` alanları     | Bulgu kategorisi (bug/security/…/test/style/docs) ve GitHub `suggestion` bloğu                                                                      | Yüksek | Düşük      | **Al**              |
| D8  | `--effort` (low/medium/high)                | Tur sayısı/token limitini tek bayrakla ayarlama                                                                                                     | Düşük  | Düşük      | Opsiyonel           |

### B. Kapsam, güvenlik, maliyet

| #   | Özellik                                        | Ne sağlar                                                                                                                               | Değer             | Efor      | Öneri          |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------- | -------------- |
| D9  | Gizli dosya kara listesi + uzantı allowlist    | `**/.ssh/**`, `id_rsa`, `.npmrc`… LLM'e **hiç** gönderilmez; 111 uzantılık destek listesi                                               | Yüksek (güvenlik) | Çok düşük | ✅ **Yapıldı** |
| D10 | Deterministik dosya seçimi + dışlama gerekçesi | Tek saf fonksiyon her dosya için `none/deleted/too_large/binary/secret/ext` döner; önizleme ile gerçek çalışma aynı fonksiyonu kullanır | Yüksek            | Düşük     | ✅ **Yapıldı** |
| D11 | `--preview`                                    | Model çağırmadan "ne incelenecek, ne neden elendi"                                                                                      | Orta              | Düşük     | ✅ **Yapıldı** |
| D12 | Token bütçesi + ön maliyet tahmini             | `--max-tokens-budget`, grup öncesi look-ahead ile durdurma, çalışma öncesi tahmini maliyet                                              | Yüksek            | Orta      | **Al**         |
| D13 | Kapsam manifestosu (`ocr.run-manifest/v1`)     | Sürümlü, makine okunur "hangi dosya incelendi / atlandı / başarısız" kaydı                                                              | Orta              | Orta      | Sonra          |

### C. Çalışma modları

| #   | Özellik                              | Ne sağlar                                                                                                                               | Değer  | Efor        | Öneri       |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------- | ----------- |
| D14 | Workspace + `--commit` modu          | Staged/unstaged/untracked değişiklikleri ve tek commit'i inceleme (commit öncesi döngü)                                                 | Yüksek | Düşük       | **Al**      |
| D15 | Oturum + `--resume`                  | Yarıda kalan inceleme kaldığı yerden devam; yeniden ücret ödenmez                                                                       | Orta   | Orta        | Sonra       |
| D16 | `scan` (diff'siz tam dosya taraması) | Yeni devralınan kod tabanını/dizini denetleme                                                                                           | Orta   | Orta-Yüksek | Sonra       |
| D17 | Delegate modu                        | Dosya seçimi + kural eşleşmesini biz yapıp incelemeyi kullanıcının agent'ına (Claude Code/Codex/Cursor) devretme; API anahtarı gerekmez | Orta   | Düşük-Orta  | Değerlendir |

### D. Çıktı ve entegrasyon

| #   | Özellik                             | Ne sağlar                                                                                                                                             | Değer  | Efor   | Öneri                          |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------------------------------ |
| D18 | SARIF v2.1.0 çıktısı                | GitHub Code Scanning/IDE'ye bulgu akışı, kararlı fingerprint                                                                                          | Orta   | Düşük  | **Al**                         |
| D19 | Sticky özet + artımlı gönderim      | Tek marker'lı güncellenen özet yorumu, IoU örtüşmeyle tekrar engelleme, 50'lik batch, inline başarısızsa özete düşürme, severity/kategori yönlendirme | Yüksek | Orta   | **Al**                         |
| D20 | Hazır GitHub Action / CI paketi     | `uses:` ile kurulumsuz PR incelemesi (ayrıca GitLab/Gerrit)                                                                                           | Orta   | Orta   | Sonra                          |
| D21 | Oturum görüntüleyici (yerel web UI) | Geçmiş incelemeleri tarayıcıda gezme, "düzeltildi/yok say" işaretleme                                                                                 | Düşük  | Yüksek | Alma                           |
| D22 | Telemetri (OTel) + retry raporu     | Span/metrik/olay; sürümlü hata sınıflandırması (`rate_limited`, `overloaded`, …)                                                                      | Orta   | Orta   | Kısmi al (retry sınıflandırma) |

### E. LLM dayanıklılığı

| #   | Özellik                                        | Ne sağlar                                                                      | Değer                | Efor  | Öneri                 |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------ | -------------------- | ----- | --------------------- |
| D23 | Bağlam sıkıştırma (%60 async / %80 senkron)    | Uzun tool döngülerinde context taşmasını önler                                 | Koşullu (D4 gelirse) | Orta  | D4 ile                |
| D24 | Tool hata serisi kesici + argüman JSON onarımı | Aynı hatayı tekrar eden modeli durdurur; bozuk JSON'u kurtarır                 | Orta                 | Düşük | **Al** (JSON onarımı) |
| D25 | Prompt cache affinity anahtarı                 | Konuşma başına stabil anahtar → sağlayıcı prompt cache isabeti, maliyet düşüşü | Orta                 | Düşük | **Al**                |

### F. Kural yönetimi ve proje disiplini

| #   | Özellik                                                          | Ne sağlar                                                                             | Değer      | Efor   | Öneri                                     |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------- |
| D26 | Dile göre yerleşik kural kütüphanesi (50+ `rule_docs`) + sniffer | `**/*.go` → `go.md`, `**/pom.xml` → `pom_xml.md` … kurulumsuz anlamlı inceleme        | Orta       | Orta   | **ADR 0003 ile çelişir** — bilinçli karar |
| D27 | Repo içi `.opencodereview/rule.json` + `merge_system_rule`       | Kuralı repo'nun kendi içinde tutma ve sistem kuralıyla birleştirme/değiştirme bayrağı | Orta       | Düşük  | Kısmi al (bayrak fikri)                   |
| D28 | Kalite ölçümü (AACR-Bench: 200 PR, 1505 etiketli bulgu)          | Precision/recall/F1 ile prompt değişikliğinin etkisini ölçme                          | Yüksek     | Yüksek | **Al** (küçük ölçekli eval)               |
| D29 | `ASSURANCE_CASE.md` + tehdit modeli, `AGENTS.md` disiplini       | Güven sınırları tablosu, %90 kapsam eşiği, lisans başlığı/i18n senkron kontrolleri    | Düşük-Orta | Düşük  | Kısmi al                                  |

### Önerilen sıra

- **Dalga 1 (hızlı kazanç, mimariye dokunmaz):** ~~D9~~, ~~D10~~, ~~D11~~ (✅ yapıldı), D7, D6, D2, D25, D24
- **Dalga 2 (orta):** ~~D1~~ (✅ yapıldı), D19, D12, D14, D18
- **Dalga 3 (mimari karar gerektirir):** D3, D4 (+D23), D15, D28

### Bizde zaten daha iyi/farklı olanlar

Rapor tek yönlü olmasın: OCR'da olmayan, bizde olan şeyler —

- **Mevcut PR tartışmasının prompta geri beslenmesi** (`orchestrator.priorDiscussion` →
  `prompts.buildUserPrompt`): model, daha önce söylenmiş ve cevaplanmış konuyu tekrar
  etmiyor. OCR bunu yalnız **gönderim anında** (IoU örtüşme) eliyor, prompt seviyesinde değil.
- **Anchor çatışma politikası ve sayaçları** (`anchor.ts`, `counterLine`): `exact/repaired/
conflict/failed` ayrımı ve her koşuda ölçülmesi. OCR'ın çözümleyicisi bu kadar açık
  ölçülebilir değil.
- **Çok projeli katalog** (`config.json`: named repo providers + projects + defaults miras
  zinciri) ve tanınmayan anahtarı reddetme. OCR tek repo/tek çalışma odaklı.
- **PR tarama ve gönderme akışı doğrudan bizde** (REST): OCR'ın PR entegrasyonu ayrı bir
  GitHub Action script'inde (`scripts/github-actions/post-review-comments.js`) yaşıyor.
- **Derin modül disiplini**: ADR'ler, `CONTEXT.md` sözlüğü, Python paritesi fixture testleri.

---

## Detaylar

### D1. Yorum doğrulama turu (review filter) — ✅ YAPILDI

**OCR'da:** İnceleme bittikten sonra her dosya grubu için ikinci bir LLM çağrısı yapılıyor
(`internal/agent/agent.go:1776 executeGroupReviewFilter`, prompt:
`internal/config/template/prompts/review_filter_task_system.md`). Prompt üç şeyi çok net
kuruyor:

1. **Asimetrik maliyet:** "Yanlış bir yorumu tutmak, insanın birkaç saniyesine mal olur.
   Doğru bir yorumu silmek, gerçek bir bulguyu sessizce yok eder." → Kanıt yetmiyorsa **onayla**.
2. **Sadece iki silme gerekçesi:** (A) yorum, konu dosyasının diff'inde olmayan koda
   atıfta bulunuyor; (B) belirli bir diff satırı, yorumun ana iddiasını **kelimesi kelimesine**
   çürütüyor. Zincirleme çıkarım yasak.
3. **Dokunulmaz konular (veto):** bellek güvenliği, eşzamanlılık, linkage/bildirim tutarlılığı,
   davranış/uyumluluk değişikliği, kullanılmayan parametre → doğruluk tartışması bile açılmadan onaylanır.

Ayrıca `--no-filter` bayrağıyla kapatılabiliyor.

**Bizde:** Yok. Model ne üretirse (severity ve `maxFindingsPerFile` filtrelerinden geçerek)
gidiyor. Hacim kontrolümüz var (`dedup.selectInline`), **doğruluk** kontrolümüz yok.

**Uyarlama:** `src/core/review/` içine `verify.ts` — girdi: bir dosyanın (ileride grubun)
bulguları + annotated diff; çıktı: silinecek bulgu indeksleri. `orchestrator.review`
akışında `asComments` öncesine takılır. Politika metni `prompts/` altında ayrı dosya olmalı
(bizde prompt metni davranışsal sözleşme, fixture ile donuyor). Sayaç ekle:
`filtered=<n>` → `counterLine`'a yeni alan; böylece filtrenin ne kadar kestiği ölçülebilir olur.

**Maliyet/Risk:** Dosya (veya grup) başına +1 çağrı, küçük prompt. Asıl risk doğru bulguyu
silmek; OCR'ın veto listesi + "kanıt yoksa onayla" kuralı birebir alınmalı. `--no-verify`
bayrağıyla kapatılabilir olmalı.

**Ne yapıldı:**

| Parça                                                                           | Yer                                                                                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Politika metni (asimetrik maliyet, iki gerekçe, veto listesi, çıktı sözleşmesi) | `prompts/verify.md` (çekirdeğin malı, operatör değiştiremez)                                             |
| Çağrı + ayrıştırma + fail-open                                                  | `src/core/review/verify.ts` (`FindingVerifier`, `buildVerifyPrompt`, `removalsFrom`)                     |
| Her iki akışa da bağlanması                                                     | `src/core/review/changed-file.ts` (`PerFileVerifier`, aynı eşzamanlılık slotu içinde)                    |
| Ölçüm                                                                           | PR modunda `counters: ... refuted=<n>` (yalnız >0 iken), branch modunda `summary.refuted`                |
| Kapatma                                                                         | `--no-verify` bayrağı, `verify: false` proje anahtarı, `REVIEW_VERIFY=false`                             |
| Testler                                                                         | `tests/contracts/verify.contract.test.ts` + `tests/fixtures/verify.json` (20 vaka)                       |
| Belge                                                                           | README "Verification" bölümü, `CONTEXT.md` sözlüğüne **Verification** terimi, `docs/config.example.yaml` |

Uygulamadaki iki bilinçli karar:

1. **Doğrulama dosya adımının içinde, orkestratörün değil** (rapor orkestratörü önermişti):
   `changed-file.ts` iki akışın da paylaştığı adım, dolayısıyla branch review de bedavaya
   aynı korumayı aldı. Ayrıca iki model çağrısı **tek eşzamanlılık slotunu** paylaşıyor;
   doğrulamayı slotun dışında çalıştırmak uçuştaki iş miktarını sessizce ikiye katlardı.
2. **Fail-open kodda da zorunlu, sadece promptta değil.** Çağrı hatası, JSON olmayan yanıt,
   var olmayan indeks, bozuk kayıt — hepsi bulguyu ayakta bırakıyor; JSON ayrıştırması
   **yeniden denenmiyor bile** (bulgu incelemesinde bir tur yeniden deniyoruz, çünkü orada
   bedel dosyanın tüm bulguları; burada bedel yalnızca okunacak fazladan bir bulgu).

---

### D2. Anchor kurtarma turu (re-location)

**OCR'da:** `existing_code` alıntısı diff'te eşleşmezse, yorum çöpe atılmıyor: modele
diff + mevcut alıntı + yorum içeriği verilip **yeni bir alıntı** üretmesi isteniyor, sonra
eşleştirme tekrar deneniyor (`internal/diff/relocation.go`, `internal/llmloop/loop.go:695`).
Prompt ayrı bir şablon (`re_location_task_*.md`) ve yoksa adım tamamen atlanıyor.

**Bizde:** `resolveAnchor` iki sinyali (satır no + alıntı) birleştiriyor; ikisi de tutmazsa
sonuç `failed` ve bulgu satırsız olarak review gövdesine düşüyor (`anchor.ts`, `render.ts`).
Bu, OCR'ın metin eşleştirmesinden **daha iyi** bir başlangıç; eksik olan tek şey son şans turu.

**Uyarlama:** `changed-file.ts` içinde, `outcome === FAILED` olan bulgular için tek toplu
çağrı: "şu bulgu için diff'ten birebir 1-3 satır alıntıla". Dönen alıntıyla `resolveAnchor`
tekrar çağrılır; başarılıysa yeni bir outcome değeri (`relocated`) sayaçlara eklenir. Mevcut
`anchor_*` sayaç mekanizması bunu bedavaya raporlar.

**Maliyet/Risk:** Yalnız `failed` bulgular için, dosya başına en fazla 1 ek çağrı. Risk düşük;
kurtarılamazsa bugünkü davranış aynen kalıyor.

---

### D3. Semantik dosya gruplama

**OCR'da:** Değişen dosyalar **içerikleri gönderilmeden**, yalnız metadata ile bir LLM
çağrısına verilip anlamlı gruplara bölünüyor (`internal/agent/grouping.go`). Detaylar:

- Grup başına en fazla 10 dosya (`maxFilesPerGroup`).
- Model yanıtında dosya **path'i değil index** dönüyor — çıktı token'ı ucuzluyor, büyük
  değişim setlerinde yanıtın kesilmesi engelleniyor.
- Eşik altındaki küçük değişim setleri tek gruba ("small change set") konuyor, tek dosyada
  gruplama çağrısı hiç yapılmıyor.
- Hata halinde dosya başına bir gruba düşüyor (bizim bugünkü davranışımız).
- Her grup **izole context'li bir alt-görev** olarak koşuyor → böl-yönet; eşzamanlılık doğal.

Ana prompt da bunu destekliyor: `<review_files>` içindeki **her dosyanın kendi geçişini
almış olması** `task_done` öncesi şart koşuluyor; grup içi cross-file gözlemler teşvik ediliyor.

**Bizde:** Birim = dosya (`reviewFiles` → `reviewChangedFile`). Bir `route.ts` ile onun
`validators.ts`'i asla aynı promptta görünmüyor; "şema değişti ama route güncellenmemiş"
sınıfı bulgular yapısal olarak bulunamaz.

**Uyarlama:** İki aşamalı gidilebilir:

1. **Ucuz sürüm (LLM'siz):** dizin + dosya adı kökü ile deterministik gruplama
   (`foo.ts`/`foo.test.ts`/`foo.types.ts`, aynı klasördeki `route.ts`+`validators.ts`).
   Mevcut `ChangedFile` listesi üzerinde saf fonksiyon, test edilmesi kolay.
2. **Tam sürüm:** metadata-only gruplama çağrısı, index tabanlı yanıt, hata halinde
   dosya-başı fallback.

Her iki durumda `PerFileReviewer` → `PerGroupReviewer` genişlemesi gerekir; anchor
çözümlemesi zaten path bazlı olduğu için grup içindeki her bulgunun `path`'i taşıması şart
(OCR'ın `code_comment` şemasında `path` zorunlu alan — aynı sebeple).

**Maliyet/Risk:** Orkestratör + prompt sözleşmesi + fixture'ların hepsi değişir; en pahalı
madde. Kazanç: cross-file bulgular, daha az çağrı, daha az tekrar.

---

### D4. Bağlam araçları (tool-use)

> Ayrıntılı analiz ve karar noktaları: [open-code-review-d4-analiz.md](open-code-review-d4-analiz.md)

**OCR'da:** Model, review sırasında 6 aracı çağırabiliyor
(`internal/config/toolsconfig/tools.json`, `internal/tool/*`):

| Araç             | İşi                                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| `code_comment`   | Bulguyu bildirir (yapılandırılmış çıktı buradan gelir)                 |
| `code_search`    | Dosya/dizin/repo içinde metin arama                                    |
| `file_read`      | Tam dosya veya satır aralığı okuma                                     |
| `file_read_diff` | **Başka** değişen dosyanın diff'ini okuma (filtrelenmiş olanlar dahil) |
| `file_find`      | Dosya adı ile arama                                                    |
| `task_done`      | Görevi sonlandırma                                                     |

README'deki iddia önemli: bu takım seti, üretimdeki tool-call trace'lerinin analiziyle
(çağrı sıklığı, tekrar oranı, yeni aracın zincire etkisi) damıtılmış — genel amaçlı agent
takımından daha dar ve daha öngörülebilir. Benchmark iddiası da buraya bağlı: aynı modelle
Claude Code'a göre daha yüksek precision/F1, **~1/9 token**.

**Bizde:** Model hiç araç çağırmıyor (`prompts.ts`: "the model never calls tools"). Bağlam
olarak yalnız annotated diff + (patch küçükse) dosyanın tam içeriği veriliyor. Bu, bizim
`anchor`/posting determinizmimizi kolaylaştıran bilinçli bir sadelik — ama modelin
"bu fonksiyon başka yerde de kullanılıyor mu" sorusunu **sorma imkânı yok**, dolayısıyla
varsayıma dayalı bulgu üretiyor.

**Uyarlama:** Bu bir ADR konusu. Dar bir kapsam mümkün: yalnız **iki** araç —
`read_file(path, start?, end?)` ve `grep(pattern, glob?)` — repo provider üzerinden salt
okunur, PR head SHA'sına sabitlenmiş, çağrı sayısı üst sınırlı (ör. dosya başına 6).
`ai` SDK'sı zaten tool-calling destekliyor; asıl iş `RepoProvider` portuna okuma/arama
operasyonu eklemek ve tur döngüsünü yazmak.

**Maliyet/Risk:** En büyük mimari değişiklik. Beraberinde D23 (bağlam sıkıştırma) ve
D24 (hata serisi kesici) ihtiyacı geliyor — OCR'da bu üçü birlikte var, tesadüf değil.
Ayrıca ADR 0001'in ruhu (dar, denetlenebilir yüzey) korunmalı: araç seti kapalı liste olmalı.

---

### D5. Plan turu (PLAN_TASK)

**OCR'da:** Asıl incelemeden önce model bir **plan** üretiyor
(`prompts/plan_task_system.md`): değişikliğin özeti + `[high|medium|low]` etiketli risk
maddeleri + her madde için "hangi aracı, hangi argümanla, neden çağırmalı" satırları.
Araçlar bu turda **çağrılmıyor**, yalnız niyet yazılıyor. Çıktı formatı katı düz metin
(markdown başlığı, kod bloğu yasak) ve "risk yoksa `(none)` yaz, madde uydurma" kuralı var.
`--no-plan` ile kapatılabiliyor.

**Bizde:** Yok; tek geçişli inceleme.

**Uyarlama:** Tool-use (D4) gelmeden planın değeri sınırlı — planın asıl işi araç
çağrılarını odaklamak. D4 alınırsa birlikte alınmalı. Tool-use'suz bir varyantı yine de
işe yarayabilir: "önce riskleri say, sonra yalnız saydıklarını raporla" iki-aşamalı prompt,
model odağını dağıtmayı azaltır.

---

### D6. `--background` (iş bağlamı)

**OCR'da:** `--background "kısa gereksinim özeti"` veya `--background-file notes.md`
(`cmd/opencodereview/shared_flags.go:30`). Kendi `AGENTS.md`'lerinde commit öncesi
`ocr review --audience agent --background "..."` çalıştırmayı zorunlu kılmışlar.
Ayrıca `--audience human|agent`: agent için ilerleme çıktısı kapalı, sadece özet.

**Bizde:** Yok. Model, değişikliğin **neden** yapıldığını asla bilmiyor; PR başlığı/gövdesi
bile prompta girmiyor.

**Uyarlama:** İki ucuz adım:

1. `--background <metin>` / `--background-file <yol>` bayrağı → `buildUserPrompt`'a yeni
   opsiyonel blok.
2. PR modunda **bedava bağlam**: PR başlığı + gövdesi zaten `listOpenPrs`/`headSha`
   çağrılarının yanında alınabiliyor; prompta "değişikliğin beyan edilen amacı" olarak
   eklenir. "Beyan edilen amaç ile kod uyuşmuyor" başlı başına değerli bir bulgu sınıfı.

**Maliyet/Risk:** Çok düşük. Prompt fixture'ı güncellenir.

---

### D7. `category` + `suggestion_code`

**OCR'da:** `code_comment` aracının şeması
(`internal/config/toolsconfig/tools.json`): `content`, `existing_code`, `suggestion_code`,
`category` (bug | security | performance | maintainability | test | style | documentation |
other), `severity` (critical | high | medium | low), `path`. `suggestion_code`, GitHub'ın
` ```suggestion ` bloğuna dönüşerek tek tıkla uygulanabilir düzeltme üretiyor;
`internal/suggestdiff/diff.go` bunun diff'ini hesaplıyor.

**Bizde:** `severity` var (bug/security/performance/readability — kategori ve şiddet **aynı**
eksende toplanmış), `suggestion_code` yok. `src/core/domain/finding.ts` + `severity.ts` +
`render.commentBody` üçlüsü değişir.

**Uyarlama:** İki ayrı iş, ayrı ayrı alınabilir:

- **`suggestion_code`:** Findings şemasına opsiyonel alan; `commentBody` bunu
  ` ```suggestion ` bloğu olarak ekler. **Kritik kısıt:** GitHub suggestion bloğu,
  yorumun bağlandığı satır aralığının **tamamını** değiştirir — yani yalnız `outcome`
  `exact`/`repaired` ve alıntı ile satır aralığı birebir örtüşen bulgularda basılmalı.
  `anchor.ts` bu bilgiyi zaten üretiyor (`startLine`..`line` span'i).
- **`category`:** Şiddetten ayrı eksen. Bizde `severities` konfigürasyon anahtarı hem
  "neyi inceleyeceğiz" hem "neyi inline basacağız" olarak kullanılıyor; kategori eklenirse
  bu ikisi netleşir (`categories` = eksen, `severity` = kritiklik). `config.json` şeması
  ve `dedup.selectInline` sıralaması etkilenir.

---

### D8. `--effort` presetleri

**OCR'da:** `--effort low|medium|high` (`internal/config/template/effort.go`), inceleme
tur sayısı ve token limitlerini tek bayrakla ayarlıyor. Ayrıca `llm_reasoning_effort`
GitHub Action girdisi, `reasoning_effort` olarak istek gövdesine karışıyor.

**Bizde:** `maxFileChars`, `maxSkillChars`, `maxFindingsPerFile` gibi ayrı ayrı anahtarlar var;
"hızlı bak" / "derin bak" diye bir üst kavram yok.

**Uyarlama:** Mevcut anahtarların üstünde ince bir preset katmanı: `--effort` → o çalıştırma
için `maxFileChars`, `maxPriorCommentChars`, (varsa) tur sayısı değerlerini toptan set eder,
CLI > env > config sırası korunur. `resolver.ts` içinde tek yerde çözülür.

---

### D9. Gizli dosya kara listesi + uzantı allowlist — ✅ YAPILDI (allowlist hariç)

**OCR'da:** Üç ayrı liste, hepsi gömülü JSON (`internal/config/allowlist/`):

- `default_secret_patterns.json` — `**/.ssh/**`, `**/id_rsa`, `**/id_ed25519`, `**/.netrc`,
  `**/.npmrc`, `**/.pypirc`, `**/.dockercfg` … **kullanıcı ne yaparsa yapsın** LLM'e gitmez.
- `supported_file_types.json` — 111 uzantılık allowlist (tanımadığını incelemez).
- `default_exclude_patterns.json` — test/generated/snapshot/vendor kalıpları
  (`**/*_test.go`, `**/__snapshots__/**`, `**/*.pb.go`, `**/testdata/**`, `**/fixtures/**` …).

Ayrıca binary dosya tespiti diff başlığından yapılıyor (`whyExcluded`).

**Bizde:** Yalnız kullanıcı tanımlı `exclude` globları var (`REVIEW_EXCLUDE_PATHS`,
`--exclude`, `config.json`). **Varsayılan olarak hiçbir şey korunmuyor:** bir PR `.npmrc`
veya bir `.env.example` içeriği taşıyorsa doğrudan modele gider. Bu, README'deki "security
boundary" notumuzla çelişen bir açık.

**Uyarlama:** `src/core/review/` altına küçük bir `guards.ts`: gömülü secret kalıp listesi
(kullanıcı **genişletebilir, daraltamaz**), binary tespiti, opsiyonel uzantı allowlist'i.
`ChangedFile.fromEntry` veya `reviewFiles` filtresine takılır; elenen her dosya gerekçesiyle
loglanır (D10 ile birlikte). Test kolay, risk yok.

**Not:** Varsayılan test/generated exclude listesini biz **açmayabiliriz** — bizde bu zaten
proje kararı olarak `config.yaml`'da yaşıyor ve `docs/config.example.yaml` bunu öneriyor.
Ama secret + binary koruması varsayılan olmalı.

**Ne yapıldı:**

| Parça                                     | Yer                                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Gizli dosya glob listesi + binary tespiti | `src/core/review/guards.ts` (`SECRET_PATHS`, `isSecretPath`, `isBinaryPatch`)                                          |
| Her iki akışa da bağlanması               | `src/core/review/changed-file.ts` — **ilk** kontrol, konfigürasyona bakılmadan önce                                    |
| Görünürlük                                | Gizli dosya atlaması INFO (`-v` gerekmez), binary atlaması DEBUG                                                       |
| Testler                                   | `tests/contracts/guards.contract.test.ts` + `tests/fixtures/guards.json` (28 vaka) ve `changed-file` bağlantı testleri |
| Belge                                     | README "What is never sent to the model", `docs/post-parity-notes.md`                                                  |

Kapsanan yollar: `**/.env`, `**/.env.*`, `**/*.env`, `**/*.{pem,key,p12,pfx,jks,keystore}`,
`**/id_{rsa,dsa,ecdsa,ed25519}`, `**/.ssh/**`, `**/.aws/**`, `**/.gnupg/**`, `**/.netrc`,
`**/_netrc`, `**/.npmrc`, `**/.pypirc`, `**/.dockercfg`, `**/.docker/config.json`,
`**/.git-credentials`, `**/.htpasswd` — küçük/büyük harf duyarsız.

Rapordan **sapan üç karar**:

1. **Uzantı allowlist'i alınmadı.** OCR'ın 111 uzantılık listesi, tanımadığı her dosyayı
   sessizce incelemeden bırakıyor — "Dockerfile'ını atladım" operatörün göremeyeceği bir
   hata. Değer için atlanacak şeyler (lockfile, generated, snapshot) projenin kararı ve
   `exclude`'da yazılı duruyor. Gerekçe `guards.ts` modül başlığında kayıtlı.
2. **Yeni konfigürasyon anahtarı yok.** Liste _genişletilebilir_ (`exclude` globu ekleyerek)
   ama _daraltılamaz_. Kapatılabilir bir güvenlik korumasının değeri, kapatılabildiği anda
   biter; ayrıca yeni bir anahtar, yanlış ayarlanabilecek bir yüzey demek.
3. **`.env.example` de kapsam içinde.** Gerçekten incelenebilir bir dosya ve atlamak bir şey
   kaybettiriyor; ama içine yapıştırılmış canlı bir değer rotasyonla geri alınamaz. İlkinin
   bedeli bir log satırı.

---

### D10. Deterministik dosya seçimi + dışlama gerekçesi — ✅ yapıldı

**OCR'da:** `internal/agent/selection.go` — `selectFiles` **saf** bir fonksiyon: çıktısı
her dosya için bir `fileDecision{Diff, Reason, DiffTokens}`. `Reason` sayılı bir taksonomi
(`ExcludeNone`, `ExcludeDeleted`, `ExcludeTooLarge`, binary/secret/ext/user-exclude).
Kod yorumunda asıl gerekçe yazılı: `--preview` ile gerçek çalışma **aynı** fonksiyonu
tüketiyor, çünkü ayrı hesaplarken ikisi birbirinden kaymıştı (issue #782). Dispatch öncesi
bilinemeyecek her şey (bütçe tükenmesi, resume, sağlayıcı hatası) bilinçli olarak dışarıda.

**Bizde:** Eleme dağınık: `exclude` globları `changed-file.ts` içinde, patch'siz dosya
elemesi `orchestrator.reviewFiles` içinde, `maxFileChars` kesmesi başka yerde ve hiçbiri
"neden elendi" bilgisini yapısal olarak taşımıyor — sadece debug log'u var.

**Uyarlama:** Tek saf fonksiyon: `selectFiles(files, settings): FileDecision[]`,
`reason: "none" | "no-patch" | "deleted" | "excluded" | "binary" | "secret" | "too-large"`.
Orkestratör bunu tüketir, `--preview` (D11) de aynı çıktıyı basar, `counterLine` gerekçe
dağılımını raporlar. Bizim "derin modül" disiplinimize de birebir uyan bir düzeltme.

**Yapıldı (`src/core/review/selection.ts`):** `selectFiles(entries, settings)` saf;
taksonomi `none | no_patch | secret | binary | status | excluded | no_added_lines`.
İki sapma bilinçli:

1. **`too_large` yok.** Bizde `max-file-chars` diff'i **kesiyor**, atmıyor — model
   gördüğü kadarını inceliyor. Karar bunu `truncated` olarak taşıyor; atlanmış gibi
   raporlamak yanlış olurdu.
2. **`ext` (uzantı allowlist'i) yok** — D9'daki gerekçe (`guards.ts` modül başlığı).

Gerekçe dağılımı `counterLine`'da (`skipped_excluded=19`, `truncated=2`) ve branch
`summary` kaydında (`skipped`) raporlanıyor. Yan kazanç: modele giden `changeSet`
artık **seçilmiş** dosyalardan kuruluyor — D4'ün ön-bağlamı başka dosyaların diff'ini
alıntıladığı için, `exclude`'lu ya da gizli bir dosya "related change" olarak prompta
girebiliyordu.

---

### D11. `--preview` — ✅ yapıldı

**OCR'da:** `--preview` / `-p`: model çağrısı yapmadan hangi dosyaların inceleneceğini,
hangilerinin neden elendiğini basıyor (`scan` tarafında da var).

**Bizde:** `--dry-run` var ama bu **modeli çalıştırıp** sonucu basmıyor demek değil —
tam tersi, modeli çalıştırır, sadece göndermez. Yani "bedava ön kontrol" yok.

**Uyarlama:** D10 tamamlandığında `--preview` neredeyse bedava: seçim çıktısını tabloya
basmak. `RUNBOOK.md`'deki "Sanity check (no model call)" bölümünün gerçek karşılığı olur.
Adlandırmaya dikkat: `--dry-run` (modeli çalıştır, gönderme) ile `--preview` (modeli
çalıştırma) ayrımı belgelenmeli.

**Yapıldı:** `--preview` her iki akışta çalışıyor (`previewRepo`, `previewBranch`);
çıktı metin tablo. Model **hiç** kurulmuyor (`cradle.fileReviewer`/`verifier`'a
dokunulmuyor), dolayısıyla LLM anahtarı olmayan bir makinede de çalışıyor; `--branch`
modunda hiçbir kimlik bilgisi gerekmiyor. PR modunda cevabı değiştirebilecek iki soruyu
soruyor: bu head zaten incelendi mi (`--force` ile yine önizlenir) ve sağlayıcı neyi
değişmiş bildiriyor. `--dry-run` / `--preview` ayrımı README ve RUNBOOK'ta yazılı;
RUNBOOK'un "Sanity check (no model call)" bölümü artık gerçekten model çağırmıyor.

---

### D12. Token bütçesi + ön maliyet tahmini

**OCR'da:** Üç ayrı mekanizma:

1. **Ön tahmin** (`internal/agent/estimate.go`): dosya sayısı, girdi/çıktı token'ı,
   tahmini maliyet. Sabitler açıkça "kaba" ilan edilmiş: prompt overhead ~2000 token,
   dosya başına ~7 tur, tur başına ~700 çıktı token'ı. Amaç fatura doğruluğu değil,
   **büyük inceleme öncesi büyüklük mertebesi uyarısı**.
2. **Toplam bütçe** (`MaxTokensBudget`): grup dispatch edilmeden **önce** look-ahead —
   "harcanan + bu grubun tahmini > bütçe" ise o grup ve sonrası atlanır, uçuştaki gruplar
   bitirilir. Aşım, uçuştaki grup sayısıyla sınırlı.
3. **Bütçe tükenmesi hata değil**: `SetRunFailure` **kasten** çağrılmıyor; bu "kontrollü
   kapsam kesintisi" olarak manifest'e yazılıyor (`FailureBudget`).

Ayrıca prompt limiti tek yerden: `PromptTokenLimit = MaxTokens * 0.80`.

**Bizde:** Yalnız karakter bazlı sınırlar (`maxFileChars`, `maxSkillChars`,
`maxSkillsTotalChars`). Token sayacı yok, toplam bütçe yok, maliyet tahmini yok. Büyük bir
PR'da ne kadar harcayacağımız çalıştırmadan bilinmiyor.

**Uyarlama:**

- Token sayımı: `ai` SDK yanıtındaki `usage` zaten geliyor → çalışma sonunda toplam
  raporlanır (ucuz ilk adım, `counterLine`'a `tokens_in/out`).
- `--max-tokens-budget`: dosya (ileride grup) dispatch'inden önce look-ahead; aşılırsa
  kalan dosyalar `skipped(budget)` olarak raporlanır, **hata değil**.
- Ön tahmin: diff karakter sayısı / 4 kaba yaklaşımıyla bile faydalı; `--preview` çıktısına
  eklenir.

---

### D13. Kapsam manifestosu

**OCR'da:** `ocr.run-manifest/v1` (`internal/session/manifest.go`) — sürümlü, makine okunur
kapsam sözleşmesi. Dikkat çeken tasarım kararları: kapsam **paydası** dispatch'ten önce
donduruluyor (`registerCoverage` + seal), her öğe kararlı bir `item_id` alıyor (resume
zincirinde aynı kalıyor), girdi modu (`range`/`commit`/`workspace`) zorunlu alan, kural
konfigürasyonu ve runtime konfigürasyonu SHA256'lanıp manifest'e yazılıyor
(`ruleConfigSHA256`, `runtimeConfigSHA256`) — yani "bu sonuç hangi kurallarla üretildi"
kanıtlanabiliyor. Terminal durum kapsamdan türetiliyor.

**Bizde:** Karşılığı `counterLine` — tek satır, insan okuması için, sürümsüz.

**Uyarlama:** `--format ndjson` zaten var (branch modunda). Aynı yapıyı PR modunda da
üretip bir `summary` kaydına dönüştürmek küçük bir iş. Konfigürasyon hash'i fikri özellikle
değerli: prompt dosyaları + skill'ler + severity politikası hash'lenip rapora yazılırsa,
"geçen hafta niye başka sonuç çıktı" sorusu cevaplanabilir hale gelir.

---

### D14. Workspace + `--commit` modu

**OCR'da:** Dört giriş modu: `ocr review` (staged + unstaged + untracked),
`--from/--to` (merge-base), `--commit <sha>` (parent'ına karşı), `ocr scan` (diff'siz).

**Bizde:** İki mod: PR (`--pr`) ve branch (`--branch` + `--base`, merge-base değil doğrudan
karşılaştırma). Commit öncesi "şu an elimdeki değişikliği incele" yok — ki bu, bir
geliştiricinin aracı **en sık** kullanacağı moddur.

**Uyarlama:** `LocalGitReader` (`src/infra/git/local-git.ts`) zaten yerel git okuyor.
Eklenecek: `--staged` / `--worktree` (veya argümansız varsayılan) ve `--commit <sha>`.
`branch-review.ts` akışı olduğu gibi kullanılabilir; değişen tek şey diff'in nereden
geldiği. Kimlik bilgisi gerektirmediği için en düşük riskli yeni moddur ve `--branch`
modunun merge-base seçeneği (`--from/--to` semantiği) de bu sırada eklenmeli.

---

### D15. Oturum + resume

**OCR'da:** Her çalışma JSONL bir oturum dosyasına yazılıyor (`internal/session/`);
`ocr session list`, `--resume <id>`. Replay semantiği net: aynı fingerprint için sonraki
checkpoint öncekini geçersiz kılar, `review_item_failed` onu düşürür. Resume kimliği
doğrulanıyor (`resume_identity.go`) — başka bir girdi üzerinde resume yapılamıyor.

**Bizde:** Yok. Yarıda kesilen bir çalışma tamamen tekrar ücretlendirilir. Kısmi telafi:
PR modunda "bu head zaten incelendi" kontrolü ve comment dedup var.

**Uyarlama:** Değeri esas olarak **büyük** değişim setlerinde ortaya çıkıyor. Bizim
ölçeğimizde önce D12 (bütçe) ve D14 (workspace) daha yüksek getirili. Yapılacaksa:
dosya başına `{path, headSha, findings}` JSONL checkpoint + `--resume` ile aynı head'de
tamamlanmış dosyaları atlama. Fingerprint = `mode + path + blobSha`.

---

### D16. `scan` modu

**OCR'da:** `ocr scan [--path ...]` — diff olmadan tüm dosyaları inceler; kendi batch
stratejisi var (`--batch none | by-language | by-directory`), kendi prompt şablonu
(`scan_template.json`), kendi dedup turu (`DEDUP_TASK`) ve çalışma sonu proje özeti
(`PROJECT_SUMMARY_TASK`). Kullanım amacı: yabancı bir kod tabanını/dizini denetlemek.

**Bizde:** Yok; her şey bir değişim setine bağlı ("Finding = changed code'daki savunulabilir
problem" — `CONTEXT.md`).

**Uyarlama:** Bu bizim domain modelimizi genişletir (Finding tanımı "changed code" diyor).
Almadan önce `CONTEXT.md` güncellenmeli ve muhtemelen bir ADR yazılmalı. Getirisi gerçek
ama bizim PR-merkezli konumlandırmamızın dışında; Dalga 3'ten sonra.

---

### D17. Delegate modu

**OCR'da:** `ocr delegate preview` / `ocr delegate rule <dosyalar>` — OCR **dosya seçimi
ve kural eşleşmesini** yapıyor, çıktıyı markdown kural grupları olarak veriyor
(`internal/delegate/format.go`: "Rule Group N: source / pattern", uygulanan dosyalar,
kural metni), incelemeyi kullanıcının kendi coding agent'ı (Claude Code, Codex, Cursor,
OpenCode) kendi LLM'iyle yapıyor. Yani OCR'ın API anahtarına hiç gerek kalmıyor. Bunun için
`skills/`, `plugins/` altında hazır slash komutları ve SKILL.md'ler dağıtıyorlar.

**Bizde:** Yok — ama bizim skill sistemimiz (`SkillRegistry` + `mappings` + glob eşleşme)
bu çıktının **zaten** motoru. `reviewer delegate --branch x` gibi bir komut, değişen
dosyaları + her dosyaya uyan skill metinlerini + lens'leri tek bir markdown'a basabilir.

**Uyarlama:** Düşük efor, ilginç konumlandırma: aracı bir agent skill'i olarak dağıtmak
(`SKILL.md` + slash komut) bizim için de mümkün. Getirisi: LLM konfigürasyonu olmayan
kullanıcı da faydalanır; ayrıca kendi geliştirme akışımızda (pi/Claude Code) doğrudan
kullanılabilir.

---

### D18. SARIF çıktısı

**OCR'da:** `--format sarif` (`cmd/opencodereview/sarif.go`), SARIF v2.1.0'ın gerekli
alt kümesi: `result.locations` dizi, `replacement.deletedRegion` zorunlu,
`run.invocations` yürütme durumu + bildirimler, ve `ocrFinding/v1` **partialFingerprints**
— aynı bulgunun çalıştırmalar arası eşleşmesi için.

**Bizde:** `--format text|ndjson` (yalnız branch modu).

**Uyarlama:** `render.ts`'e üçüncü bir reporter. Kazanç: GitHub Code Scanning'e yükleme
(`github/codeql-action/upload-sarif`), IDE entegrasyonları, diğer araçlarla ortak dil.
Fingerprint tasarımını da almak lazım — bizde dedup şu an yorum metni üzerinden
çalışıyor (`dedup.dropAlreadyPosted`); kararlı bir fingerprint (path + normalize edilmiş
kod alıntısı + kategori hash'i) hem SARIF'i hem dedup'ı iyileştirir.

---

### D19. Sticky özet + artımlı gönderim

**OCR'da:** `scripts/github-actions/post-review-comments.js` (~2600 satır, kendi testleriyle).
Bizim `orchestrator` + `dedup` + `render` üçlümüzün doğrudan muadili ve birkaç noktada
bizden ileride:

- **Sticky özet:** `<!-- ocr-summary -->` marker'lı tek yorum güncelleniyor, her koşuda
  yeni yorum açılmıyor.
- **Checkpoint + config fingerprint:** marker içine konfigürasyon fingerprint'i yazılıyor;
  konfigürasyon değişmişse (`config_changed`) artımlı geçmiş geçersiz sayılıp tam gönderim
  yapılıyor.
- **Artımlı örtüşme testi:** çok satırlı iki yorum, satır aralıklarının IoU'su (kesişim/birleşim)
  0.6'yı geçiyorsa aynı kabul edilip atlanıyor. Bizim dedup'ımız metin eşitliğine bakıyor —
  yeniden ifade edilmiş aynı bulgu bizde tekrar basılır.
- **Batch'leme:** tek `createReview` çağrısında en fazla 50 inline yorum. Gerekçe kod
  yorumunda yazılı: üretimde 71 yorumla kısmi başarı sonrası sunucu hatası alınmış.
- **Inline başarısızsa özete düşürme:** GitHub yorumu satıra basamazsa kaybolmuyor,
  `⚠️ GitHub could not post this as an inline comment: <sebep>` satırıyla özete giriyor.
  Bizim `unanchored` davranışımızın **posting hatası** hali (bizde bu hal yok — hata alırsak
  bulgu kaybolur).
- **Yönlendirme politikası:** severity eşiği / kategori ile "hangisi inline, hangisi özet".

**Bizde:** `dropAlreadyPosted` (metin bazlı), `selectInline` (severity + dosya başı sınır),
`reviewBody` (özet gövdesi, her koşuda yeni review). Batch yok, sticky yok, gönderim hatası
telafisi yok.

**Uyarlama (öncelik sırası):**

1. **Inline gönderim hatası telafisi** — `publish` şu an tek `postReview`; hata halinde
   tüm review kayboluyor (`log.warn` ile yutuluyor). En azından: başarısız inline yorumları
   gövdeye düşürüp tekrar dene.
2. **Batch'leme** — 50'lik parçalar; büyük PR'da tek çağrının patlamasını önler.
3. **IoU tabanlı dedup** — `dedup.ts` içine çok satırlı örtüşme testi.
4. **Sticky özet** — marker'lı tek yorumu güncelleme (`reviewBody` zaten tek gövde üretiyor).

---

### D20. GitHub Action / CI paketi

**OCR'da:** 48 KB'lık bir `action.yml` (composite action) — LLM endpoint, protokol seçimi,
`extra_headers`, `extra_body`, `reasoning_effort`, dil, artımlı gönderim eşiği, batch
boyutu… hepsi girdi. Ayrıca GitLab CI, GitFlic CI ve Gerrit entegrasyon dokümanları,
`action-contract.yml` ile action girdilerinin sözleşme testi, npm üzerinden platform-özel
binary dağıtımı (`optionalDependencies` + `postinstall` + SHA256 checksum).

**Bizde:** `private: true`, `npm run build` → `dist/`. CI entegrasyonu yok.

**Uyarlama:** Önce dağıtım kararı gerekiyor (npm public mi, GitHub Package mı, yoksa
`npx github:...` mı). Action'ı yazmak, dağıtım çözüldükten sonra küçük bir iş; sözleşme
testi fikri (action girdileri ile CLI bayrakları arasında drift kontrolü) bizim
`config-example.test.ts` alışkanlığımızla aynı ruhta.

---

### D21. Oturum görüntüleyici

**OCR'da:** `ocr viewer` — yerel HTTP sunucu, oturumları tarayıcıda gezme, yorumları
"düzeltildi / yok say" işaretleyip gizleme, iki oturumu karşılaştırma (`handleCompare`).
Güvenlik tarafı ciddiye alınmış: host allowlist (DNS rebinding koruması,
`hostguard.go`), güvenlik başlıkları (`securityheaders.go`).

**Bizde:** Yok, stdout reporter var.

**Değerlendirme:** Efor/getiri oranı bizim için kötü — bir web UI, sunucu, statik varlıklar
ve güvenlik yüzeyi demek; üstelik bizim ana çıktımız zaten GitHub PR arayüzünde yaşıyor.
**Almamayı öneriyorum.** İstenirse ucuz muadili: NDJSON çıktısını okuyan küçük bir
`reviewer report <dosya>` terminal görüntüleyicisi.

---

### D22. Telemetri ve retry raporu

**OCR'da:** İki ayrı şey:

- **OpenTelemetry** (`internal/telemetry/`): span'ler (`diff.parse`), metrikler
  (review süresi), olaylar (`review.skipped` + `reason` attribute'u, `no.files.changed`).
  Olay isimlendirmesinde ince bir karar var: tek bir olay adı doğru olmadığı için sebep
  attribute'a konmuş ve sebepler "en aksiyon alınabilir" sırasına dizilmiş.
- **Retry raporu** (`internal/llm/retry_report.go`): sürümlü şema
  (`ocr.llm-retry-report/v1`) ve hata sınıflandırması — `rate_limited`, `overloaded`,
  `authentication`, `timeout`, `network`, `provider`, `cancelled`, `unknown`. Sınıflandırma
  **yalnız** HTTP durum kodu ve Go hata tipinden türetiliyor, **asla hata mesajı metninden
  değil**.

**Bizde:** `pino` ile yapılandırılmış log var (`src/infra/logging/pino-logger.ts`),
`counterLine` sayaçları var. LLM hatalarında sınıflandırma yok — `errorMessage(error)` ile
metin loglanıyor.

**Uyarlama:** OTel'i almaya gerek yok (bizim dağıtım modelimiz tek kullanıcı / tek repo).
**Alınacak olan hata sınıflandırması:** `src/core/util/errors.ts` içine `classifyLlmError`
— durum kodu tabanlı, metin tabanlı değil. Kazanç: rate limit'te geri çekilme,
authentication hatasında **hemen** durma (şu an her dosya için aynı 401'i tekrar alıyoruz),
sağlayıcı hatasında tekrar deneme.

---

### D23. Bağlam sıkıştırma

**OCR'da:** `internal/llmloop/compression.go` — iki eşik: `%60`'ta **arka planda asenkron**
sıkıştırma, `%80`'de **senkron** sıkıştırma. Sıkıştırma birimi "round" (bir assistant mesajı
ve onu izleyen tool sonuçları). Ayrı bir prompt şablonu var
(`memory_compression_task_*.md`). `PromptTokenLimit` (= `%80`) tek tanım olarak
agent, scan, büyük girdi filtreleri ve aktif bölge hesabı tarafından paylaşılıyor.

**Bizde:** Gerek yok — tek geçişli çağrı yapıyoruz, konuşma birikmiyor.

**Uyarlama:** Yalnız D4 (tool-use) alınırsa gerekli hale gelir. Alınırsa `%80` eşiğinin
tek bir yerde tanımlanması pratiği de alınmalı.

---

### D24. Tool hata serisi kesici + argüman JSON onarımı

**OCR'da:** İki dayanıklılık mekanizması, ikisi de üretimden çıkmış:

- `tool_failure_streak.go`: kod yorumunda gerekçe yazılı — "bir inceleme koşusunda tek bir
  bulgu 6 kez yeniden denendi". `(taskKey, toolName)` başına ardışık hata sayılıyor ve
  belli sayıdan sonra yanıt yükseltiliyor; yoksa model aynı hatayı sonsuza kadar tekrarlıyor.
- `comment_args_repair.go` + `tool_args_json.go`: modelin ürettiği bozuk/fazladan içerikli
  JSON argümanları onarılıyor.

**Bizde:** Kısmi karşılık var: `RETRY_PROMPT` — JSON parse edilemezse tek bir yeniden
deneme (`prompts.ts`). Onarım (repair) denemesi yok, sonsuz döngü riski de yok (tek geçiş).

**Uyarlama:** **JSON onarımı** ucuz ve doğrudan faydalı: yeniden istek atmadan önce yerel
onarım dene (kod bloğu çitlerini soy, sondaki fazlalığı kes, ilk `{`…son `}` aralığını al).
`src/core/util/json.ts` zaten var; onarım oraya girer, ancak o zaman model çağrısı yapılır.
Her onarım türü sayaca yazılmalı ki gerçekten çalışıp çalışmadığı ölçülebilsin.

---

### D25. Prompt cache affinity anahtarı

**OCR'da:** `llm.ContextWithSessionKey(ctx, SessionID)` ile çalışma başına temel anahtar,
her görev konuşması (`plan`, grup main loop, compression) bunu `llm.SessionTaskKey` ile
daraltıyor. Kod yorumundaki gerekçe: sağlayıcı prompt cache'leri **konuşma** granülaritesinde
prefix yeniden kullanıyor, bu yüzden affinity anahtarı da o granülaritede olmalı.

**Bizde:** Yok. Her dosya için sistem promptu (policy + contract + severity sözlüğü)
baştan gönderiliyor — ki bu bizim **en büyük tekrar eden prefix'imiz** ve tam olarak
cache'lenmesi gereken şey.

**Uyarlama:** Anthropic tarafında `cache_control` (ai SDK: provider options ile
`anthropic.cacheControl`), OpenAI-uyumlu tarafta otomatik prefix cache için sistem promptunu
**birebir sabit** tutmak ve değişken kısımları (dosya, diff, skill) user mesajına almak.
Bizde sistem promptu zaten sabit — asıl yapılacak iş, Claude sağlayıcısında sistem bloğuna
cache işareti koymak ve `usage`'daki cache read/write token'larını raporlamak
(OCR bunu ayrı sayıyor: `TotalCacheReadTokens` / `TotalCacheWriteTokens`).

---

### D26. Dile göre yerleşik kural kütüphanesi + sniffer

**OCR'da:** `internal/config/rules/system_rules.json` — 50+ glob → markdown kural dosyası
eşleşmesi (`**/*.go` → `go.md`, `**/pom.xml` → `pom_xml.md`, `.github/workflows/**` →
`github_workflows.md`, `**/*.{ts,js,tsx,jsx}` → `ts_js_tsx_jsx.md` …) ve bir `default.md`.
Kurallar binary'e gömülü, yani `ocr` kurulur kurulmaz anlamlı inceleme yapıyor.
`sniffer.go` repo teknolojisini algılayıp uygun kuralları seçiyor.

**Bizde:** **ADR 0003 ile bilinçli olarak reddedilmiş**: "The reviewer ships none of its own
[skills]". Gerekçe sağlam — skill'ler kodu yöneten repoya aittir, kodla birlikte versiyonlanır.
Karşılığında `docs/example-skills/` altında kopyalanabilir bir MedusaJS kütüphanesi tutuyoruz.

**Değerlendirme:** Bu bir **değiş-tokuş**, hata değil. OCR'ın modeli "kurulumsuz değer",
bizimki "projenin kendi kuralları". Yine de iki fikir ADR'yi bozmadan alınabilir:

1. **Dile göre lens genişletmesi:** Lens'lerimiz (correctness/security/performance/
   readability) dilden bağımsız. Dosya uzantısına göre promptun yalnız **lens** kısmına
   kısa bir dil notu eklemek ("TypeScript: `any` kaçışları, `Promise` sızıntıları,
   `strict` ihlalleri"), skill kütüphanesi kurmak değildir — ve ADR 0003'ün yasakladığı
   şey de değildir.
2. **Kütüphane keşfi:** `docs/example-skills/` içeriğini `reviewer skills list --library`
   gibi bir komutla görünür kılmak, kopyalamayı kolaylaştırır.

Eğer ileride "shipped skills" kararı yeniden açılırsa, bu bir ADR **amendment**'i olmalı
(ADR 0005'in 0003'ü değiştirdiği gibi), sessiz bir ekleme değil.

---

### D27. Repo içi kural dosyası + `merge_system_rule`

**OCR'da:** `.opencodereview/rule.json` — repo kendi kurallarını taşıyor:
`{path, rule, merge_system_rule}`. Üçüncü alan kritik: `true` ise repo kuralı **sistem
kuralına eklenir**, `false` ise onu **değiştirir**. Kendi repolarındaki örnek son derece
somut: `internal/llm/providers.go` için stil tutarlılığı + dokümantasyon senkronu + test
kapsamı şartları tek bir kural metninde.

**Bizde:** Daha zengin bir karşılığı var — skill dosyaları (frontmatter + markdown) +
`config.json`'daki `skills.mappings` (ADR 0005: hangi dosyaya hangi skill, **projenin**
kararı). Eksik olan: bir skill'in lens'lerin **yerine mi** yoksa **yanına mı** geçtiği
söylenemiyor; hep "ek olarak" uygulanıyor.

**Uyarlama:** Skill frontmatter'ına `replaces_lenses: true|false` (veya
`mode: append|replace`) alanı. Örneğin bir `generated-code` skill'i, lens'leri tamamen
devre dışı bırakıp yalnız kendi kuralını uygulamak isteyebilir. Küçük bir şema eklemesi
(`src/core/skills/parser.ts` + `prompts.buildUserPrompt`).

---

### D28. Kalite ölçümü / benchmark

**OCR'da:** AACR-Bench — 50 popüler açık kaynak repo, 200 gerçek PR, 10 dil,
80+ kıdemli mühendis tarafından çapraz doğrulanmış **1505 etiketli bulgu**;
Hugging Face'te yayında. Ölçtükleri: F1, Precision, Recall, ortalama süre, ortalama token.
README'de recall'ün kasten düşük tutulduğu ("precision lehine bilinçli takas") açıkça yazılı.

**Bizde:** Hiç yok. Anchor sayaçlarımız **mekanizmayı** ölçüyor (kaç bulgu kurtarıldı),
**kaliteyi** ölçmüyor (kaç bulgu doğruydu). Bu, prompt değişikliklerimizin körlemesine
yapıldığı anlamına geliyor — `prompts.ts`'de "wording change alters what the model returns"
diye yazmışız ama bunun etkisini ölçecek aracımız yok.

**Uyarlama (ölçekli başlangıç):** 10-20 gerçek PR'lık küçük bir altın küme
(`tests/eval/cases/*.json`: diff + beklenen bulgular + kabul edilebilir yanlış pozitifler).
`npm run eval` bunları çalıştırıp precision/recall basar. **CI'da zorunlu olmamalı**
(model deterministik değil, maliyetli); prompt/policy değiştiğinde elle çalıştırılan bir
araç olmalı. Bu, D1 (doğrulama turu) gibi maddelerin gerçekten işe yarayıp yaramadığını
kanıtlamanın **tek** yolu — o yüzden D1'den önce veya onunla birlikte gelmeli.

---

### D29. Proje disiplini: teminat dosyası ve agent kuralları

**OCR'da:**

- `ASSURANCE_CASE.md`: aktörler ve güven seviyeleri tablosu (yerel kullanıcı: güvenilir,
  LLM sağlayıcı: yarı güvenilir, git repo: yarı güvenilir — "diff'ler düşmanca içerik
  taşıyabilir", tarayıcı: güvenilmez), 4 güven sınırı, ASCII diyagram, tehdit → azaltma tablosu.
- `AGENTS.md`: AI katkı kuralları (PR'da AI kullanımını beyan etme, "AI üretti → düzeltti →
  düzeltti" döngüsü içeren PR'ları reddetme, commit'i AI'ya atfetmeme), %90 kapsam eşiği,
  SPDX lisans başlığı zorunluluğu, kaynak dosyalarda **yalnız İngilizce** kuralı ve bunun
  CI kontrolü (`make english-check`, ASCII dışı harf tespiti + `allow-non-english:` kaçış
  yorumu), README değişikliklerinin 4 dile senkronu.

**Bizde:** `CONTEXT.md` (domain sözlüğü), ADR'ler, README'de "security boundary" notu,
`npm run check` (typecheck + lint + format + test). Tehdit modeli tek paragraf; katkı
disiplini dokümante değil.

**Uyarlama (ucuz olanlar):**

- README'deki güvenlik notunu küçük bir `docs/threat-model.md`'ye çıkar: aktörler, güven
  sınırları (git diff → prompt, prompt → LLM, token kapsamı, `.env` okuma), her sınırda ne
  yapıyoruz. D9 (secret guard) bu belgede doğal yerini bulur.
- `docs/parity/` fixture disiplinimiz zaten güçlü; eksik olan **kapsam eşiği**. `vitest`
  coverage eşiği (%90 gibi) `npm run check`'e eklenebilir.

---

## Sonuç

En yüksek getirili dört şey, mimariye dokunmadan alınabilir:

1. **D9 — gizli dosya koruması.** Bugün açık bir güvenlik boşluğu; bir öğlen sonu işi.
2. **D7 — `suggestion_code`.** Bulguyu "okunacak yorum"dan "tek tıkla uygulanacak
   düzeltme"ye çevirir; anchor altyapımız bunu zaten destekliyor.
3. **D2 + D19 — kurtarma turu ve gönderim dayanıklılığı.** Ürettiğimiz bulguların
   kaybolmasını engeller (anchor `failed`, gönderim hatası, tek çağrıda 50+ yorum).
4. **D28 — küçük eval kümesi.** Diğer her maddenin işe yarayıp yaramadığını ölçmenin tek yolu.

Mimari kararı gerektiren tek büyük çatal **D4 (tool-use)** ve onunla gelen **D3 (gruplama)**:
OCR'ın precision iddiası büyük ölçüde buraya dayanıyor, ama bizim tek geçişli, deterministik
posting modelimizin sadeliği de buradan geliyor. Bu ikisi alınacaksa bir ADR ile,
ölçümü (D28) hazır olduktan **sonra** alınmalı.
