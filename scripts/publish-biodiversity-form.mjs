import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ID = '5f9e65c9-eb2c-4cf4-b351-2b3c63cf01c2';
const FORM_TITLE = 'Narmada site visit';
const SURVEY_TITLE = 'Biodiversity Survey Work in Areas along the Narmada Bank / नर्मदा तट अंतर्गत क्षेत्रों में जैवविविधता सर्वेक्षण';

const questions = [];
const seen = new Set();

function add(question) {
  if (seen.has(question.id)) throw new Error(`Duplicate question id ${question.id}`);
  seen.add(question.id);
  questions.push(question);
}

function section(id, label, description) {
  add({ id, type: 'section', label, required: false, ...(description ? { description } : {}) });
}

function text(id, label, long = false, required = false) {
  add({
    id,
    type: 'text',
    label,
    required,
    ...(long ? { validation: { maxLength: 800 } } : {}),
  });
}

function number(id, label) {
  add({ id, type: 'number', label, required: false, validation: { min: 0, integer: true } });
}

function yesNo(id, label) {
  add({ id, type: 'boolean', label, required: false });
}

function date(id, label, required = false) {
  add({ id, type: 'date', label, required });
}

function choice(id, label, choices) {
  add({ id, type: 'single_choice', label, required: false, choices });
}

function rows(id, label, count, columns, description) {
  section(id, label, description);
  for (let index = 1; index <= count; index += 1) {
    section(`${id}_${index}`, `Row ${index} / पंक्ति ${index}`);
    for (const column of columns) {
      const fieldId = `${id}_${index}_${column.key}`;
      const fieldLabel = `${index}. ${column.label}`;
      if (column.kind === 'number') number(fieldId, fieldLabel);
      else if (column.kind === 'yesno') yesNo(fieldId, fieldLabel);
      else if (column.kind === 'choice') choice(fieldId, fieldLabel, column.choices);
      else text(fieldId, fieldLabel, column.long === true);
    }
  }
}

const flora = [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'habit', label: 'Habit / स्वभाव' },
  { key: 'habitat', label: 'Habitat / आवास' },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'use', label: 'Commercial / own use / व्यावसायिक / स्वयं उपयोग' },
  { key: 'part', label: 'Part collected / एकत्रित भाग' },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
];

const gender = [
  { id: 'male', label: 'Male / पुरुष' },
  { id: 'female', label: 'Female / महिला' },
  { id: 'other', label: 'Other / अन्य' },
];
const marketFrequency = [
  { id: 'weekly', label: 'Weekly / साप्ताहिक' },
  { id: 'fortnightly', label: 'Fortnightly / पाक्षिक' },
  { id: 'biannual', label: 'Bi-annual / अर्धवार्षिक' },
  { id: 'annual', label: 'Annual / वार्षिक' },
];
const tradeKind = [
  { id: 'commercial', label: 'Commercial / व्यावसायिक' },
  { id: 'noncommercial', label: 'Non-commercial / गैर व्यावसायिक' },
];
const growingPlace = [
  { id: 'wild', label: 'Wild / जंगली' },
  { id: 'garden', label: 'Home garden / घर में बागवानी' },
];

section(
  'header',
  'Biodiversity Survey Form / जैवविविधता सर्वेक्षण प्रपत्र',
  'Appendix–2. Madhya Pradesh State Biodiversity Board, Bhopal (M.P.). Blank rows match the printed template and can be left empty.',
);
text('village', 'Village / ग्राम', false, true);
text('gram_panchayat', 'Gram Panchayat / ग्राम पंचायत');
date('survey_date', 'Survey date / सर्वेक्षण दिनांक', true);
text('janpad', 'Janpad Panchayat / जनपद पंचायत');
text('district', 'District Panchayat / जिला पंचायत');
text('collector', 'Data collector / डाटा कलेक्टर का नाम');
text('collector_mobile', 'Data collector mobile / डाटा कलेक्टर मोबाइल नं.');
text('mentor', 'Mentor name / mobile / मेंटर का नाम / मोबाइल');

