// The evaluation set for search by meaning across Swedish, English and Danish (#67): made-up mail
// in all three, on twenty subjects of three messages each and a Danish fourth on twelve of them,
// and questions in the three languages, each with the messages it is asking for. Every message's subject is one of the twenty, so a hit on another
// subject is unrelated. The three misses that #62's real-mail check found are here as made-up
// equivalents: "kvitto" for English receipts, "wine tasting" for a Swedish invitation, and "resa
// till Lissabon" for a terse English booking. Each message is a thread of its own.
import type { IndexedMessage } from "../src/search-engine.ts";
import type { Language } from "../src/languages.ts";

const me = { name: "Nicklas", address: "nicklas@ekenstam.example" };

const footer = "You receive this email because you have an account with us. Manage your preferences or unsubscribe at any time.";
const bundtekst = "Du får denne mail, fordi du har en konto hos os. Du kan ændre dine indstillinger eller afmelde dig når som helst.";
const sidfot = "Du får det här mejlet eftersom du har ett konto hos oss. Hantera dina inställningar eller avsluta prenumerationen när du vill.";

interface Written {
  id: string;
  /** The language it is written in. */
  language: Language;
  sender: string;
  subject: string;
  text: string;
}

interface Subject {
  name: string;
  messages: Written[];
}

