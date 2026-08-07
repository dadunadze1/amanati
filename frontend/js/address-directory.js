"use strict";

const ADDRESS_DIRECTORY = [
  {
    city: "თბილისი",
    districts: [
      {
        name: "საბურთალო",
        streets: [
          "13 ასურელი მამის ქ.",
          "26 მაისის მოედანი",
          "ადამ მიცკევიჩის ქ.",
          "ავთანდილის ქ.",
          "აისის ქ.",
          "აკაკი გელოვანის ქ.",
          "აკაკი კვანტალიანი ქ.",
          "აკაკი კვანტალიანის ქ. (ვაშლიჯვარი)",
          "აკაკი წეეთლის ქ. სოფელი დიღომი",
          "ალ. ჯავახიშვილის ქ.",
          "ალეკო თეთრაშვილის ქუჩა (სოფელი დიღომი)",
          "ალექსანდრე ქუთათელის ქ.",
          "ალექსანდრე ყაზბეგის გამზ.",
          "ალექსანდრე ყაზბეგის ქ, სოფელი დიღომი",
          "ამერიკელების დასახლება",
          "ანა ანტონოვსკაია ქ.",
          "ანდრია რაზმაძის ქ. (ვაკე-საბურთალო)",
          "არქანჯელო ლამბერთის ქ.",
          "არჩილ სულაკაურის ქ.",
          "არჩილ ცაგარელის ქ.",
          "ასმათის ქ.",
          "აქვსენტი მეგრელაძის ქ.",
          "აღმაშენებლის ძეგლის ქვემოთ გვირაბი",
          "აღმაშენებლის ხეივანი",
          "ბაგრატ მესამეს ქ.",
          "ბადრი ჟვანიას ქუჩა (სოფელი დიღმის მიმდებარედ)",
          "ბარონ დე ბაის ქ.",
          "ბახტრიონის ქ. და მიმდებარე უსახელო ქ.",
          "ბერი გობრონის ქ. სოფელი დიღომი",
          "ბერტა ფონ ზუტნერის ქ.",
          "ბექას ქ.",
          "ბობ უოლშის ქ.",
          "ბოლო გაჩერებამდე გზა არჩილ მეფის ქ. დიდი",
          "ბუდაპეშტის ქ.",
          "ბულაჩაურის ქ.",
          "გ. გეხტმანის ქ.",
          "გ. ჩოხელის ქ. (ზურგოვანა)",
          "გ. ციციშვილის ქ.",
          "გაბრიელ ათონელის ქ. სოფელი დიღომი",
          "გიგა ჯაფარიძის ქ.",
          "გივი კვიჭაძის ქ.",
          "გიორგი ბრწყინვალეს ქ. სოფელი დიღომი",
          "გიორგი მიროტაძის ქ. (სპორტის სასახლესთან)",
          "გიორგი სააკაძის მოედანი",
          "გმირთა მოედანი",
          "გმირთა მოედანი - ესტაკადა",
          "გმირთა მოედნის გვირაბები",
          "გოდერძი ჩოხელის ქ. ჩიხები",
          "გორგასლის ქ. სოფელი დიღომი",
          "გრ. ფერაძის ქ.",
          "გრიგოლ ფერაძის ქ.",
          "გულანშარის ქ.",
          "გურამ თოფჩიშვილის გ. სოფელი დიღომი",
          "გურამ ნიჟარაძის ქ.",
          "დავარის ქ.",
          "დავით აღმაშენებლის ქ. სოფელი დიღომი",
          "დავით გამრეკელის ქ. და ჩიხი (ყოფილი კუტუზოვის)",
          "დავით გურამიშვილის ქ. სოფელი დიღომი",
          "დავით მირიანაშვილის ქ. სოფელი დიღომიი",
          "დავით სარაჯიშვილის ქ. სოფელი დიღომი",
          "დელისის I ჩიხი",
          "დელისის II ჩიხი",
          "დელისის III ქ.",
          "დელისის III ჩიხი",
          "დელისის ქ.",
          "დელისის ქ. (საბურთალოს სტადიონთან)",
          "დემეტრე თავდადებულის ქ. დიდი დიღომი",
          "დიდგორის ქ. (სოფელი დიღომი )",
          "დიდი დიღომი I მიკრორაიონი",
          "დიდი დიღომი II მიკრორაიონი",
          "დიდი დიღომი III მიკრორაიონი",
          "დიდი დიღომი IV მიკრორაიონი",
          "დიმიტრი ჩრდილელის I შესახვევი (ქოშიგორა)",
          "დიღმის წყლის ქ.",
          "დიღომი 7",
          "დიღომი 7, 8.",
          "დიღომი 7-ა",
          "ეგრისის ქ. ჩიხებით",
          "ელისაბედ ჩერქეზიშვილის ქ. ვეძისი",
          "ემანუელ აფხაიძის ქ.",
          "ენგურის ქ.",
          "ექვთიმე თაყაიშვილის ქ. სოფელი დიღომი",
          "ვ/ფშაველას I ჩიხი",
          "ვ/ფშაველას გამზ.",
          "ვაზისუბნის ქ.",
          "ვაჟა ფშაველას ქ.",
          "ვაჟა-ფშაველას ქ. სოფელი დიღომი",
          "ვასო გოძიაშვილის I ჩიხი (ვაშლიჯვარი)",
          "ვასო გოძიაშვილის ქ. (ვაშლიჯვარი)",
          "ვასო გოძიაშვილის ქ. II შესახვევი. (ვაშლიჯვარი)",
          "ვახტანგ ბოჭორიშვილის ქ.",
          "ვახტანგ ჩიქოვანის ქ. (ჩიხტახანი)",
          "ვახუშტი ბაგრატიონის ხიდის პანდუსი",
          "ვახუშტის ქ. (ხიდამდე, გოთუას ქუჩის გაგრძელება)",
          "ვიტალი დარასელიას ქ",
          "ვიქტორ ნოზაძის ქ.",
          "ზაზა ფანასკერტელ-ციციშვილის ქ.",
          "ზემო ვეძისის დასახლება",
          "ზემო ვეძისის ქ.",
          "ზოვრეთის ქ.",
          "ზურაბ ჟვანიას მოედანი",
          "თავისუფლების ქ. (ზურგოვანა)",
          "თამარ მეფის გამზირი ხიდიდან კოსტავას 63-დე",
          "თამარ მეფის გამზირი ხიდიდან ცირკის კიბეებამდე",
          "თამარ მეფის პანდუსი",
          "თამარ მეფის ქ. სოფელი დღომი ჩიხებით",
          "თამარ მეფის ხიდი",
          "თეთრი დუქნის ქ. სოფელი დიღომი",
          "თეიმურაზ პირველის ქ.",
          "თინა იოსებიძის ქ.",
          "თინათინ ვირსალაძის ქ.",
          "თინათინ წერეთლის ქ. ვაშლიჯვარი",
          "თინათინის ქ.",
          "თხინვალას გადასახვევ გზამდე. (ონკოლოგიურ",
          "ი. სარიშვილის ქ.",
          "იაკობ რაინგესის ქ.",
          "იან ჰომერის ქ.",
          "იბერი პეტრეს ქ.",
          "იბერის ქუჩის კვეთამდე გზა დემეტრე",
          "იოაკიმეს და ანას ქ. სოფელი დიღომი",
          "იოანე პეტრიწის ქ.",
          "იოველ ქუთათელაძის ქ. (ვაკე-საბურთალო)",
          "იოსებ იმედაშვილის Qქ",
          "იპილიტე ხვიჩიას ქ.",
          "ირაკლი გამყრელიძის ქ.",
          "ირინა ენუქიძეს ქ.",
          "იყალთოს ქ.",
          "კ. გოგიაშვილის ქ.",
          "კატო მელქაძის ქ.",
          "კედარის I ჩიხი",
          "კედარის III გასასვლელი",
          "კედარის IV გასასვლელი",
          "კელასურის ქუჩა",
          "კვირაცხოვლის ქ. სოფელი დიღომი",
          "კონსტანტინე გამსახურდიას გამზ.",
          "კრიატიან სტივენის ქ.",
          "კრისტოფერო კასტელის ქ.",
          "ლავრენტი არდაზიანის ქ.",
          "ლაშა ლაშხია ქ.",
          "ლევან გოთუას ქ.",
          "ლევან რჩეულიშვილის ქ. სოფელი დიღომი",
          "ლვოვის ქ.",
          "ლიხაურის ქ.",
          "ლიხაურის ქ. I შესახვევი",
          "ლუარსაბ ანდრონიკაშვილის ქ.",
          "მაკს ტილკეს ქ.",
          "მარიამ უგრელიძის ქ. სოფელი დიღომი",
          "მარკო პოლოს ქ.",
          "მარუხის გმირების ქ.",
          "მარშალ გელოვანის გამზ. პანდუსი",
          "მარშალ გელოვანის გამზირი და მოედანი",
          "მარჯვენა სანაპირო",
          "მელიტონ და ანდრია ბალანჩივაძეების ქ.",
          "მერაბ ალექსიძის ქ (ყოფილი ზოია რუხაძის ქ.)",
          "მერაბ კოსტავას ქ.",
          "მერაბ კოსტავას ქ. (ზურგოვანა)",
          "მირზა გელოვანი ქ (ვეძისი)",
          "მირიან მეფე და ნანა დედოფლის l ჩიხი",
          "მირიან მეფე და ნანა დედოფლის ll ჩიხი",
          "მირიან მეფის ქ. შუქნიშნიდან III მ.რ-მდე",
          "მირიან მეფის ქუჩა",
          "მიხეილ ასათიანის ქ.",
          "მიხეილ ბურძგლას ქ. (ყოფილი შმიტის ქ.)",
          "მიხეილ ლომონოსოვის ქ",
          "მიხეილ მესხის ქ. სოფელი დიღომი",
          "მიხეილ ჭიაურელის ქ. სოფელი დიღომი",
          "მოსე ჯანაშვილის ქ.",
          "მოციქულთა სწორი ნინოს ქ. სოფელი დიღომი",
          "მულღაზანზარის ქ.",
          "მუხრან მაჭავარიანის ქ.",
          "მუხრან მაჭავარიანის ქ. (ვაშლიჯვრის ახალი ტრასა)",
          "ნესტანის ქ",
          "ნიკო ბურის ქ.",
          "ნიკოლოზ ბარათაშვილის ქ. სოფელი დიღომი",
          "ნიკოლოზ ბერაძის ქ.",
          "ნიკოლოზ ჩაჩავას ქ.",
          "ნინო აბაშიძე - ორბელიანი ქ.",
          "ნუცუბიძის #19 კორპუსის უკან (ჩიხტახანი)",
          "ნუცუბიძის პლატო I მიკრორაიონი",
          "ნუცუბიძის პლატო II მიკრორაიონი",
          "ნუცუბიძის პლატო III მიკრორაიონი",
          "ნუცუბიძის პლატო IV მიკრორაიონი",
          "ნუცუბიძის პლატო V მიკრორაიონი",
          "ნუცუბიძის ქ.",
          "ო. სოლოღაშვილის ქ. ჩიხები",
          "ოდესის ქ.",
          "ოთარ ჭილაძის ქ. (ყოფილი ამბროლაურის ქ.)",
          "ოთრ ონიაშვილის ქ.",
          "ორასი თავდადებული მხედრის ქ.",
          "ოსეთის ქ.",
          "ოსკარ შმერლინგის ქ.",
          "პ. ჯანიაშვილის ქ.",
          "პაატა ჯანიაშვილის ქ.",
          "პავლე ასლანიდის ქ.",
          "პანკისის ქ.",
          "პერტე სარაჯიშვილი ქ. (ვაშლიჯვარი)",
          "პეტრე სარაჯიშვილის ქ. ვაშლიჯვარი",
          "პეტრე სარაჯიშვილის ქ. სოფელი დიღომი",
          "პიმენ ყურაშვილის ქ.",
          "პლატონ იოსელიანის ქ.",
          "ჟიული შარტავას ქ.",
          "ჟოზეფ ტურნეფორის ქ.",
          "რამაზის ქ.",
          "რატევანის ქ",
          "რატევანის ქ I და II შესახვევი",
          "რაფიელ დანიბეგაშვილის ქ.",
          "რენე შმერლინგის ქ.",
          "როსტევანის ქ.",
          "რუსთაველის ქ. (სოფელი დიღომი )",
          "საბურთალოს ახალი ბაზრის მიმდებარე ქ.",
          "საბურთალოს ქ.",
          "საირმის გორის დასახლება",
          "საირმის ქ.",
          "სერგო ზაქარიაძის ქ.",
          "სვეტიცხოვლის ქ. სოფელი დიღომი",
          "სიკო დოლიძის ქ. (პეკინიდან ლიხაურის ქ-მდე)",
          "სიმონ კანდელაკის ქ.",
          "სიმონ ჩიქოვანის ქ.",
          "სიმონ ჩიქოვანის ქ. #9-11",
          "სოფელი დიდგორი",
          "სოფელი თელოვანი",
          "სოფრომ მგალობლიშვილის ქ. ვეძისი",
          "სტრაბონის ქ.",
          "სულხან ნასიძის ქ. (ყოფილი ახალშენის ქ.)",
          "ტაშკენტის ქ.",
          "ტელეკომპანია `მზე~-სთან მისასვლელი გზა",
          "ტეხურის ქ.",
          "ტიმოთე ბელოის ქ.",
          "ტყვარჩელის ქ.",
          "ფარნავაზის ქ. ფარნავაზ მეფის გამზირი",
          "ფარსადანის ქ.",
          "ფატმანის ქ.",
          "ფოლცვაგენთან ჩასახვევი გოდერძი ჩოხელის ქ.",
          "ფორტუნას უკან დასახლება ჭაშნაგირის ქ.",
          "ფრედერიკ მონპერეს ქ.",
          "ქ. შარაშიძის ქ.",
          "ქარელის ქ.",
          "ქაქუცა ჩოლოყაშვილის ქ. სოფელი დიღომი",
          "ქოშიგორას დასახლება",
          "შ. გოგიძის ქ.",
          "შ. კარმელის ქ.",
          "შალვა მიქელაძის ქ. (ვაკე-საბურთალო)",
          "შარტავას #7 (მერიის ავტოსადგომი)",
          "შარტავას ქ.-ზე ბაზრის წინ მიმდ. მოედანი",
          "შერმადინის ქ.",
          "შეყლაშვილის ქ.",
          "შოთა რუსთაველის ქ. სოფელი დიღომი",
          "ჩაილურის ქ.",
          "ცაგერის ქ.",
          "ცხინვალის ქ.",
          "ძველი ვეძისი",
          "ძმები კარბელაშვილების ქ.",
          "წებელდას ქ.",
          "ჭაბუა ამირეჯიბის გზატკეცილი",
          "ჭაშნაგირის ქ.",
          "ჭიათურის ქ.",
          "ხანძთელის ქ. სოფელი დირომი",
          "ხატაეთის ქ.",
          "ხახულის ქ.",
          "ხოდაბუნების ქ.",
          "ჯანო ბაგრატიონის ქ.",
          "ჯონ მალხაზ შალიკაშვილის ქ.",
          "ჰეიდარ აბაშიძე ქ. (ყოფილი ვოლოდარსკის ქ.)",
          "ჰენრიკ პრინევსკის ქ.",
          "ჰენრიხ კლაპტორის ქ.",
          "ჰიუგო ჰუპერტის ქ.",
        ],
      },
      {
        name: "ვაკე",
        streets: [
          "ირაკლი აბაშიძის ქუჩა",
          "ილია ჭავჭავაძის გამზირი",
          "მრგვალი ბაღის ქუჩა",
          "ფალიაშვილის ქუჩა",
          "ატენის ქუჩა",
          "ნაფარეულის ქუჩა",
          "წყნეთის გზატკეცილი",
          "ბაგების ქუჩა",
        ],
      },
      {
        name: "გლდანი",
        streets: [
          "ხიზანიშვილის ქუჩა",
          "ვეკუას ქუჩა",
          "ქერჩის ქუჩა",
          "ომარ ხიზანიშვილის ქუჩა",
          "თეთრიწყაროს ქუჩა",
          "გობრონიძის ქუჩა",
        ],
      },
      {
        name: "დიდი დიღომი",
        streets: [
          "პეტრე იბერის ქუჩა",
          "მირიან მეფის ქუჩა",
          "ფარნავაზ მეფის გამზირი",
          "დავით აღმაშენებლის ხეივანი",
          "იოსებ გრიშაშვილის ქუჩა",
        ],
      },
      {
        name: "ისანი",
        streets: [
          "ქეთევან დედოფლის გამზირი",
          "ნავთლუღის ქუჩა",
          "ბერი გაბრიელ სალოსის გამზირი",
          "დოდაშვილის ქუჩა",
          "მოსკოვის გამზირი",
        ],
      },
      {
        name: "სამგორი",
        streets: [
          "კახეთის გზატკეცილი",
          "ვარკეთილის მასივი",
          "ჯავახეთის ქუჩა",
          "აბაშვილის ქუჩა",
          "აეროპორტის დასახლება",
        ],
      },
      {
        name: "ნაძალადევი",
        streets: [
          "ცოტნე დადიანის ქუჩა",
          "გურამიშვილის გამზირი",
          "თორნიკე ერისთავის ქუჩა",
          "ჩარგლის ქუჩა",
          "სარაჯიშვილის გამზირი",
        ],
      },
      {
        name: "დიდუბე",
        streets: [
          "წერეთლის გამზირი",
          "მირცხულავას ქუჩა",
          "დიღმის მასივი",
          "სამტრედიის ქუჩა",
          "ბელიაშვილის ქუჩა",
        ],
      },
      {
        name: "ჩუღურეთი",
        streets: [
          "დავით აღმაშენებლის გამზირი",
          "მარჯანიშვილის ქუჩა",
          "წინამძღვრიშვილის ქუჩა",
          "უზნაძის ქუჩა",
          "კიევის ქუჩა",
        ],
      },
      {
        name: "მთაწმინდა",
        streets: [
          "რუსთაველის გამზირი",
          "ბესიკის ქუჩა",
          "ინგოროყვას ქუჩა",
          "ტაბიძის ქუჩა",
          "ლერმონტოვის ქუჩა",
        ],
      },
      {
        name: "კრწანისი",
        streets: [
          "კრწანისის ქუჩა",
          "ორთაჭალის ქუჩა",
          "გორგასლის ქუჩა",
          "გულიას ქუჩა",
          "ბალანჩივაძის ქუჩა",
        ],
      },
    ],
  },
  {
    city: "რუსთავი",
    districts: [
      {
        name: "ძველი რუსთავი",
        streets: [
          "კოსტავას გამზირი",
          "მესხიშვილის ქუჩა",
          "რუსთაველის ქუჩა",
          "ფიროსმანის ქუჩა",
          "მეგობრობის გამზირი",
        ],
      },
      {
        name: "ახალი რუსთავი",
        streets: [
          "შარტავას გამზირი",
          "ლეონიძის ქუჩა",
          "ბარათაშვილის ქუჩა",
          "კლდიაშვილის ქუჩა",
          "თბილისის ქუჩა",
        ],
      },
      {
        name: "მიკრორაიონები",
        streets: [
          "მე-12 მიკრორაიონი",
          "მე-17 მიკრორაიონი",
          "მე-19 მიკრორაიონი",
          "XXI მიკრორაიონი",
          "ჭყონდიდელის დასახლება",
        ],
      },
    ],
  },
];

