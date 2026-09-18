# Bun'a geçiş — kayıt

Durum: **uygulandı** (v2.0.0). Bu belge, geçişin neden ve nasıl yapıldığını,
hangi kütüphanenin neyle değiştirildiğini ve geçişin değiştirdiği
semantiklerin nasıl karşılandığını kayda geçirir. Ölçümler 2026-09-18'de,
macOS üzerinde Bun 1.4.2 ile yapıldı.

## 1. Karar

Bun tek araçtır: paket yöneticisi, script çalıştırıcı, test çalıştırıcı **ve
runtime**. Derleme adımı yoktur; `bin` doğrudan `src/cli/main.ts`'e işaret eder ve
Bun TypeScript'i olduğu gibi çalıştırır. Aynı işi yapan iki kütüphane
bulunmaz — bkz. §2.

Sonuç: 294 paket → 204 (geliştirme), action'da yalnızca runtime
bağımlılıklarıyla 53 paket / 39 ms kurulum. Testler 899/899, `--parallel` ile
2,5 s (vitest 3,5 s idi).

## 2. Bağımlılık envanteri

| Bağımlılık                                                                                  | Karar                                          | Gerekçe                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execa`                                                                                     | **kaldırıldı** → `Bun.spawn` / `Bun.spawnSync` | Tek kullanım `runGit` idi; testlerdeki kurulum yardımcısı da `tests/helpers/git.ts`'te tek yerde toplandı.                                                                                         |
| `dotenv`                                                                                    | **kaldırıldı** → `node:util` `parseEnv`        | Bun uyguluyor; okunan `.env` dosyaları düz `K=V` biçiminde.                                                                                                                                        |
| `tsup`, `tsx`                                                                               | **kaldırıldı**                                 | Derleme yok; Bun kaynağı çalıştırır. `dist/`, `tsup.config.ts`, `prepare` script'i ve `volta` bloğu gitti.                                                                                         |
| `vitest`, `@vitest/eslint-plugin`, `vitest.config.ts`                                       | **kaldırıldı** → `bun:test`                    | Paketin kullandığı yüzey (`describe/it/expect/it.each`) birebir mevcut. `.only`/`.skip`'i yakalayan kural artık `no-restricted-syntax` ile, eklentisiz (bkz. §3.3).                                |
| `jiti`                                                                                      | **kaldırıldı**                                 | ESLint, Bun altında `eslint.config.ts`'i natif yüklüyor (`process.features.typescript === "transform"`); doğrulandı.                                                                               |
| `@typescript/native` (TypeScript 7)                                                         | **kaldırıldı**                                 | `typescript-eslint` `typescript <6.1` ister; iki derleyici yerine tek: TypeScript 6. `tsc --noEmit` Bun altında ~0,9 s.                                                                            |
| `@types/bun`                                                                                | **eklendi**                                    | `Bun.spawn`, `bun:test` tipleri. `@types/node` ile çakışmadığı tüm projede doğrulandı.                                                                                                             |
| `yaml`                                                                                      | **kaldı**                                      | `catalog-files.ts` yorumları koruyan `parseDocument` kullanır; `Bun.YAML` bunu yapamaz. İki YAML kütüphanesi olmasın diye her yerde `yaml`.                                                        |
| `pino`, `commander`, `zod`, `awilix`, `p-limit`, `difflib`, `parse-diff`, `ai`, `@ai-sdk/*` | **kaldı**                                      | Bun'da natif karşılığı yok; birbirinin işini yapan yok.                                                                                                                                            |
| `eslint-plugin-n`                                                                           | **kaldı, yeniden ayarlandı**                   | `no-unsupported-features/*` (Node sürümüne göre API kapısı) ve `hashbang` (bayraklı shebang'i tanımaz) kapatıldı; `no-extraneous-import`, `no-unpublished-import`, `no-deprecated-api` iş görüyor. |

## 3. Farklı davranan semantikler ve karşılıkları

### 3.1 Bun çalışma dizinindeki `.env`'i otomatik yükler

Ölçüldü: `.env` bulunan bir dizinde `bun script.ts` o değerleri
`process.env`'de görür; `bun test` de öyle. Bu, `src/providers/config/environment-files.ts`'in
belgelediği ve test ettiği öncelik sırasıyla çakışır: çalışma dizininin
`.env`'i **en zayıf** kaynaktır, `~/.config/reviewer/.env` onu geçer,
`.review/.env` onu da geçer, gerçek ortam hepsini geçer. Bun'un yüklemesiyle
checkout'un `.env`'i "gerçek ortam"a terfi eder ve kazanırdı — CI'da çalışma
dizini incelenen (güvenilmeyen) checkout olduğu için bir pull request
reviewer'a `LLM_BASE_URL` set edebilirdi.

Karşılığı üç yerde, her biri doğrulanmış:

- `bunfig.toml` → `env = false`: bu depodan çalışan her şey (testler,
  `bun run …`) için.
- İki yürütülebilir dosyanın shebang'i: `#!/usr/bin/env -S bun --no-env-file`
  — çünkü incelenen checkout'un `bunfig.toml`'u üzerinde söz hakkı yok.
- `action.yml` ve `comment-action/action.yml`: `bun --no-env-file …` açıkça.

### 3.2 `bun:test` tipleri ve başlıkları

- `toEqual(expected)` gerçek değerin tipine karşı tiplenir; `unknown` beklenti
  geçen 19 nokta `tests/contracts/fixtures.ts`'e eklenen `caseNamed<I, E>()`
  (mevcut `casesUnder` deyimiyle aynı) ve `casesUnder<I, E>` ile tiplendi.
  Eksik bir fixture case'i artık `undefined` yerine hata verir.
- `expect(SEVERITIES.length).toBe(n)` → `expect(SEVERITIES).toHaveLength(n)`;
  `expect(KEYS).toContain(key)` → `expect(key).toBeOneOf(KEYS)`.
- `rejects: Matchers<unknown>` olarak bildirildiği için `await expect(p).rejects.toThrow()`
  tip denetçisine "awaited void" görünür; await gerçekte gereklidir. Test
  dosyalarında `@typescript-eslint/await-thenable` ve
  `no-confusing-void-expression` kapatıldı, gerekçesi `eslint.config.ts`'te.
- `it.each` başlıklarında nesne satırları için `%s` yerine `$name`; tuple ve
  string satırlarında `%s` olduğu gibi çalışıyor.

### 3.3 Çalıştırıcı davranışı

- `bun test` bir `.only`'yi sessizce çalıştırır: dosyanın geri kalanı rapor
  edilmeden yok olur. Bun için test-runner eslint eklentisi olmadığından
  `it|test|describe` üzerinde `.only|.skip|.todo` üye erişimi
  `no-restricted-syntax` ile hata (doğrulandı: `it.only`, `it.skip.each`,
  `describe.todo` yakalanıyor, `it.each` yakalanmıyor).
- `[test] timeout` `bunfig.toml`'da belgelenmiş ama 1.4.x'te dikkate
  alınmıyor (oven-sh/bun#38728); `test` script'i `--timeout 20000` geçer.
- `bun test` dosyaları varsayılan olarak seri çalıştırır; `--parallel` süreyi
  yarıya indiriyor, script'te açık.
- `[run] bun = true`: `node_modules/.bin`'deki `tsc`/`eslint`/`prettier`
  `#!/usr/bin/env node` der; bu ayar onları Bun ile çalıştırır, Node ikinci
  bir runtime olarak gerekmez.

### 3.4 Sürüm sabitleme

`.bun-version` (1.4.2) ve `package.json` `packageManager`. `oven-sh/setup-bun`
önce boş olmayan `bun-version` girdisini, sonra `bun-version-file`'ı okur
(kaynaktan doğrulandı); action'lar dosyayı her zaman, girdiyi verilmişse geçer.

## 4. Değişen dosyalar

- `package.json` — v2.0.0; `bin` → `src/cli/main.ts` (v2.1.0'da tek yürütülebilir, bkz. §7);
  `exports["./core"]` → `src/core/index.ts`; `files` `dist` → `src`; script'ler
  Bun; `engines.bun`, `packageManager`; `prepare`/`volta` yok.
- `bunfig.toml`, `.bun-version`, `bun.lock` — yeni. `package-lock.json`,
  `tsup.config.ts`, `vitest.config.ts`, `.vitest/`, `dist/` — silindi.
- `src/cli/main.ts` — shebang (çalıştırılabilir).
- `src/providers/git/local-git.ts` — `runGit` `Bun.spawn` ile; iki pipe ve çıkış
  birlikte beklenir, başlatılamayan git `GitError`.
- `src/providers/config/environment-files.ts` — `parseEnv`.
- `tests/**` — `bun:test` importları, tipleme, `tests/helpers/git.ts`.
- `tsconfig.json` — `types: ["node", "bun"]`.
- `eslint.config.ts` — §2 ve §3.3'teki kurallar; `bun`, `bun:test` core
  module.
- `.gitignore`, `.prettierignore` — Node/vitest/dist kalıntıları yok,
  `bun.lock` formatlanmaz.
- `action.yml`, `comment-action/action.yml` — `setup-bun` (SHA-pinli v2.2.0),
  `bun install --frozen-lockfile --production --ignore-scripts`, derleme yok,
  `bun --no-env-file src/cli/…`. `node-version` girdisi → `bun-version`:
  README politikasına göre **yeni major (v2)**; `v1` tag'i eski runtime'da
  kalır.
- `.github/workflows/pr-review.yml`, `README.md` — `@v2`, kurulum ve geliştirme
  bölümleri.

## 5. Doğrulama

```bash
bun install
bun run check                                   # tsc + eslint + prettier + 899 test
./src/cli/main.ts --help && ./src/cli/main.ts comment --help
bun run reviewer -- --preview --base main       # model çağırmaz
```

Ayrıca doğrulanan: action'ın kurulum yolu (`--production`, 53 paket) ile iki
CLI çalışıyor; `bun add -g file:…` ile kurulan paketin `bin` sembolik
bağlantıları `.ts` girişlerine gidiyor ve kurulu konumdan `packageRoot()`
shipped dosyaları buluyor.

## 6. Geri alma

Tek revert: `package-lock.json`, `dist` tabanlı `action.yml` ve `vitest`
geçmişte; `v1` tag'i o dünyada kalır.

## 7. Ardından: tek yürütülebilir, kayıtlı komutlar (v2.1.0)

`review-comment` ayrı bir yürütülebilir olmaktan çıktı; `reviewer comment` bir
alt komut. Güvenlik ayrımı yürütülebilirler arasında değil **koşular**
arasındaydı zaten: review hiçbir hosting token'ı okumaz, `comment` hiçbir
model kurmaz; her birinin kendi kompozisyon kökü var ve workflow her birine
kendi işini ve iznini verir. `comment-action` girdileri değişmedi.

`src/cli/` yeniden adlandırıldı ve bölündü: `main.ts` (süreç girişi),
`reviewer.ts` (kök komut — bir kayıt listesi, kendi dallanması yok),
`commands/{review,catalog,comment,shared}.ts`, `command-line.ts` (eski
`program.ts`: bir komut nasıl tanımlanır, hataları nasıl exit koduna döner).

Komutlar **Command pattern** ile: her modül bir `CliCommand` sabiti dışa
aktarır (`REVIEW`, `INIT`, `PROJECTS`, `ADD`, `COMMENT`); parse bir
`Invocation` (argümanlarına bağlanmış komut + `run()`) üretir; kök
`parseArguments(argv).run()` der, `switch`/`if` yok. Ortak parçalar tek yerde:
`defineCommand(spec)` Commander `action`/`optsWithGlobals`/positional
kalıbını, `ParsedOptions<A>` eşlenmiş tipi `XOptions` arayüzlerini,
`commands/shared.ts` `--config` bayrağı, rapor biçimi kaydı ve
inceleme yapmayan komutların `RunRequest`'ini üstlenir.

Bayrak değerleri için de bir standart var: `OptionParser<T>` (`metin → T`,
`InvalidArgumentError` ile reddeder) ve alan-bağımsız kombinatörler —
`choice(values, { label, caseInsensitive })`, `integer`, `listOf(item, { none })`,
`repeatable(item)`, `text`. Alan sözlüğü bunları kullanan yerde birleşir:
`severityList = listOf(choice(SEVERITIES, …), { none: "none" })` (`commands/shared.ts`).
`command-line.ts` artık `core/`'dan hiçbir şey ithal etmez. Aynı ilkeyle:
operator hataları `instanceOfAny(…)`, kayıt varsayılanı `Registry.defaultName()`,
liste varsayılanları help'te `none` diye yazılır (`Option.default([], "none")`).

Kütüphanenin kendi komut nesnesini veren alternatifler Bun altında denendi:

| Kütüphane                 | Komut modeli                                                                                           | Neden seçilmedi                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@stricli/core` (1M/hf)   | `buildCommand` + `buildRouteMap({ defaultCommand })`, sıfır bağımlılık, flag tipi ↔ parser derleyicide | En yakın aday; ama exit-kod sözleşmesi, hata metni ve kebab-case için ayar, testlerin parse-ayrı tarzından vazgeçiş, küçük topluluk |
| `clipanion` (4.6M/hf)     | sınıf tabanlı `Command`, `Command.Default`                                                             | 4.0.0-rc, typanion bağımlılığı, hata çıktısı stack trace'li, ANSI help                                                              |
| `citty` (28M/hf)          | `defineCommand({ args, run })`                                                                         | varsayılan alt komut yok; kök `run` alt komuttan sonra da koşuyor                                                                   |
| **`commander`** (462M/hf) | zincir; komut nesnesi yok                                                                              | **kaldı**: sıfır bağımlılık, en yaygın; ~60 satırlık `CliCommand`/`Invocation` kaydı deseni sağlıyor, exit-kod/hata kontrolü bizde  |