const subjects: Subject[] = [
  {
    name: "receipts",
    messages: [
      { id: "kvittering-cykel", language: "Danish", sender: "Cykelhuset <kvittering@cykelhuset.example>", subject: "Din kvittering fra Cykelhuset", text: `Tak for dit køb! Ordre 30217 den 1. oktober. Cykellygte 249 kr. og en ny slange 89 kr. I alt 338 kr., betalt med kort. Gem kvitteringen, hvis du vil bytte varen. ${bundtekst}` },
      { id: "receipt-coffee", language: "English", sender: "Northwind Coffee <receipts@northwind.example>", subject: "Your receipt from Northwind Coffee", text: `Thanks for stopping by. Order 4471, 2 Oct 2026, 08:14. 1 flat white 52.00 SEK, 1 cardamom bun 38.00 SEK. Total 90.00 SEK, paid with Visa ending 4417. ${footer}` },
      { id: "receipt-app", language: "English", sender: "Orchard Store <no-reply@orchard.example>", subject: "Receipt for your purchase", text: `Order ID MX8Q2K7. Weatherly Pro, yearly subscription, 199.00 SEK incl. VAT. Billed to the card on file. Keep this receipt for your records. ${footer}` },
      { id: "kvitto-apotek", language: "Swedish", sender: "Apotek Linnea <kvitto@apoteklinnea.example>", subject: "Ditt kvitto från Apotek Linnea", text: `Tack för ditt köp! Köp nr 88213 den 29 september. Halstabletter 49 kr, plåster 35 kr. Totalt 84 kr, varav moms 9 kr. Betalt med kort. ${sidfot}` },
    ],
  },
  {
    name: "wine tasting",
    messages: [
      { id: "vinsmagning", language: "Danish", sender: "Vinbaren Nyhavn <info@vinbarennyhavn.example>", subject: "Kom til vinsmagning i oktober", text: `Hej! Vi holder vinsmagning torsdag den 30. oktober klokken 19, hvor vi smager seks vine fra Bourgogne med lidt ost til. Det koster 350 kr. Tilmeld dig ved at svare på denne mail. ${bundtekst}` },
      { id: "vinprovning-inbjudan", language: "Swedish", sender: "Vinkällaren Bacchus <info@bacchus.example>", subject: "Inbjudan: höstens provning", text: `Hej! Välkommen till en kväll i källaren den 17 oktober klockan 18. Vi provar sex viner från Piemonte, Barolo och Barbaresco, tillsammans med ostar. Begränsat antal platser, 450 kr per person. Anmäl dig genom att svara på det här mejlet. ${sidfot}` },
      { id: "wine-club", language: "English", sender: "Cellar Door Club <events@cellardoor.example>", subject: "Members' evening: Rhône reds", text: `Join us on Thursday 23 October at 7 pm for a guided tasting of five Rhône reds, from Côtes du Rhône to Châteauneuf-du-Pape. Members free, guests 200 SEK. Reply to reserve a seat. ${footer}` },
      { id: "vin-leverans", language: "Swedish", sender: "Vinkällaren Bacchus <order@bacchus.example>", subject: "Din vinlåda är på väg", text: `Tack för din beställning av höstens vinlåda med sex flaskor från Toscana. Den levereras till ditt ombud på torsdag. Legitimation krävs vid uthämtning, du måste vara 20 år. ${sidfot}` },
    ],
  },
  {
    name: "flight to Lisbon",
    messages: [
      { id: "lissabon-tog", language: "Danish", sender: "Rejsebureauet Sydpå <rejser@sydpaa.example>", subject: "Din rejse til Lissabon", text: "Hej Nicklas! Her er din rejseplan: fly fra København til Lissabon den 14. november og hjem den 18. november. Husk pas og at tjekke ind online et døgn før." },
      { id: "lisbon-booking", language: "English", sender: "Atlantica Air <booking@atlantica.example>", subject: "Your booking", text: "Atlantica itinerary ARN-LIS, 14 November. Departure 06:55, seat 21C. Check in opens 36 hours before." },
      { id: "lisbon-checkin", language: "English", sender: "Atlantica Air <checkin@atlantica.example>", subject: "Check in now for Lisbon", text: `Your flight AT 512 from Stockholm Arlanda to Lisbon leaves on 14 November at 06:55. Check in online and get your boarding pass on your phone. Cabin bag up to 8 kg. ${footer}` },
      { id: "lissabon-hotell", language: "Swedish", sender: "Hotell Alfama <reservas@alfama.example>", subject: "Bokningsbekräftelse Lissabon", text: "Hej Nicklas! Tack för din bokning på Hotell Alfama i Lissabon, 14 till 18 november, ett dubbelrum med frukost. Incheckning från klockan 15. Vi ser fram emot ditt besök." },
    ],
  },
  {
    name: "bills to pay",
    messages: [
      { id: "regning-vand", language: "Danish", sender: "Vandselskabet <regning@vandselskabet.example>", subject: "Din regning for vand", text: `Hej! Din regning for vand for tredje kvartal er klar. Beløbet er 1.140 kr. og skal betales senest den 31. oktober. Du kan betale med MobilePay eller i din bank. ${bundtekst}` },
      { id: "faktura-el", language: "Swedish", sender: "Nordström Energi <faktura@nordstromenergi.example>", subject: "Din faktura för september", text: `Hej! Nu finns din elfaktura för september. Att betala: 1 284 kr senast den 31 oktober. Betala med OCR 7781 2290 1145 till bankgiro 5521-0042. ${sidfot}` },
      { id: "invoice-hosting", language: "English", sender: "Billing <billing@hostly.example>", subject: "Invoice 2026-1042 is due", text: `Your invoice for October web hosting is ready. Amount due 129.00 SEK by 20 October. Pay by card in your dashboard to avoid interruption. ${footer}` },
      { id: "faktura-bredband", language: "Swedish", sender: "Fiberbolaget <kundservice@fiberbolaget.example>", subject: "Påminnelse: obetald faktura", text: "Vi har inte fått betalt för din bredbandsfaktura för augusti, 399 kr. Betala senast inom tio dagar för att undvika påminnelseavgift och avstängning." },
    ],
  },
  {
    name: "dentist",
    messages: [
      { id: "tandlaege-tid", language: "Danish", sender: "Tandlægerne på Østerbro <tid@tandost.example>", subject: "Påmindelse om din tid", text: "Hej! Vi minder dig om din tid til eftersyn og tandrensning hos tandlægen onsdag den 12. november klokken 9.30. Har du ikke mulighed for at komme, så ring til os." },
      { id: "tandlakare-kallelse", language: "Swedish", sender: "Folktandvården <kallelse@folktandvarden.example>", subject: "Kallelse till undersökning", text: "Välkommen på undersökning hos tandhygienisten tisdag 9 december klockan 08:30. Om du inte kan komma, avboka senast 24 timmar innan, annars debiteras en avgift." },
      { id: "dental-reminder", language: "English", sender: "Smile Clinic <appointments@smileclinic.example>", subject: "Appointment reminder", text: "This is a reminder of your check-up and cleaning with Dr. Patel on Monday 3 November at 10:15. Please arrive ten minutes early. Reply C to cancel." },
      { id: "tandlakare-recall", language: "Swedish", sender: "Tandläkarna i Vasastan <info@tandvasa.example>", subject: "Dags för ett besök?", text: "Det har gått två år sedan ditt senaste besök hos oss. Boka en tid för undersökning och tandstensborttagning online eller ring oss." },
    ],
  },
  {
    name: "jobs",
    messages: [
      { id: "jobtilbud", language: "Danish", sender: "Jobnet Pro <job@jobnetpro.example>", subject: "Nye job til dig som udvikler", text: `Vi har fundet 6 nye job, der passer til din profil: Senior udvikler hos Nordlys Data i København og Teknisk chef hos Havn Software i Aarhus. Søg med et klik. ${bundtekst}` },
      { id: "job-alert", language: "English", sender: "Workwire Jobs <jobs@workwire.example>", subject: "8 new jobs for Senior Backend Engineer", text: `New jobs matching your alert: Senior Backend Engineer at Lumen Payments, Stockholm (hybrid). Staff Engineer at Fjord Analytics, remote. Apply with your profile in one click. ${footer}` },
      { id: "rekryterare", language: "Swedish", sender: "Anna Berg <anna@talentpartner.example>", subject: "Spännande roll som teknisk chef", text: "Hej Nicklas! Jag rekryterar en teknisk chef till ett växande fintechbolag i Stockholm och tror att din profil passar bra. Har du tid för ett kort samtal nästa vecka?" },
      { id: "job-interview", language: "English", sender: "Fjord Analytics <talent@fjord.example>", subject: "Interview for the Staff Engineer role", text: "Thanks for applying. We would like to invite you to a first interview with our engineering manager. Please pick a time that suits you from the link below." },
    ],
  },
  {
    name: "hotel points",
    messages: [
      { id: "points-statement", language: "English", sender: "Meridian Rewards <rewards@meridian.example>", subject: "Your October points statement", text: `You have 48,250 Meridian Rewards points. You earned 3,100 points on your stay in Copenhagen. 6,000 points expire on 31 December, redeem them for a free night. ${footer}` },
      { id: "bonuspoang-hotell", language: "Swedish", sender: "Nordhotell <klubb@nordhotell.example>", subject: "Dina bonuspoäng", text: `Hej Nicklas! Du har nu 12 400 bonuspoäng i Nordhotell Klubb. Använd dem till en gratis natt på något av våra hotell, eller uppgradera till Silvernivå. ${sidfot}` },
      { id: "points-elite", language: "English", sender: "Meridian Rewards <rewards@meridian.example>", subject: "You've reached Gold status", text: "Congratulations, your stays this year earned you Gold status: late checkout, room upgrades when available and 50% bonus points on every night." },
    ],
  },
  {
    name: "domains",
    messages: [
      { id: "domain-renewal", language: "English", sender: "NameHarbor <renewals@nameharbor.example>", subject: "ekenstam.example expires in 30 days", text: `Your domain registration for ekenstam.example expires on 5 November. Auto-renew is off. Renew now for 1 year at 15.99 USD to keep your website and email working. ${footer}` },
      { id: "doman-registrerad", language: "Swedish", sender: "Svenska Domäner <support@svdom.example>", subject: "Din domän är registrerad", text: "Grattis! Domänen nille.example är nu registrerad i ditt namn i ett år. Du kan peka om namnservrar och lägga till DNS-poster i kontrollpanelen." },
      { id: "domain-transfer", language: "English", sender: "NameHarbor <transfers@nameharbor.example>", subject: "Transfer request for duva.example", text: "We received a request to transfer duva.example to another registrar. If you did not ask for this, reject the transfer within five days." },
    ],
  },
  {
    name: "parcels",
    messages: [
      { id: "pakke-afhentning", language: "Danish", sender: "GLS Danmark <besked@gls.example>", subject: "Din pakke er klar til afhentning", text: "Din pakke fra Boligshop er leveret til pakkeshoppen i Netto på Nørrebrogade. Husk at have din kode med, når du henter den. Pakken ligger der i 7 dage." },
      { id: "paket-ombud", language: "Swedish", sender: "PostNord <notification@postnord.example>", subject: "Ditt paket kan hämtas", text: "Ditt paket från Stilmode finns nu att hämta hos ICA Nära Odenplan. Ta med legitimation och visa koden 4471 i appen. Paketet ligger kvar i 7 dagar." },
      { id: "package-shipped", language: "English", sender: "Gadgetry <orders@gadgetry.example>", subject: "Your order has shipped", text: `Good news, order 55120 is on its way. Tracking number DHL 3381 9920 1145. Estimated delivery Wednesday 8 October. ${footer}` },
      { id: "package-delayed", language: "English", sender: "Gadgetry <orders@gadgetry.example>", subject: "Delivery update for order 55120", text: "Your package is delayed by one day because of high volumes. It will now arrive on Thursday. We are sorry for the wait." },
    ],
  },
  {
    name: "sign-in security",
    messages: [
      { id: "adgangskode-nulstil", language: "Danish", sender: "Lommebogen <sikkerhed@lommebogen.example>", subject: "Nulstil din adgangskode", text: "Vi har fået en anmodning om at nulstille adgangskoden til din konto. Klik på linket inden for en time for at vælge en ny. Hvis det ikke var dig, kan du se bort fra denne mail." },
      { id: "password-reset", language: "English", sender: "Kitebox <security@kitebox.example>", subject: "Reset your password", text: "Someone asked to reset the password for your Kitebox account. Click the link below within one hour to choose a new one. If it wasn't you, ignore this email." },
      { id: "ny-inloggning", language: "Swedish", sender: "Banken Väst <sakerhet@bankenvast.example>", subject: "Ny inloggning på ditt konto", text: "Vi har upptäckt en inloggning från en ny enhet, Chrome på Linux i Göteborg. Om det var du behöver du inte göra något. Annars, byt lösenord direkt och kontakta oss." },
      { id: "two-factor-code", language: "English", sender: "Kitebox <security@kitebox.example>", subject: "Your verification code", text: "Your Kitebox verification code is 448 120. It expires in ten minutes. Never share this code with anyone." },
    ],
  },
  {
    name: "school",
    messages: [
      { id: "foraldramote", language: "Swedish", sender: "Vasaskolan <info@vasaskolan.example>", subject: "Föräldramöte i klass 3B", text: "Välkomna på föräldramöte torsdag 16 oktober klockan 18 i klassrummet. Vi pratar om höstens utflykter, läxor och skolfotograferingen. Fika finns." },
      { id: "school-trip", language: "English", sender: "Riverside International School <office@riverside.example>", subject: "Year 4 trip to the science museum", text: "Year 4 will visit the science museum on Friday 24 October. Please sign the consent form and send a packed lunch. The bus leaves at 8:30." },
      { id: "skolfoto", language: "Swedish", sender: "Vasaskolan <info@vasaskolan.example>", subject: "Skolfotografering nästa vecka", text: "På tisdag kommer fotografen till skolan. Barnen fotograferas klassvis och enskilt. Beställ bilderna i webbshoppen senast två veckor efter." },
    ],
  },
  {
    name: "taxes",
    messages: [
      { id: "skat-aarsopgoerelse", language: "Danish", sender: "Skattestyrelsen <noreply@skat.example>", subject: "Din årsopgørelse er klar", text: "Din årsopgørelse for 2025 er nu klar. Du skal have 2.315 kr. tilbage i skat, som vi udbetaler til din NemKonto. Se den og ret den, hvis noget ikke passer." },
      { id: "skatteverket-deklaration", language: "Swedish", sender: "Skatteverket <noreply@skatteverket.example>", subject: "Din deklaration är inlämnad", text: "Vi har tagit emot din inkomstdeklaration för inkomståret 2025. Du får besked om slutlig skatt i juni. Om du får skatt tillbaka betalas den ut till ditt konto." },
      { id: "tax-return", language: "English", sender: "Ledgerly <help@ledgerly.example>", subject: "Your tax return is ready to file", text: `We prepared your 2025 tax return from your bookkeeping. Review the figures for income and deductions, then file it with one click before the deadline. ${footer}` },
      { id: "kvarskatt", language: "Swedish", sender: "Skatteverket <noreply@skatteverket.example>", subject: "Kvarskatt att betala", text: "Enligt ditt slutskattebesked har du kvarskatt att betala, 3 412 kr. Betala till ditt skattekonto senast den 12 november för att undvika ränta." },
    ],
  },
  {
    name: "car",
    messages: [
      { id: "bilservice", language: "Swedish", sender: "Verkstan på Söder <bokning@verkstan.example>", subject: "Din bil är klar", text: "Hej! Servicen på din Volvo V60 är klar. Vi har bytt olja, filter och torkarblad. Bilen kan hämtas efter klockan 15 i dag. Att betala 3 890 kr." },
      { id: "car-inspection", language: "English", sender: "AutoCheck <reminders@autocheck.example>", subject: "Time for your annual vehicle inspection", text: "Your car ABC 123 is due for its annual inspection before 30 November. Book a time at a station near you. Driving without a valid inspection can mean a fine." },
      { id: "dackbyte", language: "Swedish", sender: "Däckhotellet <info@dackhotellet.example>", subject: "Dags att byta till vinterdäck", text: "Snart blir det halt på vägarna. Boka tid för hjulskifte så monterar vi dina vinterdäck från däckhotellet. Från 495 kr." },
    ],
  },
  {
    name: "concert tickets",
    messages: [
      { id: "koncert-billetter", language: "Danish", sender: "Billetlugen <ordre@billetlugen.example>", subject: "Dine billetter til koncerten", text: "Tak for din bestilling! Her er dine to billetter til koncerten med Tina Dickow i Royal Arena lørdag den 22. november. Dørene åbner klokken 19. Vis billetterne på din telefon." },
      { id: "concert-tickets", language: "English", sender: "TicketHall <orders@tickethall.example>", subject: "Your tickets for The Lumineers", text: `Your e-tickets for The Lumineers at Avicii Arena, Saturday 15 November, doors at 18:00. Section 104, row 12, seats 7 and 8. Show the QR code at the entrance. ${footer}` },
      { id: "biljetter-konsert", language: "Swedish", sender: "Biljettkassan <order@biljettkassan.example>", subject: "Dina biljetter till Håkan Hellström", text: "Tack för ditt köp! Här är dina två biljetter till Håkan Hellström på Ullevi den 6 juni. Insläpp från klockan 17. Visa biljetterna i mobilen vid entrén." },
      { id: "concert-presale", language: "English", sender: "TicketHall <news@tickethall.example>", subject: "Presale starts Friday", text: "Fans get early access: the presale for Phoebe Bridgers at Annexet opens Friday at 10:00. Use the code below to buy before general sale." },
    ],
  },
  {
    name: "rent and housing",
    messages: [
      { id: "husleje", language: "Danish", sender: "Boligforeningen Lyset <husleje@lyset.example>", subject: "Husleje for november", text: "Hej! Husk at betale husleje for november, 7.250 kr., senest den 1. november. Beløbet trækkes automatisk, hvis du er tilmeldt Betalingsservice." },
      { id: "hyresavi", language: "Swedish", sender: "Brf Linden <avgift@brflinden.example>", subject: "Avgiftsavi för november", text: "Här är din avi för månadsavgiften i november, 4 650 kr, inklusive el och bredband. Betala senast den sista oktober till bankgiro 123-4567." },
      { id: "lease-renewal", language: "English", sender: "Harbor Lettings <tenancy@harborlettings.example>", subject: "Your lease renewal", text: "Your tenancy agreement for the flat at 12 Quay Street ends on 31 January. The landlord offers a new 12 month lease at the same monthly rent. Sign by 15 December." },
      { id: "vattenavstangning", language: "Swedish", sender: "Brf Linden <styrelsen@brflinden.example>", subject: "Vattnet stängs av på onsdag", text: "På grund av stambyte i trapphus B stängs vattnet av onsdag mellan 9 och 14. Spara gärna vatten i förväg. Styrelsen ber om ursäkt för besväret." },
    ],
  },
  {
    name: "gym",
    messages: [
      { id: "gym-membership", language: "English", sender: "Ironworks Gym <members@ironworks.example>", subject: "Your membership renews next week", text: `Your monthly Ironworks membership renews on 10 October for 449 SEK. Freeze or cancel your membership in the app before then if you need to. ${footer}` },
      { id: "gym-passbokning", language: "Swedish", sender: "Friskis Fram <bokning@friskisfram.example>", subject: "Du är bokad på spinning", text: "Du är bokad på spinning 45 min, onsdag klockan 06:30 i sal 2. Avboka senast två timmar innan om du inte kan komma, annars räknas passet." },
      { id: "gym-classes", language: "English", sender: "Ironworks Gym <members@ironworks.example>", subject: "New yoga and HIIT classes", text: "This autumn we are adding morning yoga and evening HIIT classes. Book your spot in the app, classes fill up fast." },
    ],
  },
  {
    name: "parties",
    messages: [
      { id: "kalas-inbjudan", language: "Swedish", sender: "Sara Lund <sara.lund@mejl.example>", subject: "Välkommen på Elsas kalas!", text: "Hej! Elsa fyller sju år och vi vill bjuda in till kalas lördag 25 oktober klockan 14 till 16 hemma hos oss. Det blir tårta och skattjakt. OSA senast onsdag." },
      { id: "birthday-party", language: "English", sender: "Tom Hughes <tom@hughes.example>", subject: "My 40th birthday party", text: "I'm turning 40 and celebrating with dinner and drinks at Bar Central on Saturday 8 November from 7 pm. Partners welcome. Let me know if you can make it!" },
      { id: "fodelsedag-middag", language: "Swedish", sender: "Mamma <mamma@ekenstam.example>", subject: "Pappa fyller 70", text: "Vi firar pappas 70-årsdag med middag på restaurang Sjöboden söndag 2 november. Kommer du och barnen? Säg till så bokar jag bord." },
    ],
  },
  {
    name: "bank cards",
    messages: [
      { id: "nytt-bankkort", language: "Swedish", sender: "Banken Väst <kort@bankenvast.example>", subject: "Ditt nya kort är på väg", text: "Ditt nuvarande bankkort går ut i november, så vi har skickat ett nytt kort till din folkbokföringsadress. Aktivera det i appen när det kommer." },
      { id: "card-expiring", language: "English", sender: "Hostly Billing <billing@hostly.example>", subject: "Your card on file is expiring", text: `The Visa card ending 4417 that pays for your subscription expires this month. Update your payment details to avoid an interruption. ${footer}` },
      { id: "card-blocked", language: "Swedish", sender: "Banken Väst <kort@bankenvast.example>", subject: "Vi har spärrat ditt kort", text: "Vi har spärrat ditt kort efter misstänkta köp i en utländsk webbutik. Ring oss på 0771-123 456 så hjälper vi dig att beställa ett nytt." },
    ],
  },
  {
    name: "recipes",
    messages: [
      { id: "recipe-newsletter", language: "English", sender: "Weeknight Kitchen <hello@weeknightkitchen.example>", subject: "5 cozy soups for October", text: `This week: roasted pumpkin soup, Tuscan bean stew, chicken noodle soup, French onion soup and a spicy lentil soup. Each takes under an hour. ${footer}` },
      { id: "recept-veckans", language: "Swedish", sender: "Matglad <recept@matglad.example>", subject: "Veckans middagstips", text: `Den här veckan lagar vi kanelbullar, krämig svampsoppa och ugnsbakad lax med dillpotatis. Alla recept tar under en timme och passar hela familjen. ${sidfot}` },
      { id: "recipe-baking", language: "English", sender: "Weeknight Kitchen <hello@weeknightkitchen.example>", subject: "The only sourdough guide you need", text: "Feed your starter, mix, fold, shape and bake: our step by step sourdough guide, with a printable timetable for weekend baking." },
    ],
  },
  {
    name: "insurance",
    messages: [
      { id: "forsikring-indbo", language: "Danish", sender: "Tryghed Forsikring <kunde@tryghed.example>", subject: "Din indboforsikring fornyes", text: "Din indboforsikring fornyes den 1. januar. Prisen bliver 2.190 kr. om året. Log ind for at se din police eller tilføje en ny genstand til forsikringen." },
      { id: "hemforsakring", language: "Swedish", sender: "Trygga Försäkringar <kund@trygga.example>", subject: "Din hemförsäkring förnyas", text: "Din hemförsäkring förnyas den 1 december. Premien blir 2 340 kr per år. Logga in för att se ditt försäkringsbrev eller lägga till drulle." },
      { id: "travel-insurance", language: "English", sender: "Coverwise <policies@coverwise.example>", subject: "Your travel insurance policy", text: "Your travel insurance policy CW-882-114 covers trips up to 45 days, medical costs and lost luggage. Keep this policy document with you when you travel." },
      { id: "forsakring-skada", language: "Swedish", sender: "Trygga Försäkringar <skador@trygga.example>", subject: "Vi har tagit emot din skadeanmälan", text: "Tack för din skadeanmälan om vattenskadan i badrummet. En handläggare kontaktar dig inom tre arbetsdagar. Spara kvitton på det som skadats." },
    ],
  },
];