const addressDirectorySelections = {};

function getAddressDirectoryCities() {
  return ADDRESS_DIRECTORY.map((item) => item.city);
}

function getAddressDirectoryCity(city) {
  const normalizedCity = normalizeAddressDirectoryText(city);
  return ADDRESS_DIRECTORY.find((item) => normalizeAddressDirectoryText(item.city) === normalizedCity) || ADDRESS_DIRECTORY[0];
}

function getAddressDirectoryDistricts(city) {
  return getAddressDirectoryCity(city)?.districts || [];
}

function normalizeAddressDirectoryText(value) {
  return String(value || "")
    .toLocaleLowerCase("ka-GE")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddressDirectoryStreetKey(value) {
  const ignored = new Set(["ქუჩა", "ქ", "გამზირი", "გამზ", "ჩიხი", "შესახვევი", "გასასვლელი", "გზატკეცილი", "ხეივანი"]);
  return normalizeAddressDirectoryText(value)
    .split(" ")
    .filter((token) => token && !ignored.has(token))
    .join(" ");
}

function addressDirectoryMatches(value, query) {
  const normalizedQuery = normalizeAddressDirectoryText(query);
  if (!normalizedQuery) return true;
  return normalizeAddressDirectoryText(value).includes(normalizedQuery)
    || normalizeAddressDirectoryStreetKey(value).includes(normalizeAddressDirectoryStreetKey(query));
}

function getAddressDirectoryStreetMatches({ city, district, query, limit = 12 } = {}) {
  const cityRecord = getAddressDirectoryCity(city);
  const normalizedDistrict = normalizeAddressDirectoryText(district);
  const rows = [];
  (cityRecord?.districts || []).forEach((districtRecord) => {
    if (normalizedDistrict && normalizeAddressDirectoryText(districtRecord.name) !== normalizedDistrict) return;
    districtRecord.streets.forEach((street) => {
      if (!addressDirectoryMatches(street, query)) return;
      rows.push({ city: cityRecord.city, district: districtRecord.name, street });
    });
  });
  return rows.slice(0, limit);
}

function getAddressDirectoryAllStreets(city) {
  const cityRecord = getAddressDirectoryCity(city);
  return (cityRecord?.districts || []).flatMap((districtRecord) => (
    districtRecord.streets.map((street) => ({
      city: cityRecord.city,
      district: districtRecord.name,
      street,
    }))
  ));
}

function findAddressDirectoryStreetInText(address, city) {
  const normalizedAddress = normalizeAddressDirectoryText(address);
  const normalizedStreetAddress = normalizeAddressDirectoryStreetKey(address);
  if (!normalizedAddress) return null;
  const matches = getAddressDirectoryAllStreets(city)
    .filter((item) => {
      const streetText = normalizeAddressDirectoryText(item.street);
      const streetKey = normalizeAddressDirectoryStreetKey(item.street);
      return normalizedAddress.includes(streetText) || (streetKey.length >= 4 && normalizedStreetAddress.includes(streetKey));
    })
    .sort((a, b) => normalizeAddressDirectoryStreetKey(b.street).length - normalizeAddressDirectoryStreetKey(a.street).length);
  return matches[0] || null;
}

function normalizeAddressDirectoryAddress(address, options = {}) {
  const rawAddress = cleanAddressInput(address);
  if (!rawAddress) return { address: "", corrected: false, match: null };
  const city = options.city || getAddressDirectoryCities().find((item) => normalizeAddressDirectoryText(rawAddress).includes(normalizeAddressDirectoryText(item))) || "თბილისი";
  const match = findAddressDirectoryStreetInText(rawAddress, city);
  if (!match) return { address: rawAddress, corrected: false, match: null };

  const normalizedParts = rawAddress.split(",").map((part) => cleanAddressInput(part)).filter(Boolean);
  const hasCity = normalizedParts.some((part) => normalizeAddressDirectoryText(part) === normalizeAddressDirectoryText(match.city));
  const cityPart = hasCity ? normalizedParts.find((part) => normalizeAddressDirectoryText(part) === normalizeAddressDirectoryText(match.city)) : match.city;
  const streetIndex = normalizedParts.findIndex((part) => (
    normalizeAddressDirectoryText(part).includes(normalizeAddressDirectoryText(match.street))
    || normalizeAddressDirectoryStreetKey(part).includes(normalizeAddressDirectoryStreetKey(match.street))
  ));
  const streetPart = streetIndex >= 0 ? normalizedParts[streetIndex] : match.street;
  const nextAddress = [cityPart, match.district, streetPart].filter(Boolean).join(", ");
  return {
    address: nextAddress,
    corrected: normalizeAddressDirectoryText(nextAddress) !== normalizeAddressDirectoryText(rawAddress),
    match,
  };
}

function renderAddressDirectoryFields(prefix, options = {}) {
  const cityOptions = getAddressDirectoryCities().map((city) => `
    <option value="${escapeAttr(city)}" ${city === (options.city || "თბილისი") ? "selected" : ""}>${escapeHtml(city)}</option>
  `).join("");
  return `
    <div class="address-directory-panel" data-address-directory="${escapeAttr(prefix)}">
      <label for="${escapeAttr(prefix)}City">ქალაქი</label>
      <select id="${escapeAttr(prefix)}City" data-address-city>
        ${cityOptions}
      </select>
      <label for="${escapeAttr(prefix)}District">რაიონი</label>
      <select id="${escapeAttr(prefix)}District" data-address-district></select>
      <label for="${escapeAttr(prefix)}Street">ქუჩა</label>
      <div class="address-autocomplete-shell">
        <input id="${escapeAttr(prefix)}Street" type="search" autocomplete="street-address" aria-autocomplete="list" aria-controls="${escapeAttr(prefix)}StreetSuggestions" data-address-street placeholder="დაიწყეთ ქუჩის წერა">
        <div id="${escapeAttr(prefix)}StreetSuggestions" class="address-autocomplete-dropdown address-directory-dropdown" role="listbox" hidden></div>
      </div>
      <label for="${escapeAttr(prefix)}Building">ნომერი</label>
      <input id="${escapeAttr(prefix)}Building" type="text" autocomplete="address-line2" data-address-building placeholder="მაგ: 35">
    </div>
  `;
}

function bindAddressDirectoryControls(prefix, options = {}) {
  const root = document.querySelector(`[data-address-directory="${prefix}"]`);
  if (!root || root.dataset.addressDirectoryBound === "true") return;
  root.dataset.addressDirectoryBound = "true";

  const citySelect = root.querySelector("[data-address-city]");
  const districtSelect = root.querySelector("[data-address-district]");
  const streetInput = root.querySelector("[data-address-street]");
  const buildingInput = root.querySelector("[data-address-building]");
  const dropdown = document.getElementById(`${prefix}StreetSuggestions`);
  const targetInput = options.targetInputId ? document.getElementById(options.targetInputId) : null;
  const districtRequired = Boolean(options.requireDistrict);

  const fillDistricts = () => {
    const districts = getAddressDirectoryDistricts(citySelect.value);
    const selected = districtSelect.value;
    districtSelect.innerHTML = [
      districtRequired ? "" : "<option value=\"\">ყველა რაიონი</option>",
      ...districts.map((district) => `<option value="${escapeAttr(district.name)}">${escapeHtml(district.name)}</option>`),
    ].join("");
    if (districts.some((district) => district.name === selected)) districtSelect.value = selected;
  };

  const closeDropdown = () => {
    if (!dropdown) return;
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    dropdown.style.display = "none";
  };

  const updateTarget = () => {
    const value = getAddressDirectoryValue(prefix);
    if (targetInput) targetInput.value = value.fullAddress;
    if (typeof options.onChange === "function") options.onChange(value);
  };

  const selectStreet = (match) => {
    addressDirectorySelections[prefix] = match;
    streetInput.value = match.street;
    districtSelect.value = match.district;
    closeDropdown();
    updateTarget();
  };

  const renderStreetDropdown = () => {
    const query = streetInput.value;
    const matches = getAddressDirectoryStreetMatches({
      city: citySelect.value,
      district: districtSelect.value,
      query,
    });
    if (!dropdown || !query || !matches.length) {
      closeDropdown();
      return;
    }
    dropdown.hidden = false;
    dropdown.style.display = "block";
    dropdown.style.opacity = "1";
    dropdown.style.pointerEvents = "auto";
    dropdown.style.position = "absolute";
    dropdown.style.transform = "translateY(0)";
    dropdown.style.zIndex = "2500";
    dropdown.innerHTML = `
      <div class="address-autocomplete-section">
        <div class="address-autocomplete-label">ქუჩები</div>
        ${matches.map((match, index) => `
          <button class="address-autocomplete-item" type="button" data-address-directory-index="${index}">
            <strong>${escapeHtml(match.street)}</strong>
            <span>${escapeHtml(`${match.city} · ${match.district}`)}</span>
          </button>
        `).join("")}
      </div>
    `;
    dropdown.querySelectorAll("[data-address-directory-index]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => selectStreet(matches[Number(button.dataset.addressDirectoryIndex)]));
    });
  };

  fillDistricts();
  updateTarget();

  citySelect.addEventListener("change", () => {
    addressDirectorySelections[prefix] = null;
    fillDistricts();
    streetInput.value = "";
    updateTarget();
    closeDropdown();
  });
  districtSelect.addEventListener("change", () => {
    addressDirectorySelections[prefix] = null;
    renderStreetDropdown();
    updateTarget();
  });
  streetInput.addEventListener("input", () => {
    addressDirectorySelections[prefix] = null;
    renderStreetDropdown();
    updateTarget();
  });
  streetInput.addEventListener("focus", renderStreetDropdown);
  streetInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      const exact = getAddressDirectoryStreetMatches({
        city: citySelect.value,
        district: "",
        query: streetInput.value,
        limit: 30,
  }).find((match) => normalizeAddressDirectoryStreetKey(match.street) === normalizeAddressDirectoryStreetKey(streetInput.value));
      if (exact && !districtSelect.value) selectStreet(exact);
      else if (exact && exact.district !== districtSelect.value) selectStreet(exact);
      else closeDropdown();
    }, 140);
  });
  buildingInput.addEventListener("input", updateTarget);
}

function getAddressDirectoryValue(prefix) {
  const root = document.querySelector(`[data-address-directory="${prefix}"]`);
  const city = root?.querySelector("[data-address-city]")?.value.trim() || "";
  const exact = getAddressDirectoryStreetMatches({
    city,
    district: "",
    query: root?.querySelector("[data-address-street]")?.value.trim() || "",
    limit: 50,
  }).find((match) => normalizeAddressDirectoryStreetKey(match.street) === normalizeAddressDirectoryStreetKey(root?.querySelector("[data-address-street]")?.value.trim() || ""));
  const district = exact?.district || root?.querySelector("[data-address-district]")?.value.trim() || addressDirectorySelections[prefix]?.district || "";
  const street = root?.querySelector("[data-address-street]")?.value.trim() || "";
  const building = root?.querySelector("[data-address-building]")?.value.trim() || "";
  const streetAddress = [street, building].filter(Boolean).join(" ").trim();
  const fullAddress = [city, district, streetAddress].filter(Boolean).join(", ");
  return {
    city,
    district,
    street,
    building,
    streetAddress,
    fullAddress,
    selectedStreet: exact || addressDirectorySelections[prefix] || null,
  };
}
