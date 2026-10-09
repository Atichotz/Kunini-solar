// ข้อความมาตรฐาน section 8 ของ Installation Report — ใช้ร่วมกันระหว่างฟอร์ม (report-page) กับ PDF (report-pdf-preview) กันข้อความสองที่ไม่ตรงกัน

export const REPORT_MAINTENANCE_HINT =
  'We recommend a professional panel cleaning and electrical inspection every 6 to 12 months to ensure optimal system performance.';

export const REPORT_WARRANTY_TERMS: readonly { item: string; text: string }[] = [
  { item: 'Solar Panels', text: '12-Year Product, 25-Year Linear Power' },
  { item: 'Inverter', text: '10-Year Comprehensive' },
  { item: 'Battery', text: '10-Year Performance' },
  { item: 'Mounting Structure', text: '10-Year Product' },
  { item: 'Kunini Workmanship', text: '2-Year Installation Guarantee' },
];
