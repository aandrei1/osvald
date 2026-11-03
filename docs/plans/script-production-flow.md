# Plan: fluxul de producție al unui script (`ScriptProductionFlow`)

Stare: **Etapele 0, 1 și 2 făcute** (2026-11-03). Urmează **Etapa 3**.
Decis cu Andrei pe 2026-11-03. Orice abatere de la deciziile de mai jos se discută înainte de implementare.

## De ce

Azi, logica de import e împrăștiată în trei locuri:

- ruta de upload: [`routes/scripts/index.ts`](../../packages/backend/src/routes/scripts/index.ts);
- jobul de parsare: [`queue/jobs/script-parsing.ts`](../../packages/backend/src/queue/jobs/script-parsing.ts);
- salvarea: [`services/script.service.ts`](../../packages/backend/src/services/script.service.ts).

Nicăieri nu se vede fluxul întreg. Fluxul nou adaugă un pas uman (review), workspace-uri cu permisiuni și generare audio prin Azure. Vrem o arhitectură care să reflecte business-ul: un singur fișier, `ScriptProductionFlow`, ale cărui metode, prin semnăturile lor, spun povestea fluxului.

Vocile feminine românești sunt motivul pentru Azure. Nu există voci offline gratuite, iar alternativele open-source testate sunt prea lente pe CPU:

| Model           | Rezultat                                                       |
| --------------- | -------------------------------------------------------------- |
| F5-TTS Romanian | ~500× mai lent decât timpul real                               |
| Ro_FastPitch    | ~4× mai lent decât timpul real, din cauza vocoderului HiFi-GAN |

## Fluxul de business

1. **Coordonatorul (editorul) încarcă PDF-ul.** Urmează OCR, parsare, corecții automate și genul sugerat pentru fiecare personaj.
2. **Review:** editorul vede toate replicile, corectează textul și confirmă genul și vocea fiecărui personaj. Poate asculta o previzualizare a vocii.
3. **Submit:** editorul vede o estimare („X caractere, Y% din cota rămasă”) și confirmă. Generarea audio Azure rulează în fundal, cu progres și durată estimată.
4. **Repetiția** e posibilă oricând. Replicile fără audio Azure se citesc cu vocile offline.

## Decizii luate

**Arhitectură:**

- **Mașină de stări explicită**, nu un motor de workflow precum Temporal. Firul real al fluxului e etapa salvată în Postgres, nu o funcție care așteaptă.
- **Două tipuri de metode în `ScriptProductionFlow`.** Comenzile vin de la oameni, reacțiile `on…` vin de la joburi. Ambele salvează și răspund imediat cu noua etapă, nu cu rezultatul muncii.
- **Reacțiile salvează rezultatul jobului și schimbă etapa în aceeași tranzacție.** De exemplu, `onExtractionCompleted` scrie replicile și mută scriptul în `in_review`.

**Comportament:**

- **Reparse și ștergere permise în orice etapă.** De fiecare dată, utilizatorul vede înainte ce se pierde (replici editate, caractere de audio generate) și confirmă.
- **Reparse-ul pierde corecturile manuale de text**, cu avertisment explicit. Nu încercăm potrivirea replicilor vechi cu cele noi.
- **Audio-ul se stochează după conținut:** cheia e `hash(voiceId + text exact)`. Replicile care ies identice după reparse sau reîncărcare își păstrează audio-ul, fără cotă consumată din nou.
- **Fără editări în timpul generării.** Butonul „Oprește generarea” întoarce scriptul în review, iar replicile deja generate își păstrează audio-ul.

**Workspace-uri și roluri:**

- **Un singur editor per workspace.** Cine creează workspace-ul devine editor. Rolul se poate transfera, atomic.
- **Membrii doar citesc și repetă.** Nu schimbă voci, fiindcă o voce Azure schimbată înseamnă regenerare.
- **Permisiunile se verifică pe server**, în fiecare comandă. Aplicația doar ascunde butoanele.
- **Invitații pe e-mail**, prin portul `EmailSender` (SMTP), cu **Mailpit** în `docker-compose` pentru dezvoltare.

**Azure:**

- **O singură cheie Azure acum (globală), cu codul gândit pentru o cheie per workspace.** Portul `SpeechAccountResolver.accountFor(workspaceId)` întoarce cheia, regiunea și un `accountId`. Bugetul se numără pe `accountId`.
- **Contorul de caractere stă în backend (Postgres)**, nu în serviciul TTS. Rezervarea e atomică, iar serviciul TTS doar execută sinteza.

