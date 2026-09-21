import { QUOTATION_HARDCODE } from './pages/pdf-bos-preview/quotation-hardcode';
import type { QuotationExtras, QuotationLineRow, QuotationSnapshot } from './dto/quotation.dto';
import type { EstimateDetail, EstimatePanelItemView } from './dto/estimate.dto';
import type { UserProfile } from './services/auth.service';

// ลำดับหมวด BOS / Labour ตรงกับที่ estimate-page ใช้ต่อ description — DB ไม่รับประกันลำดับ row ข้ามหมวด
const BOS_CATEGORY_ORDER = ['cables', 'switch_gears', 'solar_equipment', 'conduit_junction_boxes', 'accessories'];
const LABOUR_CATEGORY_ORDER = ['in_house', 'outsourced', 'machinery'];

// แผงกำลัง 10.32 kW → หัวเรื่องใช้จำนวนเต็ม "10kW" (ปัดเศษ)
const titleKw = (kw: number): string => String(Math.round(kw));

/**
 * แยกหมายเหตุที่กรอกใน textarea เป็นรายข้อ
 * @param text ข้อความดิบ (1 บรรทัด = 1 ข้อ) — null/undefined ได้
 * @returns บรรทัดที่ trim แล้ว ตัดบรรทัดว่างทิ้ง ([] ถ้าไม่มีอะไร)
 */