/** A question asked of the evaluation mailbox, in a language, with the messages it is asking for. */
export interface Question {
  text: string;
  language: Language;
  expected: string[];
  /** The subject it asks about: a hit on another subject is unrelated. */
  subject: string;
}

/** The question asks for every message on its subject, unless it names the ones it asks for. */
const ask = (subject: string, language: Language, text: string, expected?: string[]): Question => ({
  text,
  language,
  subject,
  expected: expected ?? subjects.find(({ name }) => name === subject)!.messages.map(({ id }) => id),
});

export const questions: Question[] = [
  ask("receipts", "Swedish", "kvitto"),
  ask("receipts", "English", "receipt"),
  ask("receipts", "Swedish", "kvitton på det jag har köpt"),
  ask("wine tasting", "English", "wine tasting", ["vinprovning-inbjudan", "wine-club", "vinsmagning"]),
  ask("wine tasting", "Swedish", "vinprovning", ["vinprovning-inbjudan", "wine-club", "vinsmagning"]),
  ask("wine tasting", "English", "invitation to taste Italian wines", ["vinprovning-inbjudan"]),
  ask("flight to Lisbon", "Swedish", "resa till Lissabon"),
  ask("flight to Lisbon", "English", "flight to Lisbon", ["lisbon-booking", "lisbon-checkin"]),
  ask("flight to Lisbon", "English", "hotel in Lisbon", ["lissabon-hotell"]),
  ask("bills to pay", "English", "invoice to pay"),
  ask("bills to pay", "Swedish", "räkning att betala"),
  ask("bills to pay", "English", "unpaid bill"),
  ask("dentist", "English", "dentist"),
  ask("dentist", "Swedish", "tandläkare"),
  ask("dentist", "English", "when should I get my teeth checked"),
  ask("jobs", "Swedish", "jobberbjudanden"),
  ask("jobs", "English", "job offers"),
  ask("jobs", "English", "recruiter reaching out about a role"),
  ask("hotel points", "English", "hotel loyalty points"),
  ask("hotel points", "Swedish", "bonuspoäng"),
  ask("hotel points", "Swedish", "hur många poäng har jag på hotellet"),
  ask("domains", "English", "domain registration"),
  ask("domains", "Swedish", "domännamn"),
  ask("domains", "Swedish", "förnya domänen innan den går ut", ["domain-renewal"]),
  ask("parcels", "Swedish", "paket"),
  ask("parcels", "English", "parcel delivery"),
  ask("parcels", "English", "where can I pick up my package", ["paket-ombud"]),
  ask("sign-in security", "English", "password"),
  ask("sign-in security", "Swedish", "lösenord"),
  ask("sign-in security", "Swedish", "någon har loggat in på mitt konto", ["ny-inloggning"]),
  ask("school", "Swedish", "skolan"),
  ask("school", "English", "school"),
  ask("school", "English", "parents meeting at school", ["foraldramote"]),
  ask("taxes", "English", "taxes"),
  ask("taxes", "Swedish", "deklaration"),
  ask("taxes", "English", "how much tax do I owe", ["kvarskatt"]),
  ask("car", "English", "car service"),
  ask("car", "Swedish", "bilbesiktning", ["car-inspection"]),
  ask("car", "English", "winter tyres", ["dackbyte"]),
  ask("concert tickets", "English", "concert tickets"),
  ask("concert tickets", "Swedish", "konsertbiljetter"),
  ask("concert tickets", "Swedish", "biljetter till konserten i november", ["concert-tickets"]),
  ask("rent and housing", "English", "rent"),
  ask("rent and housing", "Swedish", "hyreskontrakt", ["lease-renewal"]),
  ask("rent and housing", "English", "water will be shut off", ["vattenavstangning"]),
  ask("gym", "English", "gym"),
  ask("gym", "Swedish", "gymmet"),
  ask("gym", "English", "booked a spin class", ["gym-passbokning"]),
  ask("parties", "English", "birthday party"),
  ask("parties", "Swedish", "födelsedag"),
  ask("parties", "English", "children's party invitation", ["kalas-inbjudan"]),
  ask("bank cards", "English", "new bank card", ["nytt-bankkort"]),
  ask("bank cards", "Swedish", "kortet går ut", ["nytt-bankkort", "card-expiring"]),
  ask("bank cards", "English", "my card was blocked", ["card-blocked"]),
  ask("recipes", "Swedish", "recept"),
  ask("recipes", "English", "soup recipes", ["recipe-newsletter", "recept-veckans"]),
  ask("recipes", "Swedish", "baka surdegsbröd", ["recipe-baking"]),
  ask("insurance", "English", "insurance"),
  ask("insurance", "Swedish", "försäkring"),
  ask("insurance", "English", "insurance claim for water damage", ["forsakring-skada"]),
  ask("receipts", "Danish", "kvittering"),
  ask("wine tasting", "Danish", "vinsmagning", ["vinprovning-inbjudan", "wine-club", "vinsmagning"]),
  ask("flight to Lisbon", "Danish", "rejse til Lissabon"),
  ask("bills to pay", "Danish", "regninger der skal betales"),
  ask("dentist", "Danish", "tandlæge"),
  ask("jobs", "Danish", "jobtilbud"),
  ask("parcels", "Danish", "hvor kan jeg hente min pakke", ["paket-ombud", "pakke-afhentning"]),
  ask("sign-in security", "Danish", "adgangskode", ["password-reset", "adgangskode-nulstil"]),
  ask("taxes", "Danish", "skat"),
  ask("concert tickets", "Danish", "koncertbilletter"),
  ask("rent and housing", "Danish", "husleje", ["hyresavi", "lease-renewal", "husleje"]),
  ask("insurance", "Danish", "forsikring"),
  ask("hotel points", "Danish", "bonuspoint på hotellet"),
  ask("car", "Danish", "bilen skal til service", ["bilservice", "car-inspection"]),
  ask("recipes", "Danish", "opskrifter på suppe", ["recipe-newsletter", "recept-veckans"]),
];