**Recuperare:**

- **Joburi pierdute:** un job periodic (repetitiv BullMQ) citește din baza de date scripturile blocate într-o etapă „în lucru” și le repune în coadă, cu ID de job idempotent `scriptId_runId` (BullMQ nu acceptă `:`). Fără coadă cu delay, fiindcă stă tot în Redis.

### Presupuneri (Andrei le poate respinge)

- **Bugetul lunii se termină în timpul generării:** scriptul trece în `paused_budget`. La repetiție, replicile fără audio Azure folosesc vocile offline, cu indicator vizibil.
- **Didascaliile** se citesc doar cu vocile offline.
- **Voci Azure expuse:** doar `ro-RO-AlinaNeural`, configurabil prin `TTS_AZURE_VOICES`.
- **Limită per utilizator:** nu e necesară, fiindcă doar editorul poate da submit.
- **Review-ul cu AI** e în afara acestui plan. Matricea de permisiuni îl va acoperi când îl adăugăm.

## Etapele scriptului

Definite o singură dată în `packages/shared` și înlocuiesc actualul `scriptStatusSchema` (`uploaded | parsing | parsed | failed`).

| Din                                         | Comandă sau eveniment                                    | În              |
| ------------------------------------------- | -------------------------------------------------------- | --------------- |
| —                                           | `startImport`                                            | `extracting`    |
| `extracting`                                | `onExtractionCompleted`                                  | `in_review`     |
| `extracting`                                | `onExtractionFailed` (doar după ultima încercare BullMQ) | `failed`        |
| orice etapă                                 | `reparse` (cu rezumatul pierderilor, `runId` nou)        | `extracting`    |
| `in_review`, `ready` (cu replici învechite) | `submitForSynthesis`                                     | `synthesizing`  |
| `synthesizing`                              | `onSynthesisCompleted`                                   | `ready`         |
| `synthesizing`                              | `onSynthesisPaused('budget')`                            | `paused_budget` |
| `synthesizing`, `paused_budget`             | `stopSynthesis`                                          | `in_review`     |
| `paused_budget`                             | `resumeSynthesis` (buget disponibil)                     | `synthesizing`  |
| orice etapă                                 | `delete` (cu rezumatul pierderilor)                      | rândul e șters  |

**Stare per replică**, pentru regenerarea parțială: `none | up_to_date | stale`. O editare în `ready` marchează replica `stale`, iar scriptul rămâne `ready`, cu „N replici de regenerat”. Submit-ul trimite doar replicile `none` și `stale` cu voce Azure.

**Garanții de corectitudine:**

- **Schimbări de etapă condiționate:** `UPDATE … WHERE stage = <etapa așteptată>`. Dacă nu se potrivește, comanda primește o eroare clară. Contează și cu un singur editor, care poate avea aplicația deschisă pe două dispozitive.
- **Fiecare rulare primește un `runId` salvat pe script.** Reacțiile cu alt `runId` sunt ignorate, deci un job vechi nu suprascrie un reparse nou.
- **Jobul de generare verifică etapa și `runId` înainte de fiecare apel Azure**, ca să nu consume cotă pe un script oprit sau re-extras.

## Schița `ScriptProductionFlow`

```ts
// packages/backend/src/flows/script-production-flow.ts
export class ScriptProductionFlow {
  // Comenzi
  startImport(
    actor: Actor,
    workspaceId: Id,
    file: UploadedPdf,
  ): Promise<StageChanged<'extracting'>>;
  reparse(actor: Actor, scriptId: Id): Promise<StageChanged<'extracting'>>;
  previewReparse(actor: Actor, scriptId: Id): Promise<LossSummary>;
  reviseLine(actor: Actor, scriptId: Id, lineId: Id, text: string): Promise<LineRevised>;
  confirmGender(
    actor: Actor,
    scriptId: Id,
    characterId: Id,
    gender: Gender,
  ): Promise<CharacterUpdated>;
  castVoice(
    actor: Actor,
    scriptId: Id,
    characterId: Id,
    voiceId: VoiceId,
  ): Promise<CharacterUpdated>;
  previewVoice(actor: Actor, scriptId: Id, voiceId: VoiceId): Promise<AudioRef>;
  estimateSynthesis(actor: Actor, scriptId: Id): Promise<SynthesisEstimate>;
  submitForSynthesis(actor: Actor, scriptId: Id): Promise<StageChanged<'synthesizing'>>;
  stopSynthesis(actor: Actor, scriptId: Id): Promise<StageChanged<'in_review'>>;
  resumeSynthesis(actor: Actor, scriptId: Id): Promise<StageChanged<'synthesizing'>>;
  previewDelete(actor: Actor, scriptId: Id): Promise<LossSummary>;
  delete(actor: Actor, scriptId: Id): Promise<void>;

  // Reacții (joburile „revin pe fir”)
  onExtractionCompleted(run: RunRef, result: ExtractionResult): Promise<StageChanged<'in_review'>>;
  onExtractionFailed(run: RunRef, error: ExtractionError): Promise<StageChanged<'failed'>>;
  onSynthesisProgress(run: RunRef, progress: SynthesisProgress): Promise<ProgressSaved>;
  onSynthesisCompleted(run: RunRef): Promise<StageChanged<'ready'>>;
  onSynthesisPaused(run: RunRef, reason: 'budget'): Promise<StageChanged<'paused_budget'>>;
}
```