export function splitRemarkLines(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * ชื่อ Sales Rep จาก profile ของผู้ใช้ที่ login อยู่
 * @returns displayName → username → email ตามลำดับ, '' ถ้า profile ยังโหลดไม่เสร็จ (กันเอกสารล้ม แต่เว้นว่าง)
 */
export function salesRepNameOf(profile: UserProfile | null): string {
  return (profile?.displayName || profile?.username || profile?.email || '').trim();
}

const sumTotal = (items: { total: number }[]): number => items.reduce((sum, item) => sum + item.total, 0);

const orderIndex = (order: string[], category: string): number => {
  const index = order.indexOf(category);
  return index === -1 ? order.length : index;
};

/**
 * สร้าง snapshot ใบเสนอราคา PDF จาก estimate ที่บันทึกไว้แล้ว (หน้า history)
 *
 * ⚠️ กฎธุรกิจชุดเดียวกับ EstimatePageComponent.onExportPdf (ชื่อระบบ, คำบรรยายแถว, VAT) — แก้ที่ใดที่หนึ่งต้องแก้อีกที่ด้วย
 * ต่างกันตรงที่นี่อ่านจาก snapshot ที่ freeze ตอน save ไม่ใช่ catalog ปัจจุบัน
 *
 * @param detail estimate ที่ finalize แล้ว (EstimateDetail จาก GET /estimates/:id)
 * @param contactPersonName ชื่อผู้ติดต่อ — ไม่ได้เก็บใน estimate จึงให้ผู้เรียกดึงมาจาก customer (ส่ง '' ได้)
 * @param extras ที่อยู่/location ปัจจุบันของลูกค้า + ชื่อผู้กด Export — ไม่ freeze ใน estimate จึงให้ผู้เรียกส่งมา (ส่ง '' ได้)
 * @returns snapshot พร้อมส่งให้ QuotationPreviewService หรือ null ถ้าไม่มีรายการอุปกรณ์เลย (กันเอกสารที่มีแต่ยอด Documentation)
 */
export function buildQuotationSnapshot(
  detail: EstimateDetail,
  contactPersonName: string,
  extras: QuotationExtras
): QuotationSnapshot | null {
  const HC = QUOTATION_HARDCODE;

  // estimate-page บันทึก main ได้ section ละ 1 แถวเท่านั้น → ใช้แถวแรกที่ qty > 0 เป็นตัวแทน
  const mainOf = <T extends EstimatePanelItemView>(items: T[]): T | undefined =>
    items.find((item) => item.itemRole === 'main' && item.quantity > 0);
  const accessoriesOf = (items: EstimatePanelItemView[]): EstimatePanelItemView[] =>
    items.filter((item) => item.itemRole === 'accessory' && item.quantity > 0);

  const panel = mainOf(detail.panelItems);
  const inverter = mainOf(detail.inverterItems);
  const battery = mainOf(detail.batteryItems);

  // panel.kw เก็บเป็น W → หาร 1000 เป็น kW; inverter/battery เก็บเป็น kW/kWh อยู่แล้ว
  const panelKw = panel ? (panel.kw * panel.quantity) / 1000 : 0;
  const inverterKw = inverter ? inverter.kw * inverter.quantity : 0;
  const batteryKwh = battery ? battery.kw * battery.quantity : 0;

  // ---- ชื่อระบบอัตโนมัติ: "<brand> <kW>kW Solar Hybrid Inverter with <kWh>kWh Storage + <kW>kW of Solar PV" ----
  let systemTitle = inverter ? `${inverter.brand} ${titleKw(inverterKw)}kW ${HC.systemTitle.inverterSuffix}` : 'Solar PV System';
  if (battery) {
    systemTitle += ' ' + HC.systemTitle.batteryTemplate.replace('{kwh}', titleKw(batteryKwh));
  }
  if (panel) {
    systemTitle += ' + ' + HC.systemTitle.panelTemplate.replace('{kw}', titleKw(panelKw));
  }

  // ต่อท้าย description หลักด้วยรายการ accessories (คั่น comma) — ไม่แยกแถว
  const appendAccessories = (base: string, accessories: EstimatePanelItemView[]): string => {
    const text = accessories.map((acc) => `${acc.brand} - ${acc.description}`).join(', ');
    return text ? `${base}, ${text}` : base;
  };

  const rows: QuotationLineRow[] = [];

  if (inverter) {
    const description = appendAccessories(
      `${inverter.brand} ${inverter.phase} - ${inverter.description}`,
      accessoriesOf(detail.inverterItems)
    );
    rows.push({ item: 'SOLAR INVERTER', description, unit: HC.unit.inverter, quantity: inverter.quantity, total: null });
  }

  if (battery) {
    const description = appendAccessories(
      `${battery.brand} - ${battery.description} Total ${titleKw(batteryKwh)}kWh`,
      accessoriesOf(detail.batteryItems)
    );
    rows.push({ item: 'SOLAR BATTERY', description, unit: HC.unit.battery, quantity: battery.quantity, total: null });
  }

  if (panel) {
    const description = appendAccessories(`${panel.brand} - ${panel.description}`, accessoriesOf(detail.panelItems));
    rows.push({ item: 'SOLAR PANELS', description, unit: HC.unit.panels, quantity: panel.quantity, total: null });
  }

  // ---- Racking: group ตามชื่อ roof type ที่ freeze ไว้ (ไม่ผูก catalog) ----
  const rackingTotal = sumTotal(detail.rackingItems);
  if (rackingTotal > 0) {
    const linesByRoofType = new Map<string, string[]>();
    for (const item of detail.rackingItems) {
      if (item.quantity <= 0) continue;
      const lines = linesByRoofType.get(item.roofTypeName) ?? [];
      lines.push(item.description);
      linesByRoofType.set(item.roofTypeName, lines);
    }
    const rackingDescription = [...linesByRoofType.entries()]
      .map(([roofTypeName, lines]) => `${roofTypeName}: ${lines.join(', ')}`)
      .join(' | ');
    // unit/quantity ของแถวนี้ = กำลังรวมของ Panels ("10.3kW" / 10320 W) ตามรูปต้นแบบ — ไม่มีแผงเลยค่อย fallback "LOT" × 1
    // (เหมือน EstimatePageComponent.onExportPdf)
    rows.push({
      item: 'SOLAR RACKING',
      description: rackingDescription,
      unit: panel ? `${panelKw.toFixed(1)}kW` : HC.unit.racking,
      quantity: panel ? panel.kw * panel.quantity : 1,
      total: null,
    });
  }

  // ---- BOS: list ทุกรายการที่ qty > 0 เป็น list เดียว ไม่ group ตามหมวด (total ของ BOS = sale_price × qty ที่ freeze ไว้ตอน save) ----
  const bosTotal = sumTotal(detail.bosItems);
  if (bosTotal > 0) {
    // filter() ได้ array ใหม่ก่อน sort — ไม่ mutate detail.bosItems ที่หน้าจอใช้แสดงผลอยู่
    const bosLines = detail.bosItems
      .filter((item) => item.quantity > 0)
      .sort((a, b) => orderIndex(BOS_CATEGORY_ORDER, a.category) - orderIndex(BOS_CATEGORY_ORDER, b.category))
      .map((item) => `${item.description}${item.size ? ` (${item.size})` : ''}`);
    const bosDescription = bosLines.length > 0 ? bosLines.join(', ') : HC.rowDescription.bos;
    rows.push({ item: 'SOLAR BOS', description: bosDescription, unit: HC.unit.bos, quantity: 1, total: null });
  }

  // ---- Installation: ใช้ description ที่กรอกจริงใน Labour ถ้ามี ไม่งั้น fallback ข้อความมาตรฐาน ----
  const installationTotal = sumTotal(detail.labourItems);
  if (installationTotal > 0) {
    const labourDescriptions = Array.from(
      new Set(
        [...detail.labourItems]
          .sort((a, b) => orderIndex(LABOUR_CATEGORY_ORDER, a.category) - orderIndex(LABOUR_CATEGORY_ORDER, b.category))
          .map((row) => row.description?.trim())
          .filter((desc): desc is string => !!desc)
      )
    );
    const installationDescription = labourDescriptions.length > 0 ? labourDescriptions.join(', ') : HC.rowDescription.installation;
    rows.push({ item: 'INSTALLATION', description: installationDescription, unit: HC.unit.installation, quantity: 1, total: null });
  }

  // กันสร้างใบเสนอราคาจากข้อมูลที่ไม่มีรายการอุปกรณ์เลย
  if (rows.length === 0) return null;

  // ---- สรุปยอด: VAT คิดจาก SUBTOTAL แล้วปัด 2 ตำแหน่งก่อนบวก (กันคอลัมน์บวกไม่ลง) ----
  const solarPvKitTotal =
    sumTotal(detail.panelItems) + sumTotal(detail.inverterItems) + sumTotal(detail.batteryItems) +
    rackingTotal + bosTotal + installationTotal;
  const documentationTotal = sumTotal(detail.documentationItems);
  // type ที่ rate = 0 (เช่น FIT) ก็ยังแสดงในเอกสาร แม้ยอดเป็น 0 — เงื่อนไขเดียวกับ estimate-page (qty > 0)
  const documentationDescription = Array.from(
    new Set(
      detail.documentationItems
        .filter((row) => row.quantity > 0)
        .map((row) => row.documentationTypeName)
        .filter((name) => !!name)
    )
  ).join(', ');
  const totalCost = solarPvKitTotal + documentationTotal;
  const vatAmount = Math.round(totalCost * HC.vatRate * 100) / 100;

  return {
    customerId: detail.customerId,
    estimateId: detail.id,
    systemTitle,
    customerName: detail.customerDisplayName ?? '',
    contactPersonName,
    issuedDateIso: new Date().toISOString(),
    customerAddress: extras.customerAddress,
    projectLocation: extras.projectLocation,
    salesRepName: extras.salesRepName,
    rows,
    solarPvKitTotal,
    documentationTotal,
    documentationDescription,
    totalCost,
    vatRate: HC.vatRate,
    vatAmount,
    grandTotal: totalCost + vatAmount,
    panelBrand: panel?.brand ?? '',
    remarkLines: splitRemarkLines(detail.pdfRemarks),
  };
}
