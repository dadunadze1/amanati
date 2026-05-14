"use strict";

"use strict";

const CONFIG = {
  center: [41.7151, 44.8271],
  deliveryTotalPrice: 6,
  courierDeliveryPay: 3.5,
  adminDeliveryProfit: 2.5,
  useZonesApi: false,
  useUserZoneApi: true,
  useReverseGeocoding: true,
  useExternalAddressSearch: true,
  useOverpassSearch: false,
  dataRetentionMonths: 8,
  zoneAssignmentsStorageKey: "deliveryZoneAssignments:v1",
  cashAdjustmentsStorageKey: "deliveryCashAdjustments:v1",
  payAdjustmentsStorageKey: "deliveryPayAdjustments:v1",
};

const firebaseConfig = {
  apiKey: "AIzaSyBF421H4mkNB9Ve_uJ8Ph6z4LrbxzKlrC4",
  authDomain: "amanatebi123-43963.firebaseapp.com",
  projectId: "amanatebi123-43963",
  storageBucket: "amanatebi123-43963.firebasestorage.app",
  messagingSenderId: "882036563594",
  appId: "1:882036563594:web:c800b0f2bb6977a441d773",
};

const STRINGS = {
  emptyFields: "შეავსეთ ყველა ველი.",
  pendingSent: "რეგისტრაციის მოთხოვნა გაიგზავნა ადმინთან.",
  invalidLogin: "ლოგინი ან პაროლი არასწორია.",
  noCouriers: "კურიერი ჯერ არ არის.",
  noPending: "დასადასტურებელი მოთხოვნა არ არის.",
  noParcels: "აქტიური ამანათი არ არის.",
  chooseMapPoint: "დააჭირეთ რუკაზე მიტანის ადგილს.",
  parcelAdded: "ამანათი დაემატა.",
  dayArchived: "დასრულებული ამანათები გადავიდა ისტორიაში.",
  setupFailed: "ადმინის შექმნა ვერ მოხერხდა.",
  serverFailed: "სერვერთან კავშირი ვერ მოხერხდა.",
  addressRequired: "შეიყვანეთ ქუჩა და შენობის ნომერი.",
  addressLoading: "მისამართი იძებნება...",
  addressMissing: "მისამართი არ არის მითითებული",
  addressStreetFallback: "ზუსტი შენობის ნომერი ვერ მოიძებნა, ნაჩვენებია ქუჩა.",
};

const DEFAULT_ZONES = getDefaultTbilisiZones();

function getDefaultTbilisiZones() {
  return [
    {
      id: "dighomi",
      code: "dighomi",
      name: "დიღმის ზონა",
      areas: ["დიდი დიღომი", "დიღმის მასივი", "სოფელი დიღომი", "დიღომი"],
      polygon: [
        [41.732, 44.690],
        [41.817, 44.700],
        [41.822, 44.786],
        [41.774, 44.804],
        [41.730, 44.780],
      ],
    },
    {
      id: "north",
      code: "north",
      name: "ჩრდილოეთის ზონა",
      areas: ["გლდანი", "მუხიანი", "თემქა", "ავჭალა", "ზღვისუბანი"],
      polygon: [
        [41.760, 44.790],
        [41.865, 44.765],
        [41.870, 44.930],
        [41.770, 44.930],
        [41.742, 44.850],
      ],
    },
    {
      id: "east",
      code: "east",
      name: "აღმოსავლეთის ზონა",
      areas: ["ისანი", "სამგორი", "ვარკეთილი", "ვაზისუბანი", "ლილო", "ორხევი", "აეროპორტის დასახლება", "ფონიჭალა"],
      polygon: [
        [41.612, 44.812],
        [41.725, 44.835],
        [41.773, 45.070],
        [41.640, 45.095],
        [41.575, 44.930],
      ],
    },
    {
      id: "center",
      code: "center",
      name: "ცენტრალური ზონა",
      areas: ["ვაკე", "საბურთალო", "ვერა", "მთაწმინდა", "სოლოლაკი", "ავლაბარი", "ორთაჭალა", "კრწანისი", "ბაგები", "წყნეთი", "კოჯორი"],
      polygon: [
        [41.612, 44.635],
        [41.732, 44.650],
        [41.742, 44.835],
        [41.680, 44.875],
        [41.585, 44.785],
      ],
    },
    {
      id: "west_south",
      code: "west_south",
      name: "დასავლეთ-სამხრეთის ზონა",
      areas: ["დიდუბე", "ნაძალადევი", "კუკია", "ჩუღურეთი"],
      polygon: [
        [41.700, 44.760],
        [41.770, 44.760],
        [41.772, 44.840],
        [41.710, 44.858],
        [41.682, 44.805],
      ],
    },
  ];
}