section('a', 'A. General details / सामान्य जानकारी');
add({
  id: 'gps',
  type: 'gps',
  label: '1. Geographical position of the village (lat / long) / ग्राम की भौगोलिक स्थिति (अक्षांश / देशांतर)',
  required: true,
  allowManualLocation: true,
});
number('population', '2. Total population of the village / ग्राम की कुल जनसंख्या');
text('habitat', '3. Habitat and topography / आवास एवं भौगोलिकता', true);
text('climate', '4. Climate (rainfall, temperature, other patterns) / जलवायु (वर्षा, तापमान और अन्य मौसम के पैटर्न)', true);

section('checklist', 'Key points / महत्वपूर्ण बिन्दु');
const checks = [
  ['bmc_activated', '1. BMC members and the general public were activated and capacity-built for the survey / जैवविविधता सर्वेक्षण हेतु बीएमसी सदस्य एवं आमजन का सक्रियण एवं क्षमता विकास किया गया'],
  ['tk_included', '2. Traditional knowledge is included in the survey form / सर्वेक्षण प्रपत्र में पारंपरिक ज्ञान समाहित है'],
  ['ret_found', '3. Rare, endangered or threatened (RET) species were found in the village / ग्राम में संकटापन्न (RET) प्रजातियाँ पाई गईं'],
  ['commercial_bio', '4. Commercially important bio-resources are available in the village / ग्राम में वाणिज्यिक महत्व के जैव संसाधन उपलब्ध हैं'],
];
for (const [id, label] of checks) {
  yesNo(id, `${label} — Yes / हाँ, No / नहीं`);
  text(`${id}_remark`, `Form no. / remark / प्रपत्र क्रमांक / रिमार्क — ${label.slice(0, 12)}`);
}

section('officials', 'Local body / Panchayat officials / स्थानीय निकाय / पंचायत पदाधिकारी');
for (const [id, label] of [
  ['ceo_district', 'CEO, District Panchayat / मुख्य कार्यपालन अधिकारी, जिला पंचायत'],
  ['ceo_janpad', 'CEO, Janpad Panchayat / मुख्य कार्यपालन अधिकारी, जनपद पंचायत'],
  ['sarpanch', 'Sarpanch / सरपंच'],
  ['gp_secretary', 'Gram Panchayat Secretary / ग्राम पंचायत सचिव'],
  ['bmc_chair', 'BMC Chairperson / जैवविविधता प्रबंधन समिति अध्यक्ष'],
]) {
  text(`${id}_name`, `${label} — Name / नाम`);
  text(`${id}_mobile`, `${label} — Mobile no. / मोबाइल नं.`);
}

rows('b', 'B. Individuals, schools, colleges, universities and government institutions assisting the survey / सर्वेक्षण में सहायता देने वाले व्यक्ति एवं संस्थान', 4, [
  { key: 'name', label: 'Name / नाम' },
  { key: 'designation', label: 'Designation / institution / पदनाम / संस्थान' },
  { key: 'address', label: 'Address / पता', long: true },
  { key: 'mobile', label: 'Mobile / मोबाइल नं.' },
]);

