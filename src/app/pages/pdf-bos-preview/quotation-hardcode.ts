/* =============================================================================
 * ⚠️ HARDCODE — ค่าคงที่ทั้งหมดของใบเสนอราคา PDF รวมไว้ที่ไฟล์นี้ไฟล์เดียว
 *
 * field เหล่านี้ยังไม่มีที่กรอก / ไม่มี data จริงใน estimate-page หรือ API
 * เมื่อมี data จริงแล้วให้ย้ายไป bind กับ snapshot แทน แล้วลบ key ที่นี่ทิ้ง
 * ============================================================================= */

export const QUOTATION_HARDCODE = {
  // ---- ⚠️ HARDCODE: บล็อกหัวกระดาษ (ข้อมูลบริษัท) ----
  company: {
    name: 'Kunini Solar EPC Solutions',
    address: '70/137 Soi 112, T. Nong Kae, A. Hua Hin, Prachaub Khirikhan 77110',
    web: 'www.kunini.com',
    facebook: 'https://www.facebook.com/KUNINI.SOLAR',
    office: 'Tel: 032 512799   Mob: 081 4894949, 061 4134850',
  },

  // ---- ⚠️ HARDCODE: Description มาตรฐานของ 3 แถวที่ไม่ได้ดึงจาก data ----
  // (BOS = ถ้า join รายการจริงจะยาวเกิน / Installation = labour เป็น free-text ที่พิมพ์เอง / Documentation ไม่ใช่ข้อความมาตรฐานแล้ว — ใช้ชื่อ type จาก section 7)
  rowDescription: {
    bos: 'Solar BOS - UV Sun resistant PV Solar cable, MC4 connectors, Solar Combiner Box; DC Fuses, DC Surge Protection, AC Surge Protection, AC disconnect. 3P ATS Switch + Cabinet, AC cable, Conduit and fittings.',
    installation: 'System Installation, Testing, Commissioning + Maintenance + Shipping',
  },

  // ---- ⚠️ HARDCODE: หน่วยของแต่ละแถว ----
  unit: {
    inverter: 'EACH',
    battery: 'EACH',
    panels: 'EACH',
    accessory: 'EACH',
    racking: 'LOT',
    bos: 'LOT',
    installation: 'LOT',
    documentation: 'SET',
  },

  // ---- ⚠️ HARDCODE: ภาษีมูลค่าเพิ่ม ----
  vatRate: 0.07,

  // ---- ⚠️ HARDCODE: เงื่อนไขการชำระเงิน (สัดส่วนของยอด TOTAL) ----
  payment: [
    { label: '1st Payment', percent: 0.6 },
    { label: '2nd Payment', percent: 0.4 },
  ],

  // ---- ⚠️ HARDCODE: Remarks (ข้อ 1 เติม {panelBrand} อัตโนมัติจาก snapshot) ----
  remarks: [''
    // 'We have specified {panelBrand} Solar Panels which are an N type panel manufacturer. The brand, but not the spec, may change depending on when we order.',
    // 'Solar Registration with the PEA. Kunini will submit the documents to the PEA to register the Solar PV System. All charges directly payable to the PEA for the Inspection Fee must be paid by the owner.',
  ],

  // ---- ⚠️ HARDCODE: Terms & Conditions (รูปต้นแบบเว้นว่าง) ----
  termsAndConditions: '',

  // ---- ⚠️ HARDCODE: ตารางการรับประกัน ----
  warranty: [
    { item: 'Solar Modules', text: '12 years Material & Workmanship warranty, 30 year limited performance warranty' },
    { item: 'Solar Inverter', text: '10 years standard warranty' },
    { item: 'Solar Battery', text: '10 years standard warranty, SOH 70% at EOL' },
    { item: 'Solar Monitor', text: '2 years standard warranty' },
    { item: 'Solar Racking', text: '12 years standard warranty' },
    { item: 'Other Equipment', text: '2 years standard warranty' },
  ],

  // ---- ⚠️ HARDCODE: O&M (Cleaning & Maintenance) ----
  omMaintenance:
    '2 Years Service Warranty; one site visit per year to inspect the system, clean the solar panels and verify online monitoring.',

  // ---- ⚠️ HARDCODE: ย่อหน้า disclaimer ท้ายเอกสาร ----
  disclaimer:
    'All equipment warranties are provided by the respective manufacturers. Kunini will assist you with any warranty claims during the warranty period, provided that you remain under a service agreement with Kunini. After the warranty period has expired, Kunini will provide assistance with claims on a case-by-case basis. This offer is valid until the end of the validity period of this offer. A new offer may be presented if the term expires. The offer becomes valid once you sign this agreement.',

  // ---- ⚠️ HARDCODE: template ประกอบชื่อระบบอัตโนมัติ ----
  systemTitle: {
    inverterSuffix: 'Solar Hybrid Inverter',
    batteryTemplate: 'with {kwh}kWh Storage',
    panelTemplate: '{kw}kW of Solar PV',
  },
} as const;