Fiecare metodă respectă același tipar:

1. `authorize(actor, permission)`;
2. verificarea tranziției;
3. munca prin porturi;
4. schimbarea condiționată a etapei.

**Straturile:**

```
routes/    HTTP subțire: validare Zod, apelează o comandă
jobs/      BullMQ subțire: munca grea (OCR, Azure), raportează prin reacții
flows/     ScriptProductionFlow: pași, permisiuni, tranziții
ports/     OcrPort, SpeechPort, SpeechAccountResolver, UsageLedger, AudioStore, EmailSender, Clock
adapters/  ocr-service HTTP, tts-service HTTP, Postgres, SMTP
```

În `packages/shared` stau: etapele, tabela de tranziții, starea audio a replicii, rolurile, matricea de permisiuni și evenimentele (regula 1 din `AGENTS.md`).

## Fapte despre Azure (de verificat în Etapa 0)

**Verificate pe paginile oficiale în engleză, 2026-11-03:**

- **Cota F0:** 0,5 milioane de caractere neurale pe lună ([pagina de prețuri](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/)).
- **Ce se facturează:** caracterele din fiecare cerere procesată cu succes: litere, cifre, spații, tab-uri, punctuație și tot marcajul SSML, cu excepția tag-urilor `<speak>` și `<voice>`. Se numără fiecare code point Unicode, indiferent dacă iese audio. Contorul numără deci textul după escape-ul XML ([Text to speech overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech#billable-characters)).
- **Limite F0:** **20 de tranzacții pe 60 de secunde**, nereglabile ([Quotas and limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)). Audio maxim 10 minute pe cerere.
- **429:** pagina oficială spune că majoritatea erorilor 429 la vocile standard vin din capacitatea backend-ului pentru o voce într-o regiune, nu din cote. Deci 429 nu înseamnă automat „cota lunară s-a terminat”, iar codul trebuie să reîncerce cu backoff.
- **Alina:** `ro-RO-AlinaNeural` e în lista oficială, tip _Standard_ (feminin). Alături sunt `ro-RO-EmilNeural` (masculin) și voci HD noi, `ro-RO-Elena`, `ro-RO-Ioana` (feminine) și `ro-RO-Andrei`, `ro-RO-Radu` (masculine), toate `:MAI-Voice-2` ([Language and voice support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)). Vocile HD nu sunt acoperite de planul actual: au alt preț și suport SSML mai restrâns.
- **Lista de voci:** `GET /tts/cognitiveservices/voices/list` cu cheia în `Ocp-Apim-Subscription-Key` ([REST reference](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices)). Documentația nu spune că se facturează, iar definiția facturării vorbește doar despre caractere sintetizate.

**Neconfirmate oficial:**

- **Epuizarea cotei F0:** documentația oficială nu spune explicit. Răspunsuri de moderator pe Microsoft Q&A susțin că serviciul **se oprește până la resetul lunar** și că F0 **nu trece automat pe plată**, fiindcă pentru facturare trebuie trecut manual pe S0. Planul presupune asta, iar manualul din Etapa 4 (buget artificial ~300) acoperă doar contorul nostru, nu epuizarea reală.
- **Resetul cotei:** nicio pagină oficială nu dă data. Presupunem luna calendaristică (UTC). `UsageLedger` o poate trata ca parametru.
- **Termenii pentru stocarea și reutilizarea audio-ului:** nu am găsit textul Microsoft Product Terms. Răspunsuri comunitare spun că audio-ul din voci neurale prebuilt se poate folosi, inclusiv comercial, **doar pe nivelul plătit**, cu obligația de a anunța că e sintetic și interdicția de a-l folosi pentru a antrena un TTS concurent. Nu am putut confirma ce se aplică pe F0. **Andrei:** merită citiți Product Terms înainte să stocăm audio permanent (decizia „stocare după conținut”).

**Dimensiunea pieselor existente**, în caractere de dialog: Avarul 98.024, Don Juan 92.087, Tartuffe 87.796.

## Etape de implementare

Fiecare etapă se încheie cu aplicația funcțională, testele verzi și typecheck-ul și lint-ul curate. Etapele 1–3 nu au nevoie de cheia Azure.

### Etapa 0: pregătire

**Andrei:**

- [ ] cont Azure cu abonament;
- [ ] resursă **Speech**, tier **Free F0**, regiunea **West Europe**;
- [ ] în `.env` din rădăcina proiectului (ignorat de git): `AZURE_SPEECH_KEY=…` și `AZURE_SPEECH_REGION=westeurope`. **Cheia nu se trimite în chat.**
- [ ] opțional, o alertă de buget în Azure Cost Management, de exemplu la 1 USD.

**AI:**

- [x] verifică pe paginile oficiale în engleză fiecare punct „neverificat” de mai sus și actualizează această secțiune (făcut 2026-11-03; rămân trei puncte neconfirmate oficial);
- [x] după ce Andrei confirmă că cheia e pusă: un singur apel de listare a vocilor, care nu consumă caractere, ca să confirme că cheia și regiunea merg și că Alina există. **Făcut 2026-11-03:** HTTP 200, 1025 de voci, `ro-RO-AlinaNeural` (feminin, GA, 48 kHz) și `ro-RO-EmilNeural` (masculin, GA) sunt disponibile. Celelalte voci `ro-RO` (Dragon, MAI-Voice) sunt _Preview_.

**Abatere de la plan:** resursa e în **Sweden Central** (`AZURE_SPEECH_REGION=swedencentral`), nu West Europe, fiindcă Andrei n-a putut crea resursa în West Europe. Regiunea rămâne configurabilă, iar endpoint-ul se construiește din ea. Cheia stă în `.env` din rădăcină.

### Etapa 1: fundația fluxului

- etapele, tranzițiile și evenimentele în `shared`;
- coloanele `stage`, `stage_entered_at` și `run_id` pe `scripts`, cu migrarea statusurilor vechi: `parsed` devine `in_review`, `uploaded` și `parsing` devin `extracting`, `failed` rămâne `failed`;
- `ScriptProductionFlow` cu `startImport`, `onExtractionCompleted`, `onExtractionFailed`, `reparse` și `delete`, plus rezumatele de pierderi;
- schimbări de etapă condiționate, verificarea `runId` și jobul periodic de recuperare;
- ruta de upload și jobul de parsare devin subțiri, iar frontend-ul citește `stage`;
- teste pe flux cu porturi false: tranziții, evenimente vechi, concurență, recuperare.

**Făcut 2026-11-03.** Abateri și detalii de implementare:

- **`status` e înlocuit complet acum, nu în Etapa 5.** Migrarea `0003` adaugă coloanele și mapează statusurile, iar `0004` șterge coloana `status` și enum-ul `script_status`. Clientul primește `stage` și `stageEnteredAt`. `runId` nu iese din server.
- **ID-ul jobului e `scriptId_runId`**, nu `scriptId:runId`, fiindcă BullMQ 6 respinge `:` în ID-urile custom.
- **Reacțiile întorc `StageChanged | StaleReaction`.** O reacție pentru o rulare veche (reparse, ștergere, livrare dublă) primește `{ kind: 'stale' }` și nu scrie nimic.
- **Fluxul scrie direct în Postgres** prin Drizzle, fără un port de repository: garanțiile lui sunt proprietăți ale SQL-ului. Porturile din Etapa 1 sunt `ExtractionQueue`, `SourceFileStore` și `Clock`. Testele fluxului rulează pe Postgres real, cu acestea false.
- **Rute noi:** `GET /scripts/:id/reparse-preview` și `GET /scripts/:id/delete-preview` întorc `LossSummary`. Frontend-ul le arată în dialogul de confirmare. `editedLineCount` și `synthesizedCharacterCount` sunt deocamdată 0 (TODO pentru Etapele 3 și 4).
- **Jobul de recuperare** e un job scheduler BullMQ (`script-recovery`), pornit de worker. Intervalul e `SCRIPT_RECOVERY_INTERVAL_MS` (implicit 5 min), iar perioada de grație e `SCRIPT_RECOVERY_GRACE_MS` (implicit 60 s). Coada e idempotentă per rulare, deci un job care încă așteaptă nu se dublează. Un job eșuat definitiv fără să fi anunțat fluxul (de exemplu după un stall) trece scriptul în `failed`.
- **Upload cu Redis căzut:** scriptul rămâne în `extracting`, iar recuperarea îl pune în coadă. Așa dispare vechiul TODO cu outbox.
- **Joburile vechi din coadă** (fără `runId`) sunt respinse ca `UnrecoverableError`. Scripturile lor, migrate în `extracting`, sunt repuse în coadă de recuperare.

**Întrebare deschisă (Andrei):** condiția `WHERE stage = … AND run_id = …` folosește starea citită de comandă pe server. Protejează două cereri simultane, dar nu și un dispozitiv cu ecran vechi: un reparse confirmat pe baza unui rezumat vechi trece dacă scriptul s-a schimbat între timp. Varianta strictă: clientul trimite etapa văzută (`expectedStage`) și primește 409 dacă nu se mai potrivește.

### Etapa 2: workspace-uri, roluri, invitații

- tabelele `workspaces`, `workspace_members` (un singur `editor`, garantat de un index unic parțial) și `invitations` (token, e-mail, expirare);
- migrare: fiecare utilizator existent primește un workspace personal în care e editor, iar scripturile primesc `workspace_id`;
- `authorize` în fiecare comandă, iar citirile sunt limitate la membrii workspace-ului;
- transferul atomic al rolului de editor;
- `EmailSender` cu un adaptor SMTP (nodemailer) și Mailpit în `docker-compose`;
- în frontend: alegerea workspace-ului, lista de membri, invitarea și acceptarea invitației;
- teste: matricea de permisiuni, invariantul „un singur editor”, invitații expirate sau refolosite.

**Făcut 2026-11-03.** Decizii luate cu Andrei la pornire și detalii de implementare:

- **Acceptarea cere contul cu exact adresa invitată.** Un link trimis mai departe nu dă acces altcuiva (403 cu adresa corectă în mesaj). Linkul merge o singură dată: o invitație acceptată, anulată sau expirată primește 409. Rândul invitației e blocat la acceptare, deci două click-uri simultane nu reușesc amândouă.
- **E-mailul pleacă direct din request** (nodemailer, timeout-uri scurte), nu printr-un job BullMQ. Dacă SMTP pică, invitația rămâne salvată, răspunsul spune `emailSent: false`, iar editorul are „Resend”. Tokenul nu se stochează (doar SHA-256), deci retrimiterea emite un link nou și îl anulează pe cel vechi. O invitație nouă către aceeași adresă o anulează pe cea deschisă (index unic parțial).
- **Migrarea `0005` șterge scripturile anonime** (`user_id IS NULL`). Nu exista niciunul, iar PDF-urile lor ar fi rămas în `UPLOAD_DIR`. Verificată pe o copie a bazei de dev: fiecare utilizator are un workspace personal („<nume>'s workspace”) în care e editor, iar scripturile au trecut în workspace-ul celui care le-a încărcat. `scripts.user_id` rămâne ca „cine a încărcat”.
- **Operații pe membri:** creare workspace (oricine, devine editor), redenumire, scoaterea unui membru, anularea unei invitații și transferul rolului de editor. **Membrul nu poate pleca singur** (Andrei n-a inclus asta acum). Editorul nu se poate scoate pe sine, doar transferă rolul.
- **Un singur editor:** index unic parțial `WHERE role = 'editor'`. „Cel puțin unul” e garantat de cod: editorul nu poate fi scos. Transferul blochează rândul workspace-ului, verifică rolul în tranzacție, retrogradează apoi promovează. Două transferuri simultane: unul trece, celălalt primește 403.
- **Permisiunile:** matricea `ROLE_PERMISSIONS` și `can()` sunt în `shared/src/workspace.ts`. Backend-ul o aplică prin `flows/authorization.ts`: cine nu e membru primește 404 (ca un id inexistent), un membru fără permisiune primește 403. Rolul se citește mereu din baza de date, nu din token.
- **`confirmGender` e mutat acum în `ScriptProductionFlow`** (doar autorizarea `script:edit`), ca PATCH-ul de gen să treacă prin `authorize`. Limitarea la `in_review` și `ready` rămâne pentru Etapa 3.
- **Rute:** `GET /scripts?workspaceId=` (obligatoriu), `POST /scripts/upload?workspaceId=`, `/workspaces` (listă, creare, redenumire, membri, `POST /:id/editor`, invitații cu `resend` și anulare) și `/invitations/:token` (previzualizare publică, `POST …/accept` autentificat). Un upload refuzat își șterge fișierul.
- **Configurare nouă:** `APP_BASE_URL` (linkul din e-mail), `SMTP_URL`, `MAIL_FROM` și `INVITATION_TTL_HOURS` (implicit 168). Mailpit e în `docker-compose` (`axllent/mailpit:v1`, SMTP 1025, inbox pe http://localhost:8025).
- **Frontend:** `workspaceStore` (alegerea salvată în `localStorage`, `canIn`/`canHere` după aceeași matrice), comutator de workspace și „New workspace” pe Home, pagina `/workspaces/:id` (membri, invitare, invitații deschise, „Make editor”, „Remove”) și pagina publică `/invitations/:token`, care trimite la login cu adresa precompletată. Membrii nu văd upload, reparse, delete, iar genul e dezactivat în repetiție. Vocile locale de repetiție rămân la alegerea fiecăruia.

**De făcut de Andrei:** reconstruiește imaginile `backend` și `worker`, pornește `mailpit` și rulează `pnpm db:migrate` pe baza de dev. Ecranele noi n-au fost încercate manual în browser.

### Etapa 3: review

- corecții automate de OCR la extragere: `ǎ` și `ā` devin `ă`, iar `ş` și `ţ` cu sedilă devin `ș` și `ț` cu virgulă;
- `reviseLine`, permis doar editorului și doar în `in_review` sau `ready`, plus starea audio per replică;
- `confirmGender` și `castVoice` salvate pe server. Azi vocile stau doar în memoria aplicației, în `voiceByCharacterId` din `rehearsalStore`;
- ecranul de review: toate replicile, filtre (replici suspecte, pe personaj, pe scenă), editare directă și panoul de gen și voce.

### Etapa 4: Azure și generare

- **În serviciul TTS:** providerul `azure` (escape SSML, voci filtrate pe `TTS_AZURE_VOICES`, ieșire WAV 24 kHz), maparea erorilor (401 înseamnă provider indisponibil; la 429 se respectă `Retry-After`), un limitator local sub limita F0, iar serviciul merge normal fără cheie;
- **stocare audio permanentă după conținut**, într-un volum separat de cache-ul LRU de 512 MB din `tts-service/app/cache.py`, plus un job de curățare a fișierelor nefolosite;
- **în backend:**
  - `SpeechAccountResolver` (acum mereu `global`);
  - `UsageLedger` per `accountId` și lună, cu rezervare atomică și eliberare la eșec, buget implicit 450.000;
  - `estimateSynthesis`, `previewVoice` și `submitForSynthesis`;
- **jobul de generare:** procesează doar replicile `none` și `stale` cu voce Azure, raportează progresul și durata estimată (din ritmul real), trece în `paused_budget` la epuizare și răspunde la `stopSynthesis`;
- **repetiția** redă audio-ul stocat și cade pe vocile offline pentru replicile lipsă;
- **teste:**
  - automate, cu Azure simulat: SSML și escape-ul (`&`, `<`, diacritice cu sedilă), parsarea vocilor, erorile, concurența bugetului, cache-ul care nu consumă caractere;
  - manual, cu cheia reală, sub ~2.000 de caractere: contorul comparat cu metrica „Synthesized Characters” din portalul Azure, plus un buget setat artificial la ~300 de caractere, ca să vedem epuizarea fără să atingem cota reală.

### Etapa 5: finalizare

- `.env.example` și README;
- curățarea codului vechi bazat pe `status`;
- o parcurgere completă pe Salem: upload, review, submit, apoi repetiție cu Alina pe rolurile feminine (Abigail, Tituba, Susanna).

## Constrângeri care se aplică peste tot

- **`AGENTS.md`:**
  - tipurile și schemele comune stau doar în `packages/shared`;
  - backend-ul validează cu `fastify-type-provider-zod`;
  - operațiile grele rulează în BullMQ;
  - store-urile Pinia, nu componentele, țin starea;
  - TypeScript strict.
- **Paritate între platforme:** nimic nu depinde de ce e instalat pe dispozitiv, iar motoarele terțe stau în spatele unor provideri înlocuibili.