section('c', 'C. Peoplescape, landscape, waterscape and soil / जनदृश्य, जलदृश्य, भूदृश्य एवं भूमि');
section('c1', '1. Community and population / समुदाय एवं जनसंख्या');
number('c_sc', 'SC / अनुसूचित जाति');
number('c_st', 'ST / अनुसूचित जनजाति');
number('c_obc', 'OBC / पिछड़ा वर्ग');
number('c_general', 'General / सामान्य');
number('c_total_population', 'Total population / कुल जनसंख्या');
number('c_families', 'Total families / कुल परिवार');
text('c_occupation', '2. Families and major occupation / परिवार एवं प्रमुख व्यवसाय', true);
text('c_landscape', '3. Major landscapes (agricultural land, pond, fallow land, etc.) / प्रमुख परिदृश्य (कृषि भूमि, तालाब, परती भूमि आदि)', true);
text('c_water', '4. Waterscape (ponds, streams, rivers, lake, canal, tube well, dug well, etc.) / जलदृश्य (तालाब, धाराएँ, नदियाँ, झील, नहर, ट्यूबवेल, कुएँ आदि)', true);
rows('c_soil', '5. Details of soil / भूमि का विवरण', 3, [
  { key: 'type', label: 'Soil type / भूमि का प्रकार' },
  { key: 'colour', label: 'Colour and texture / रंग एवं लक्षण' },
  { key: 'features', label: 'Features / विशेषताएँ', long: true },
  { key: 'management', label: 'Soil management / प्रबंधन', long: true },
  { key: 'crops', label: 'Suitable plants / crops / उपयुक्त फसल / वनस्पति' },
  { key: 'other', label: 'Flora, fauna / other information / जीव / अन्य जानकारी', long: true },
]);

section('d', 'D. Biodiversity Management Committee (BMC) of the Gram Panchayat / ग्राम पंचायत की जैवविविधता प्रबंधन समिति');
date('d_formed', 'Date of formation / गठन दिनांक');
const bmcRows = [
  'Non-official: Chairperson / अशासकीय: अध्यक्ष',
  'Non-official member / अशासकीय सदस्य',
  'Non-official member / अशासकीय सदस्य',
  'Forest / वन',
  'Agriculture / Farmer Welfare / किसान कल्याण एवं कृषि विकास',
  'Animal Husbandry / पशुपालन विभाग',
  'Health / स्वास्थ्य',
  'Fishery / मत्स्य',
  'Education / शिक्षा विभाग',
];
bmcRows.forEach((label, index) => {
  const n = index + 1;
  section(`d_${n}`, `${n}. ${label}`);
  text(`d_${n}_designation`, `${n}. Designation / पदनाम`);
  text(`d_${n}_name`, `${n}. Name / नाम`);
  text(`d_${n}_post`, `${n}. Post in BMC (Secretary / Special invitee) / जै.प्र. समिति में पद (सचिव / विशेष आमंत्रित)`);
  text(`d_${n}_mobile`, `${n}. Mobile / मोबाइल नं.`);
});
section('d_10', '10. Other category / अन्य श्रेणी');
text('d_10_category', '10. Category / department / श्रेणी / विभाग');
text('d_10_designation', '10. Designation / पदनाम');
text('d_10_name', '10. Name / नाम');
text('d_10_post', '10. Post in BMC (Secretary / Special invitee) / जै.प्र. समिति में पद (सचिव / विशेष आमंत्रित)');
text('d_10_mobile', '10. Mobile / मोबाइल नं.');

rows('e', 'E. Traditional healers and practitioners (vaids, hakims, human and livestock healers) / परंपरागत वैद्यों / चिकित्सकों का विवरण', 5, [
  { key: 'name', label: 'Name / नाम' },
  { key: 'age', label: 'Age / आयु', kind: 'number' },
  { key: 'gender', label: 'Gender / लिंग', kind: 'choice', choices: gender },
  { key: 'address', label: 'Address / पता', long: true },
  { key: 'specialization', label: 'Area of specialization / कार्यक्षेत्र' },
  { key: 'access', label: 'Location of bio-resource access (forest, farm, market) / क्षेत्र जहाँ से जैव संसाधन प्राप्त करते हैं' },
  { key: 'perception', label: 'Perception on status of bio-resources / जैव संसाधनों की स्थिति पर धारणा', long: true },
  { key: 'medicinal', label: 'Medicinal use of bio-resources / जैव संसाधनों का औषधीय उपयोग', long: true },
]);

