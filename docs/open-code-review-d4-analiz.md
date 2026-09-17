# D4 Analizi — Bağlam araçları (tool-use)

> **Durum:** S1 uygulandı ([ADR 0008](adr/0008-deterministic-pre-context.md)):
> `CodeContext` portu, `context.ts` (tanımlar / kullanıcılar / ilişkili diff'ler),
> git ve repo-provider adaptörleri, `max-context-chars` ayarı. S4 için karar
> noktaları (K1–K8) açık.

Üst belge: [open-code-review-inceleme.md](open-code-review-inceleme.md) → D4.
Amaç: "modele repo'yu okuma imkânı verelim mi, verirsek nasıl" sorusuna, bugünkü
kodun gerçek sınırlarından yola çıkarak karar verilebilir bir cevap hazırlamak.

---

## 1. Bugün ne var (kod referanslarıyla)

| Katman                  | Durum                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model portu             | `ChatModel.generate(messages) → { text }` — **tek tur**, araç kavramı yok (`src/core/ports/chat-model.ts`)                                                                                                               |
| Adaptör                 | `ai@7` `generateText` (`src/infra/llm/ai-sdk-chat-model.ts`); SDK çok-adımlı tool döngüsünü (`tools` + `stopWhen`) hazır veriyor ama biz kullanmıyoruz                                                                   |
| Dosya incelemesi        | `FileReviewer.askForFindings`: system + user → JSON; bozuksa **1** tekrar (`RETRY_PROMPT`). Toplam çağrı: dosya başına 1–2                                                                                               |
| Modelin gördüğü bağlam  | annotated diff (`maxFileChars` ile kesilmiş) + **yalnız** patch `< maxFileChars` ve dosya `added` değilse tam dosya içeriği (`changed-file.ts:147-150`, `orchestrator.ts:264`). Diff dışı hiçbir dosya, hiçbir arama yok |
| Repo okuma yüzeyi (PR)  | `RepoContents.fileContents(path, ref)`, `listDirectory(path, ref)` — ref'e sabit; **arama yok**                                                                                                                          |
| Repo okuma yüzeyi (dal) | `GitReader.readFile(path, limit)`, `changedFiles`, `mergeBase` — yerel git; **arama yok**, ama `git grep <sha>` eklemek trivial                                                                                          |
| Sözleşme                | `prompts/output-contract.md`: tek JSON cevap; `anchor.ts` bu cevabı satıra bağlar. Determinizmimiz (parite fixture'ları, sayaçlar) buna dayanıyor                                                                        |

Çıkarım: OCR'ın precision iddiasının dayandığı şey — modelin "bu fonksiyon başka
nerede kullanılıyor / imzası ne / bu import var mı" diye **sorabilmesi** — bizde
yapısal olarak yok. Model bilmediği yerde varsayıyor.

## 2. Hangi bulgu sınıfları için gerçekten gerekli

Diff'in kendisiyle **kanıtlanamayan**, dolayısıyla bugün varsayıma dayanan sınıflar:

| Sınıf                                 | Örnek                                                                | Gereken bağlam                            |
| ------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| A. Çağrılan şeyin tanımı diff dışında | "`service.update(id, dto)` — `update` transaction açıyor mu?"        | çağrılanın **tanımı** (read_file)         |
| B. Değişen şeyin diğer kullanıcıları  | Bir imza/enum/dönüş tipi değişti; başka çağıranlar kırıldı mı?       | **arama** (search) + okuma                |
| C. Aynı PR'daki ilişkili dosya        | `validation-schemas.ts` değişti, `route.ts` güncellenmedi            | diğer değişen dosyanın diff'i (read_diff) |
| D. Import'un varlığı / yolu           | "`../utils/x` yok" tarzı yanlış pozitif                              | dosya var mı (file_find / tree)           |
| E. Skill kuralının bağlamsal koşulu   | "`createRemoteLinkStep` FK-kontrol etmez, `validate-*` step var mı?" | arama (aynı workflow klasöründe)          |

**A ve C** en ucuz ve en sık; **B** en değerli ("breaking change") ama arama ister.
Elimizde bu sınıfların bizdeki payını gösteren ölçüm yok — bu, D28'in D4'ten önce
gelmesinin somut sebebi.

## 3. Seçenekler

### S0 — Hiçbir şey yapma

Tek geçiş, deterministik, ucuz. Zayıflık bölüm 2'deki gibi kalır. Referans noktası.

### S1 — Deterministik ön-bağlam (araçsız, tek geçiş korunur)

Modele araç vermek yerine, **biz** seçip prompta ekleriz:

- **C sınıfı:** aynı PR'da, aynı klasördeki (veya `foo.ts` ↔ `foo.*.ts` kökündeki)
  diğer değişen dosyaların diff'i, kısa bir "İlişkili değişiklikler" bloğu olarak.
  D3'ün "ucuz sürüm"ü ile aynı gruplama fonksiyonu.
- **A/D sınıfı:** diff'in eklenen satırlarındaki **yerel** import'ları (`./`, `../`,
  `src/…`) çöz; hedef dosyanın yalnız **dışa aktarılan imzalarını** (export satırları
  ve JSDoc başlıkları, `maxContextChars` ile sınırlı) ekle. Regex tabanlı, dil-bilgisiz;
  TS/JS için yeterli ilk adım.
- **B sınıfı (kısmi):** eklenen/silinen satırlarda **değişen** `export` isimlerini bul;
  repo'da `git grep -l <isim>` ile kullanıcı dosyalarını **listele** (içerik değil):
  "Bu sembol şu 4 dosyada da kullanılıyor" — model içeriği görmese de "başka
  kullanıcılar var, imza değişikliği kırıcı olabilir" bilgisiyle konuşur.

Mimari etki: `changed-file.ts`'e yeni bir `ContextGatherer` portu (`RepoContents`/
`GitReader` üzerinden), `buildUserPrompt`'a bir blok, `maxContextChars` ayarı.
Anchor, posting, sözleşme **dokunulmaz**. Determinizm ve fixture'lar korunur
(bağlam toplama saf fonksiyon + port çağrıları → sahte port ile test).

Zayıflık: model soruyu **soramıyor**; biz doğru tahmin etmek zorundayız. Ama
S2'nin de ihtiyaç duyacağı iki şeyi (arama portu, gizli dosya koruması) bu adımda
kurmuş oluruz.

### S2 — Dar tool-use (kapalı liste, sınırlı tur)

Model, inceleme sırasında **en fazla 3** aracı çağırabilir:

| Araç                            | İş                                                            | PR modunda kaynak                 | Dal modunda kaynak   |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------- | -------------------- |
| `read_file(path, start?, end?)` | ref'e sabit dosya/satır aralığı; `max-file-lines` ile kesilir | `RepoContents.fileContents` (var) | `GitReader.readFile` |
| `read_diff(path)`               | aynı değişim setindeki **başka** dosyanın annotated diff'i    | elimizde (changed files)          | elimizde             |
| `search(pattern, glob?)`        | ref'e sabit metin arama, ilk N eşleşme (dosya:satır:metin)    | **yok** — bkz. §4 GitHub kısıtı   | `git grep -n <sha>`  |

Kapalı liste; `code_comment`/`task_done` gibi araçlara gerek yok: bulgu, döngünün
**son** mesajında bugünkü JSON sözleşmesiyle gelir (sözleşme değişmez, anchor
değişmez). Alternatif olarak `report_findings` aracı ile structured output — parser
sadeleşir ama parite fixture'ları ve `RETRY_PROMPT` mantığı değişir; ikinci aşamaya
bırakılabilir.

Döngü: `ai` SDK `generateText({ tools, stopWhen: stepCountIs(maxSteps) })`. Sınırlar:
dosya başına `max-tool-calls` (öneri 6), `max-tool-steps` (öneri 4), her araç
sonucu karakter sınırlı, aynı `(araç, argüman)` tekrarında kısa devre (D24'ün
hata-serisi kesicisi).

### S3 — Tam agent (OCR gibi: plan turu + 6 araç + bağlam sıkıştırma)

Önermiyorum. OCR'da bu üçlü birlikte var çünkü birbirini zorunlu kılıyor
(uzun döngü → sıkıştırma; çok araç → plan). Bizim PR-merkezli, tek-geçiş
determinizmimizle çelişir; token maliyeti 5–9× (OCR'ın kendi tahmini dosya başına
~7 tur).

### S4 — Hibrit: Kâşif + Hakem (deterministik boru hattı, agent yalnız kanıt toplar)

S2 ve S3'te **aynı konuşma** hem repo'yu gezer hem bulguyu yazar; rastgelelik
sözleşmenin içine sızar. S4 iki işi ayırır:

```text
A. Seçim (biz, saf)         dosya seçimi · guard'lar (D9/D10) · S1 ön-bağlamı
B. Kâşif (agent, sınırlı)   salt-okunur araçlarla gezinir; ARAÇ SONUÇLARINI BİZ KAYDEDERİZ
C. Hakem (tek geçiş)        diff + ön-bağlam + kanıt → bugünkü JSON sözleşmesi
D. Karar (biz, saf)         anchor · doğrulama (D1) · dedup · posting politikası
```

**Kural: agent yönlendirir, kod kaydeder.** Kâşif "şu dosyayı oku, şunu ara" der;
aracı **biz** çalıştırırız ve **kanıt bloğunu araçların gerçek çıktısından** kurarız
(`{ kind: definition|usage|diff|file, path, lines, excerpt }`), kâşifin özetinden
değil. Böylece:

- Kanıt **uydurulamaz** — her satır ref'teki gerçek bir dosyadan geldi; alıntı
  doğrulaması yapısal olarak bedava.
- Hakem çağrısı **bugünkü çağrının aynısı** kalır: aynı sözleşme, aynı `anchor`,
  aynı fixture'lar; prompta yalnız bir "Kanıt" bloğu eklenir (S1 bloğunun yanına).
- Kanıt bloğu **kayda alınabilir ve yeniden oynatılabilir**: `--evidence-log` ile
  dosya başına JSONL; `--replay <log>` ile aynı kanıtla hakem tekrar koşar. Bu,
  D28'i dönüştürür: hakem promptu değişince kâşifi ve parayı tekrar harcamadan,
  **donmuş kanıtla deterministik eval**.
- **Zarif bozulma:** kâşif hata verir/tur sınırına çarparsa hakem yalnız S1
  bağlamıyla koşar; inceleme asla kâşife rehin kalmaz.
- **Maliyet ayrımı:** kâşif ucuz/hızlı bir model olabilir (Haiku, yerel), hakem
  güçlü model. Kâşifin sistem promptu sabit → prompt cache (D25) isabeti yüksek.
- Bütçe iki yerde, ayrı ayrı: `explorer.max-steps`, `explorer.max-evidence-chars`
  (öncelik: çağrılan sembollerin tanımları → değişen sembollerin kullanıcıları →
  ilişkili diff'ler → diğer). Kâşif çok toplarsa **biz** keseriz, hakem şişmez.

OCR ile fark: OCR'ın agent'ı gezerken hipotez kurup **ara soru** sorabilir; S4'te
hakem soru soramaz. Bu bilinçli bir takas — istenirse ileride **tek** ek tur
("hakem `need: [...]` döndürürse kâşif bir kez daha koşar") eklenebilir; ölçüm
göstermeden eklenmemeli.

Neden S2'den iyi: S2'nin bütün altyapısını ister (araç portu, guard, döngü) ama
(1) sözleşme ve anchor hiç değişmez, (2) kanıt denetlenebilir ve tekrar oynatılabilir,
(3) rastgelelik tek fazda kalır ve ölçülebilir hale gelir, (4) modeller ayrışabilir.
Bedeli: kanıt hakeme ikinci kez gönderilir (S2'de aynı konuşmada kalır) → ~%10–20
daha fazla girdi token'ı; ara soru yok.

Mimari etki (S2 tablosuna ek): `core/review/explorer.ts` (kâşif döngüsü + kanıt
derleyici), `core/domain/evidence.ts`, `prompts/explorer.md` (kâşifin politikası —
operatörün dosyası), `buildUserPrompt`'a "Evidence" bloğu, `counterLine`'a
`evidence_items=`, `evidence_chars=`, `explorer_steps=`, `explorer_failed=`.
`FileReviewer` **değişmez**; `reviewChangedFile` kâşifi hakemden önce çağırır.

## 4. S2'nin mimari etkisi — dosya dosya

| Yer                                 | Değişiklik                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/ports/chat-model.ts`          | `generate(messages, options?: { tools?: ToolSet; maxSteps? })` → `{ text, steps: ToolStep[], usage }`. Araç **tanımları** core'dan (isim, şema, açıklama, `execute`), **döngü** adaptörden. `execute` fonksiyonları yalnız port çağırır → core I/O'suz kalır |
| `core/ports/code-context.ts` (yeni) | `readFile(path, ref, range?)`, `search(pattern, ref, glob?, limit)`, `listTree(ref)`. İki adaptör: `infra/git` (tam), `infra/repo-providers/github` (kısıtlı, §GitHub kısıtı)                                                                                |
| `core/review/tools.ts` (yeni)       | Araç seti fabrikası: `contextTools(codeContext, changeSet, guards, limits)`. Yol normalizasyonu (repo kökü dışına çıkamaz), **gizli dosya kara listesi (D9)** ve `exclude` globları burada da uygulanır, sonuç boyutu kesilir, çağrı sayacı                  |
| `core/review/file-reviewer.ts`      | `askForFindings` çok-adımlı: son metin JSON; araç adımları `Finding`'e değil sayaca gider. `RETRY_PROMPT` korunur                                                                                                                                            |
| `prompts/tools.md` (yeni)           | "Ne zaman araç kullan, ne zaman kullanma" politikası — **sözleşmeye değil politikaya** ait: operatör değiştirebilir. Sözleşmeye yalnız "araç sonuçlarından alıntı yapma; `existing_code` hâlâ diff'ten" satırı eklenir                                       |
| `core/review/orchestrator.ts`       | `fileLimit` artık "eşzamanlı dosya" değil "eşzamanlı model çağrısı" gibi davranır; **D12 bütçesi zorunlu** hale gelir (bir dosya 1 yerine 1+N çağrı)                                                                                                         |
| `counterLine`                       | `tool_calls=`, `tool_read=`, `tool_search=`, `tool_diff=`, `tool_refused=` (guard), `tool_steps_capped=`                                                                                                                                                     |
| `config.yaml`                       | `defaults.tools: { enabled: true, max-calls-per-file: 6, max-steps: 4, max-result-chars: 4000 }`; proje ezebilir; `--no-tools` bayrağı                                                                                                                       |
| Testler                             | Sahte model **scriptli** olmalı (adım 1: araç çağır, adım 2: JSON). `tests/contracts/file-reviewer` fixture'ları tek-tur; yeni testler ayrı dosyada. Parite: bilinçli ayrışma (ADR)                                                                          |

### GitHub kısıtı (kritik)

GitHub REST **code search** yalnız **varsayılan dalı** indeksler; PR head SHA'sına
sabitlenemez. Yani PR modunda `search` aracı için üç yol var:

1. **Değişen dosyalar içinde arama** — elimizde, bedava, ama B sınıfını (diğer
   kullanıcılar) yakalamaz.
2. **Ağaç + seçici okuma** — `GET /git/trees/{sha}?recursive=1` ile dosya listesi
   (`file_find` bedavaya gelir), sonra aday dosyaları `fileContents` ile çekip yerelde
   grep. Aday seçimi (glob) iyi ise makul; kötüyse N istek.
3. **Sığ klon / tarball** — `GET /tarball/{sha}` tek istek, sonra yerel `grep`. Büyük
   repoda ağır ama tam güç; önbelleklenebilir (aynı head için bir kez).

Dal modunda bu sorun yok: `git grep -n <sha> -- <glob>`.

**Sonuç:** S2, dal modunda tam, PR modunda kısıtlı doğar. Bu asimetri belgelenmeli;
PR modunda (1)+(2) ile başlamak, (3)'ü ölçüme göre eklemek mantıklı.

## 5. Risk ve maliyet

| Konu            | Değerlendirme                                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token / ücret   | Dosya başına 1–2 çağrı → 2–6 çağrı; girdi her adımda büyür. **D25 (prompt cache)** ve **D12 (bütçe)** olmadan açılmamalı. OCR'ın "Claude Code'a göre 1/9 token" iddiası **agent'a göre** ucuz olduğu içindir; bize göre pahalıdır                                      |
| Güvenlik        | Model, diff dışı dosya okuyabilir → `.env`, anahtar dosyaları. **D9 kara listesi araçlara da şart**; yol normalizasyonu (`..`), yalnız salt okunur, yalnız ref'e sabit. ADR 0001 ruhu: kapalı araç listesi, sağlayıcıya yeni yetki yok (mevcut `contents: read` yeter) |
| Determinizm     | Aynı diff için araç çağrıları değişebilir → bulgu çıktısı daha az tekrarlanabilir. Sayaçlar ve `--no-tools` ile karşılaştırma imkânı korunmalı                                                                                                                         |
| Anchor          | Model araç sonucundan alıntı yaparsa `existing_code` diff'te bulunmaz → `failed`/`conflict` artar. Sözleşmeye tek satır: "alıntı yalnız incelenen dosyanın diff'inden". `anchor_*` sayaçları bunu **bedava ölçer**                                                     |
| Hata döngüleri  | Aynı hatayı tekrar eden araç çağrıları (D24): `(araç, argüman)` başına 2 hata → araç kapatılır, model "araç yok, eldeki bilgiyle bitir" mesajı alır                                                                                                                    |
| Sağlayıcı farkı | Anthropic ve OpenAI-uyumlu (LM Studio, vLLM) tool-calling desteği ve kalitesi farklı; yerel modellerde tool çağrısı sık bozuk gelir → `tools.enabled` proje seviyesinde kapatılabilmeli (yerel model projesi: `false`)                                                 |
| Efor            | S1: ~2–3 gün (port + toplayıcı + prompt bloğu + testler). S2: ~1.5–2 hafta (port genişlemesi, iki adaptör, araç seti, döngü, guard, sayaçlar, config, testler, ADR). S3: haftalar                                                                                      |

## 6. Ölçmeden karar vermemek

D4'ün getirisini **iddia** edebiliriz, **gösteremeyiz**: kalite ölçümümüz yok (D28).
Önerilen deney tasarımı, D28'in küçük altın kümesi (10–20 PR) hazır olduktan sonra:

1. `--no-tools` (S0) ile precision/recall.
2. S1 ile aynı küme.
3. S2 ile aynı küme, `tool_*` ve `anchor_*` sayaçlarıyla birlikte.

4. S4 ile aynı küme; ayrıca **aynı kanıt logu ile ikinci koşu** — hakem çıktısının
   tekrarlanabilirliği (S2'de bu deney yapılamaz).

Karar kuralı önerisi: S2/S4, S1'e göre precision'ı **ölçülebilir** artırmıyorsa
(veya token maliyeti 3×'i aşıyorsa) alınmaz; S1 kalır. S4 ile S2 arasında: aynı
precision'da S4 tercih edilir (denetlenebilirlik + replay).

## 7. Öneri

1. **Önce zemin:** D9 (gizli dosya koruması) + D10 (deterministik dosya seçimi) +
   D12'nin ucuz kısmı (`usage` toplama, `tokens_in/out` sayaçları) + D28 (küçük eval).
   Bunlar D4'ten bağımsız olarak değerli ve D4'ün ön koşulu.
2. **S1'i al** (araçsız ön-bağlam): tek geçiş ve determinizm korunur; `CodeContext`
   portu ve arama adaptörleri bu adımda doğar; etkisi D28 ile ölçülür.
3. **Hedef S4, S2 değil.** ADR 0008 taslağı: "Kanıt toplama agent'a, yargı tek
   geçişe: kâşif yönlendirir, kod kaydeder." Dal modunda pilot (yerel git → tam
   güç), PR modunda `read_file` + `read_diff` + değişen-dosyalar-içi `search`.
   Açılış bayrağı kapalı (`explorer.enabled: false`), `--evidence-log`/`--replay`
   ilk günden; ölçüm sonrası varsayılan kararı.
4. **S3'ü alma.** Plan turu (D5) S4'te kâşifin kendisidir; bağlam sıkıştırma (D23)
   S4'te gereksizdir (kâşif konuşması kısa, hakem tek tur).

## 8. Karar noktaları (onay bekleyen)

| #   | Soru                                                                     | Önerim                                                                 |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| K1  | S1 ile mi başlayalım, doğrudan S4 mü?                                    | **S1** — S4'ün ön-bağlam tabanı ve altyapısıdır, riski taşımaz         |
| K2  | Araçlı hedef: S2 (tek konuşma) mi, S4 (kâşif + hakem) mi?                | **S4** — sözleşme/anchor değişmez, kanıt denetlenebilir, replay        |
| K3  | PR modunda `search`: değişen dosyalar içi mi, ağaç+okuma mı, tarball mı? | (1)+(2) ile başla; (3) ölçüme göre                                     |
| K4  | Kâşif politikası metni nerede?                                           | `prompts/explorer.md` — operatörün dosyası; sözleşmeye tek satır       |
| K5  | Varsayılan `explorer.enabled`?                                           | `false` — ölçüm sonrası açılır; yerel model projelerinde `false` kalır |
| K6  | D28 olmadan S4'e başlansın mı?                                           | **Hayır** — ama S4'ün replay'i D28'i ucuzlatır; birlikte planlanabilir |
| K7  | Kâşif modeli hakemle aynı mı, ayrı (ucuz) mu?                            | `defaults.llm` hakem; `explorer.llm` opsiyonel ezme — ölçümle seç      |
| K8  | Hakemin "daha kanıt iste" turu?                                          | İlk sürümde **yok**; ölçüm gösterirse tek turla sınırlı                |