/** The subject each message is on, by ID. */
export const subjectOf = new Map(subjects.flatMap(({ name, messages }) => messages.map(({ id }) => [id, name])));

/** The language each message is written in, by ID. */
export const languageOf = new Map(subjects.flatMap(({ messages }) => messages.map(({ id, language }) => [id, language])));

const short: Record<Language, string> = { English: "en", Swedish: "sv", Danish: "da" };

/**
 * Recall at 5 of the pairs of a question and a message it asks for, by the question's language and
 * the message's, as "sv-en" for a Swedish question asking for an English message, and unrelated
 * hits in the top 5 per question, from the top 5 a search gives for each question.
 */
export async function measured(topFive: (question: Question) => Promise<string[]>): Promise<Record<string, number>> {
  const pairs = new Map<string, { found: number; all: number }>();
  let unrelated = 0;
  for (const question of questions) {
    const top = await topFive(question);
    for (const expected of question.expected) {
      const key = `${short[question.language]}-${short[languageOf.get(expected)!]}`;
      const pair = pairs.get(key) ?? { found: 0, all: 0 };
      pair.all++;
      if (top.includes(expected)) pair.found++;
      pairs.set(key, pair);
    }
    unrelated += top.filter((message) => subjectOf.get(message) !== question.subject).length;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return { ...Object.fromEntries([...pairs].sort().map(([key, { found, all }]) => [key, round(found / all)])), unrelated: round(unrelated / questions.length) };
}

const received = new Date("2026-10-01T08:00:00Z").getTime();

export const evaluationMailbox: IndexedMessage[] = subjects
  .flatMap(({ messages }) => messages)
  .map(({ id, sender, subject, text }, at) => {
    const [, name, address] = /^(.*) <(.*)>$/.exec(sender)!;
    return { id, thread: id, from: { name: name!, address: address! }, recipients: [me], subject, receivedAt: new Date(received - at * 3_600_000), labels: ["Inbox"], unread: false, attachments: [], hasAttachment: false, text };
  });