section('f', 'F. Wild biodiversity / जंगली जैवविविधता');
section('f1', 'F.1 Wild flora / जंगली वनस्पति');
rows('f11', 'F.1.1 Details of trees / वृक्षों का विवरण', 5, flora);
rows('f12', 'F.1.2 Details of shrubs / झाड़ियों का विवरण', 5, flora);
rows('f13', 'F.1.3 Details of herbs / पौधों का विवरण', 5, flora);
rows('f14', 'F.1.4 Details of tubers / कंदीय पौधों का विवरण', 5, flora);
rows('f15', 'F.1.5 Details of grasses / घास का विवरण', 5, flora);
rows('f16', 'F.1.6 Details of climbers / लताओं का विवरण', 5, flora);
rows(
  'f17',
  'F.1.7 Plants of medicinal importance / औषधीय महत्व के पौधों का विवरण',
  5,
  flora.map((column) => (column.key === 'use' ? { ...column, label: 'Use / उपयोग' } : column.key === 'other' ? { ...column, label: 'Other details / अन्य विवरण' } : column)),
  'Use: food / veterinary medicine / human medicine (children, women, etc.) / agricultural purpose (bio-pesticide). Other details: harvesting period / perennial / annual / seasonal.',
);
rows('f18', 'F.1.8 Non-timber plant species of economic, social, cultural and health importance / गैर इमारती लकड़ी की प्रजातियाँ', 4, [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'importance', label: 'Economic, social, cultural or other importance / आर्थिक, सामाजिक, सांस्कृतिक या अन्य महत्व', long: true },
  { key: 'status', label: 'Present status / वर्तमान स्थिति' },
]);
rows('f19', 'F.1.9 Timber plants / इमारती लकड़ी वाले पौधों का विवरण', 4, [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'habitat', label: 'Habitat / आवास' },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'uses', label: 'Other uses (if any) / अन्य उपयोग (यदि कोई)' },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
]);
rows('f2', 'F.2 Wild fauna / जंगली जीवों का विवरण', 6, [
  { key: 'type', label: 'Animal type / पशु का प्रकार' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'habitat', label: 'Habitat / आवास' },
  { key: 'description', label: 'Description / characteristics / विवरण / लक्षण', long: true },
  { key: 'season', label: 'Season seen / ऋतु जिसमें देखे जाते हैं' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'uses', label: 'Uses (if any) / उपयोग (यदि कोई)' },
  { key: 'hunting', label: 'Mode of hunting / collecting / शिकार का तरीका' },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);

section('g', 'G. Agrobiodiversity / कृषि जैवविविधता');
section('g1', 'G.1 Agriculture sector / कृषि क्षेत्र का विवरण');
rows('g11', 'G.1.1 Crop plants / फसलीय पौधे', 5, [
  { key: 'crop', label: 'Name of crop / फसल का नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'habitat', label: 'Landscape / habitat / परिदृश्य / आवास' },
  { key: 'area', label: 'Approximate area sown / अनुमानित बोया क्षेत्र' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'features', label: 'Special features / विशेषताएँ', long: true },
  { key: 'season', label: 'Cropping season / फसल का मौसम' },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
  { key: 'source', label: 'Source of seeds / plants / बीज / पौधों के स्रोत' },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g12', 'G.1.2 Crop weeds / फसलों में लगने वाले खरपतवारों का विवरण', 4, [
  { key: 'plant', label: 'Plant / वनस्पति' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'crop', label: 'Affected crop / प्रभावित फसल' },
  { key: 'impact', label: 'Impact / प्रभाव', long: true },
  { key: 'habitat', label: 'Landscape / habitat / परिदृश्य / आवास' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'use', label: 'Use, if any / उपयोग' },
  { key: 'management', label: 'Management options / प्रबंधन का तरीका', long: true },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g13', 'G.1.3 Wild relatives of crops / फसल से संबंधित जंगली प्रजातियाँ', 3, [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'crops', label: 'Associated crops / संबद्ध फसल' },
  { key: 'habitat', label: 'Landscape / habitat / परिदृश्य / उत्पत्ति स्थान' },
  { key: 'uses', label: 'Uses / उपयोग' },
  { key: 'part', label: 'Part used / उपयोग किया भाग' },
  { key: 'tk', label: 'Associated traditional knowledge / संबंधित पारंपरिक ज्ञान', long: true },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g14', 'G.1.4 Pests of crops / फसलों के कीट प्रजातियों का विवरण', 4, [
  { key: 'host', label: 'Host crop / पोषिता फसल' },
  { key: 'type', label: 'Type of insect / pest / कीट का प्रकार' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'habitat', label: 'Habitat / निवास स्थान' },
  { key: 'season', label: 'Time / season of attack / आक्रमण का समय' },
  { key: 'management', label: 'Management mechanism / प्रबंधन का तरीका', long: true },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g15', 'G.1.5 Organic farming / जैविक कृषि', 3, [
  { key: 'farmer', label: 'Farmer name and address / कृषक का नाम एवं पता', long: true },
  { key: 'local', label: 'Local name of organic crops / जैविक फसल का स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'fertilizer', label: 'Fertilizers used / उपयोग किए उर्वरक का प्रकार' },
  { key: 'manure', label: 'Elements / factors for preparing manure / जैविक खाद बनाने में उपयोग तत्व', long: true },
  { key: 'time', label: 'Time taken to prepare / खाद तैयार होने की अवधि' },
  { key: 'market', label: 'Market for produce / जैविक फसल हेतु बाजार' },
  { key: 'registered', label: 'Registered? / पंजीकृत (हाँ/नहीं)', kind: 'yesno' },
  { key: 'agency', label: 'Certification agency / प्रमाणीकरण संस्था' },
  { key: 'remark', label: 'Remark / रिमार्क', long: true },
]);

section('g2', 'G.2 Horticulture / उद्यानिकी फसलें');
rows('g21', 'G.2.1 Fruit plants / फलदार पौधों का विवरण', 4, [
  { key: 'name', label: 'Name of plant / पौधे का नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'habitat', label: 'Landscape / habitat / परिदृश्य / उत्पत्ति स्थान' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'source', label: 'Source of seeds / plants / बीज / पौधों का स्रोत' },
  { key: 'season', label: 'Fruiting season / फल लगने का मौसम' },
  { key: 'uses', label: 'Uses / उपयोग' },
  { key: 'market', label: 'Market / own use / बाजार / स्वयं उपयोग' },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g22', 'G.2.2 Vegetable plants (olericulture) / सब्जी वर्ग की फसलों का विवरण', 4, [
  { key: 'name', label: 'Name of plant / पौधे का नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'habitat', label: 'Landscape / habitat / परिदृश्य / उत्पत्ति स्थान' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'source', label: 'Source of seeds / plants / बीज / पौधों का स्रोत' },
  { key: 'uses', label: 'Uses / उपयोग' },
  { key: 'market', label: 'Market / own use / बाजार / स्वयं उपयोग' },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g23', 'G.2.3 Floriculture / फूलों की खेती वाली किस्मों का विवरण', 3, [
  { key: 'type', label: 'Type of plant / पौधे का प्रकार' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'source', label: 'Source of plant / seeds / पौधों / बीजों का स्रोत' },
  { key: 'trade', label: 'Commercial / non-commercial / व्यावसायिक / गैर व्यावसायिक', kind: 'choice', choices: tradeKind },
  { key: 'uses', label: 'Uses / उपयोग' },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g24', 'G.2.4 Ornamental plants, trees, climbers and others / सजावटी पौधों, वृक्षों, लताओं व अन्य का विवरण', 3, [
  { key: 'type', label: 'Type of plant / पौधे का प्रकार' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'source', label: 'Source of plant / seeds / पौधों / बीजों का स्रोत' },
  { key: 'trade', label: 'Commercial / non-commercial / व्यावसायिक / गैर व्यावसायिक', kind: 'choice', choices: tradeKind },
  { key: 'uses', label: 'Uses / उपयोग' },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g3', 'G.3 Cultivated medicinal plants (herbs, shrubs, trees and others) / औषधीय पौधों की खेती वाली प्रजातियाँ', 3, [
  { key: 'name', label: 'Name of plant / पौधे का नाम' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'habitat', label: 'Landscape / habitat / परिदृश्य / आवास' },
  { key: 'source', label: 'Source of plant / seeds / पौधों / बीजों का स्रोत' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'uses', label: 'Uses / उपयोग' },
  { key: 'part', label: 'Part used / उपयोग किया भाग' },
  { key: 'market', label: 'Market / own use / बाजार / स्वयं उपयोग' },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g4', 'G.4 Cultivated timber plants / उगाए जाने वाले इमारती लकड़ी के पौधों का विवरण', 3, [
  { key: 'name', label: 'Name of plant / पौधे का नाम' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'habitat', label: 'Habitat / निवास स्थान' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'place', label: 'Wild / home garden / जंगली / घर में बागवानी', kind: 'choice', choices: growingPlace },
  { key: 'uses', label: 'Other uses (multi) / अन्य उपयोग (बहु)' },
  { key: 'other', label: 'Other details / अन्य विवरण', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('g5', 'G.5 Domesticated animals (cattle, buffalo, sheep, goat) and birds / पालतू पशु एवं पालतू पक्षियों का विवरण', 4, [
  { key: 'type', label: 'Type of animal / पशु का प्रकार' },
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'breed', label: 'Breed (local / hybrid) / नस्ल (स्थानीय / संकर)' },
  { key: 'traits', label: 'Characteristics / लक्षण', long: true },
  { key: 'keeping', label: 'Method of keeping / रखने का तरीका' },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'uses', label: 'Uses / उपयोग' },
  { key: 'commercial', label: 'Commercial rearing / व्यावसायिक पालन-पोषण' },
  { key: 'other', label: 'Other details including products and services / उत्पाद व सेवा सहित अन्य जानकारी', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);

section('h', 'H. Aquatic biodiversity and its role in the livelihood of local people / जलीय जैवविविधता एवं स्थानीय लोगों की आजीविका में उनकी भूमिका');
rows('h1', 'H.1 Aquatic fauna / जलीय जीव जैवविविधता', 4, [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'features', label: 'Features and habitat / विशेषताएँ एवं निवास स्थान', long: true },
  { key: 'past', label: 'Local status — past / स्थानीय स्थिति — पूर्व' },
  { key: 'present', label: 'Local status — present / स्थानीय स्थिति — वर्तमान' },
  { key: 'uses', label: 'Uses / उपयोग' },
  { key: 'livelihood', label: 'Role of the species in local livelihood / स्थानीय लोगों की आजीविका में प्रजाति की भूमिका', long: true },
  { key: 'holder', label: 'Community / knowledge holder / समुदाय / ज्ञान धारक' },
]);
rows('h2', 'H.2 Aquatic flora / जलीय वनस्पति जैवविविधता', 4, [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'variety', label: 'Variety / किस्म' },
  { key: 'livelihood', label: 'Role of the species in local livelihood / स्थानीय लोगों की आजीविका में प्रजाति की भूमिका', long: true },
  { key: 'trends', label: 'Trends / प्रवृत्तियाँ', long: true },
]);

rows('i', 'I. Markets (agriculture, horticulture, medicinal plants, livestock and other products) / बाजार', 4, [
  { key: 'name', label: 'Name of weekly market / fair / साप्ताहिक मेले / बाजार का नाम' },
  { key: 'location', label: 'Location / स्थान' },
  { key: 'frequency', label: 'Weekly / fortnightly / bi-annual / annual / साप्ताहिक / पाक्षिक / अर्धवार्षिक / वार्षिक', kind: 'choice', choices: marketFrequency },
  { key: 'day', label: 'Market / fair day / बाजार / मेले का दिन' },
  { key: 'month', label: 'Month (if bi-annual / annual) / माह (अर्धवार्षिक / वार्षिक)' },
  { key: 'goods', label: 'Types of animals / medicinal plants / bio-resources / crops bought and sold / क्रय और विक्रय का प्रकार', long: true },
  { key: 'from', label: 'Arrives from / जहाँ से विक्रय सामग्री आती है' },
  { key: 'to', label: 'Transported to / जहाँ के लिए परिवहन होता है' },
]);

section('j', 'J. Traditional knowledge (TK) / पारंपरिक ज्ञान');
rows('j1', 'J.1 TK related to forest biodiversity / वानिकी जैवविविधता से संबंधित पारंपरिक ज्ञान', 4, [
  { key: 'plant', label: 'Plant / पौधा' },
  { key: 'part', label: 'Useful part of plant / पौधे का उपयोगी अंग' },
  { key: 'part_tk', label: 'TK associated with the part used / उपयोग किए जाने वाले भाग से संबंधित ज्ञान', long: true },
  { key: 'method', label: 'Associated TK (method / dose / use) / संबंधित पारंपरिक ज्ञान (विधि / मात्रा / उपयोग)', long: true },
  { key: 'healer', label: 'Associated traditional healer / vaid / hakim (name and contact) / पारंपरिक चिकित्सक / वैद्य / हकीम' },
  { key: 'source', label: 'Information given by (name and contact) / जानकारी देने वाले का नाम एवं संपर्क' },
]);
rows('j2', 'J.2 TK related to agrobiodiversity / कृषि जैवविविधता से संबंधित पारंपरिक ज्ञान', 4, [
  { key: 'crop', label: 'Crop / फसल' },
  { key: 'type', label: 'Type of crop / फसल का प्रकार' },
  { key: 'knowledge', label: 'Knowledge of local importance / स्थानीय महत्व का ज्ञान', long: true },
  { key: 'scope', label: 'Scope / क्षेत्र' },
  { key: 'healer', label: 'Associated traditional healer / vaid / hakim (name and contact) / पारंपरिक चिकित्सक / वैद्य / हकीम' },
  { key: 'source', label: 'Information given by (name and contact) / जानकारी देने वाले का नाम एवं संपर्क' },
]);
rows('j3', 'J.3 TK related to aquatic biodiversity / जलीय जैवविविधता से संबंधित पारंपरिक ज्ञान', 3, [
  { key: 'variety', label: 'Variety (flora / fauna) / प्रकार (जलीय वनस्पति / जीव)' },
  { key: 'type', label: 'Type of TK / पारंपरिक ज्ञान का प्रकार' },
  { key: 'info', label: 'Information of local importance / स्थानीय महत्व की जानकारी', long: true },
  { key: 'scope', label: 'Scope / क्षेत्र' },
  { key: 'healer', label: 'Associated traditional healer / vaid / hakim (name and contact) / पारंपरिक चिकित्सक / वैद्य' },
  { key: 'validation', label: 'Validation — name and contact / मान्यता प्राप्त व्यक्ति का नाम एवं संपर्क' },
]);

rows('k', 'K. Tradable biological resources (quantity / value / market status) / वाणिज्यिक उपयोग वाले जैव संसाधन', 5, [
  { key: 'name', label: 'Name of tradable bio-resource / जैविक संसाधन का नाम' },
  { key: 'names', label: 'Local and scientific name / सामान्य / वैज्ञानिक नाम' },
  { key: 'quantity', label: 'Approximate quantity accessed per year (ton / qtl / kg) / वर्ष में अनुमानित मात्रा' },
  { key: 'part', label: 'Part of plant / पौधे का भाग' },
  { key: 'source', label: 'Source — place where traded / स्रोत (क्षेत्र जहाँ क्रय / विक्रय होता है)' },
]);
rows('l', 'L. Traditional agricultural practices / परंपरागत कृषि पद्धतियाँ', 4, [
  { key: 'practice', label: 'Traditional agricultural practice / परंपरागत कृषि पद्धति', long: true },
  { key: 'crops', label: 'Related crop varieties / संबंधित फसल का प्रकार' },
]);
rows('m', 'M. Rare, endangered and threatened (RET) floral species / दुर्लभ, लुप्तप्राय एवं संकटापन्न पादप प्रजातियाँ', 4, [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'iucn', label: 'IUCN status / आई.यू.सी.एन. स्थिति' },
  { key: 'other', label: 'Other details / अन्य जानकारी', long: true },
]);
rows('n', 'N. Rare, endangered and threatened (RET) faunal species / दुर्लभ एवं संकटग्रस्त जंतु प्रजातियाँ', 4, [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'iucn', label: 'IUCN status / आई.यू.सी.एन. स्थिति' },
  { key: 'other', label: 'Other details / अन्य जानकारी', long: true },
]);
rows('o', 'O. Migratory birds in the area / क्षेत्र में पाए जाने वाले प्रवासी पक्षी', 3, [
  { key: 'local', label: 'Local name / स्थानीय नाम' },
  { key: 'scientific', label: 'Scientific name / वैज्ञानिक नाम' },
  { key: 'season', label: 'Season of sighting / पक्षियों के देखे जाने का मौसम' },
  { key: 'other', label: 'Other details / अन्य जानकारी', long: true },
]);

section('p', 'P. Photographs (attach a photo of every biodiversity type shown in this form) / छायाचित्र');
for (const [id, label] of [
  ['p1', 'Photo 1: PRA / छायाचित्र 1: पी.आर.ए.'],
  ['p2', 'Photo 2: BMC meeting / छायाचित्र 2: बी.एम.सी. बैठक'],
  ['p3', 'Photo 3: Survey / village tour / छायाचित्र 3: ग्राम में सर्वे / भ्रमण'],
  ['p4', 'Photo 4: Special biodiversity of the village / छायाचित्र 4: ग्राम की विशेष जैवविविधता'],
]) {
  add({ id, type: 'photo', label, required: false, validation: { maxPhotos: 1 } });
}

rows('q', 'Q. Suggestions by the local community for the biodiversity survey (if any) / स्थानीय समुदाय द्वारा दिए गए सुझाव', 4, [
  { key: 'text', label: 'Suggestion / सुझाव', long: true },
]);

section('signatures', 'Signatures / हस्ताक्षर');
text('sign_mentor', 'Mentor / मेंटर के हस्ताक्षर');
text('sign_collector', 'Data collector / डाटा कलेक्टर के हस्ताक्षर');
text('sign_ceo', 'CEO, Janpad Panchayat, or Sarpanch / BMC Chairperson / मुख्य कार्यपालन अधिकारी, जनपद पंचायत अथवा सरपंच / बी.एम.सी. अध्यक्ष');
text('sign_secretary', 'Secretary, Gram Panchayat (with seal) / सचिव, ग्राम पंचायत (मुहर सहित)');

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv(new URL('../.env.local', import.meta.url));
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signedIn = await client.auth.signInWithPassword({
  email: env.DEMO_USER_EMAIL,
  password: env.DEMO_USER_PASSWORD,
});
if (signedIn.error) throw signedIn.error;

const listed = await client.from('forms').select('id, title').eq('project_id', PROJECT_ID);
if (listed.error) throw listed.error;
const existing = (listed.data ?? []).find((form) => form.title === FORM_TITLE);
if (!existing) throw new Error(`Form "${FORM_TITLE}" was not found in the project.`);

const survey = {
  schemaVersion: 1,
  id: existing.id,
  title: SURVEY_TITLE,
  questions,
};

const published = await client.rpc('publish_form_version', { p_form_id: existing.id, p_schema: survey });
if (published.error) throw published.error;
const version = await client.from('form_versions').select('version_number').eq('id', published.data).single();
if (version.error) throw version.error;
console.log(JSON.stringify({ formId: existing.id, version: version.data.version_number, questions: questions.length, sections: questions.filter((item) => item.type === 'section').length }));
