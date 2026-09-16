// ===== Snapshot ของใบเสนอราคา PDF =====
// estimate-page เป็นคน build (รวมยอดทุก section ตอนนี้) แล้วฝากไว้ที่ QuotationPreviewService
// หน้า pdf-bos-preview เป็น renderer อย่างเดียว — ไม่รู้จัก catalog / getter ใดๆ ของ estimate-page

export interface QuotationLineRow {
  /** ป้ายซ้ายสุด เช่น 'SOLAR INVERTER' */
  item: string;
  /** ข้อความบรรยาย — 4 แถวแรกมาจาก data จริง, 3 แถวหลังเป็นข้อความมาตรฐาน (ดู quotation-hardcode.ts) */
  description: string;
  /** หน่วย เช่น 'EACH' | 'LOT' | 'SET' | '10.3kW' */
  unit: string;
  quantity: number;
  /** null = แถวนี้ไม่แสดงราคาในคอลัมน์ Total (ตามรูปต้นแบบ) */
  total: number | null;
}

export interface QuotationSnapshot {
  // ---- ใช้ทำ back link + เช็คว่ามี snapshot ไหม ----
  customerId: string | null;
  estimateId: string | null;

  // ---- ส่วนหัวเอกสาร ----
  /** ชื่อระบบที่ประกอบอัตโนมัติจากอุปกรณ์ที่เลือก */
  systemTitle: string;
  customerName: string;
  /** ชื่อผู้ติดต่อ (firstname + lastname) — ไม่ใช่เบอร์/อีเมลแบบ contactReference */
  contactPersonName: string;
  /** วันที่ออกเอกสาร (ISO) — auto = วันที่กดปุ่ม Export */
  issuedDateIso: string;

  // ---- ตารางรายการ ----
  rows: QuotationLineRow[];

  // ---- สรุปยอด ----
  /** panel + inverter + battery + racking + bos + installation */
  solarPvKitTotal: number;
  documentationTotal: number;
  /** solarPvKitTotal + documentationTotal (= SUBTOTAL) */
  totalCost: number;
  vatRate: number;
  vatAmount: number;
  /** totalCost + vatAmount */
  grandTotal: number;

  // ---- ใช้แทนที่ placeholder ในข้อความมาตรฐาน ----
  /** ยี่ห้อแผง — ใช้เติมใน Remarks ข้อ 1 */
  panelBrand: string;
}
