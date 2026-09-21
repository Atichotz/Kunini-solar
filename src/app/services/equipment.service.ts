import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PanelItem {
  id: number;
  brand: string;
  description: string;
  kw: number;
  costPrice: number;
  shipping: number;
  salePrice: number;
  notes: string;
  isActive: boolean;
}

export interface InverterItem {
  id: number;
  brand: string;
  phase: string;
  description: string;
  kw: number;
  costPrice: number;
  shipping: number;
  salePrice: number;
  notes: string;
  isActive: boolean;
}

export interface BatteryItem {
  id: number;
  brand: string;
  description: string;
  kw: number;
  costPrice: number;
  shipping: number;
  salePrice: number;
  notes: string;
  isActive: boolean;
}

export interface AccessoryItem {
  id: number;
  brand: string;
  description: string;
  costPrice: number;
  shipping: number;
  salePrice: number;
  notes: string;
  isActive: boolean;
}

export interface RoofTypeItem {
  id: number;
  name: string;
}

export interface DocumentationTypeItem {
  id: number;
  name: string;
  unitRate: number;
}

export interface CreateDocumentationTypePayload {
  name: string;
  unitRate?: number;
}

export type UpdateDocumentationTypePayload = Partial<CreateDocumentationTypePayload>;

export interface CreateRoofTypePayload {
  name: string;
}

export interface SolarRackingItem {
  id: number;
  roofTypeId: number;
  part: string;
  description: string;
  costPrice: number;
  salePrice: number;
}

export interface BOSItem {
  id: number;
  item: number;
  description: string;
  size: string;
  costPrice: number;
}

export interface CreatePanelPayload {
  brand: string;
  description: string;
  kw?: number;
  costPrice?: number;
  shipping?: number;
  salePrice?: number;
  notes?: string;
}
export type UpdatePanelPayload = Partial<CreatePanelPayload>;

export interface CreateInverterPayload {
  brand: string;
  phase: string;
  description: string;
  kw?: number;
  costPrice?: number;
  shipping?: number;
  salePrice?: number;
  notes?: string;
}
export type UpdateInverterPayload = Partial<CreateInverterPayload>;

export type CreateBatteryPayload = CreatePanelPayload;
export type UpdateBatteryPayload = Partial<CreateBatteryPayload>;

export interface CreateAccessoryPayload {
  brand: string;
  description: string;
  costPrice?: number;
  shipping?: number;
  salePrice?: number;
  notes?: string;
}
export type UpdateAccessoryPayload = Partial<CreateAccessoryPayload>;

export interface CreateRackingPayload {
  roofTypeId: number;
  part: string;
  description: string;
  costPrice?: number;
  salePrice?: number;
}
export type UpdateRackingPayload = Partial<CreateRackingPayload>;

export interface CreateBOSItemPayload {
  item: number;
  description: string;
  size?: string;
  costPrice?: number;
}
export type UpdateBOSItemPayload = Partial<CreateBOSItemPayload>;

@Injectable({ providedIn: 'root' })
export class EquipmentService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  // output: panels ที่ยังไม่ถูกลบ สำหรับ dropdown brand → description และหน้า Setting Products
  getPanels(): Observable<PanelItem[]> {
    return this.http.get<PanelItem[]>(`${this.api}/equipment/panels`);
  }

  // input: ข้อมูล panel ใหม่ / output: panel ที่สร้างแล้ว
  createPanel(payload: CreatePanelPayload): Observable<PanelItem> {
    return this.http.post<PanelItem>(`${this.api}/equipment/panels`, payload);
  }

  // input: panel id + field ที่จะอัปเดต (ส่งเฉพาะ field ที่เปลี่ยน เช่น อัปเดตราคาอย่างเดียวก็ได้)
  updatePanel(id: number, payload: UpdatePanelPayload): Observable<PanelItem> {
    return this.http.patch<PanelItem>(`${this.api}/equipment/panels/${id}`, payload);
  }

  // input: panel id / output: void — soft-delete
  deletePanel(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/panels/${id}`);
  }

  // output: inverters ที่ยังไม่ถูกลบ สำหรับ dropdown brand → phase → รุ่น และหน้า Setting Products
  getInverters(): Observable<InverterItem[]> {
    return this.http.get<InverterItem[]>(`${this.api}/equipment/inverters`);
  }

  createInverter(payload: CreateInverterPayload): Observable<InverterItem> {
    return this.http.post<InverterItem>(`${this.api}/equipment/inverters`, payload);
  }

  updateInverter(id: number, payload: UpdateInverterPayload): Observable<InverterItem> {
    return this.http.patch<InverterItem>(`${this.api}/equipment/inverters/${id}`, payload);
  }

  deleteInverter(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/inverters/${id}`);
  }

  // output: batteries ที่ยังไม่ถูกลบ สำหรับ dropdown brand → description และหน้า Setting Products
  getBatteries(): Observable<BatteryItem[]> {
    return this.http.get<BatteryItem[]>(`${this.api}/equipment/batteries`);
  }

  createBattery(payload: CreateBatteryPayload): Observable<BatteryItem> {
    return this.http.post<BatteryItem>(`${this.api}/equipment/batteries`, payload);
  }

  updateBattery(id: number, payload: UpdateBatteryPayload): Observable<BatteryItem> {
    return this.http.patch<BatteryItem>(`${this.api}/equipment/batteries/${id}`, payload);
  }

  deleteBattery(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/batteries/${id}`);
  }

  // output: panel accessories ที่ยังไม่ถูกลบ สำหรับตาราง qty-only และหน้า Setting Products
  getPanelAccessories(): Observable<AccessoryItem[]> {
    return this.http.get<AccessoryItem[]>(`${this.api}/equipment/panel-accessories`);
  }

  createPanelAccessory(payload: CreateAccessoryPayload): Observable<AccessoryItem> {
    return this.http.post<AccessoryItem>(`${this.api}/equipment/panel-accessories`, payload);
  }

  updatePanelAccessory(id: number, payload: UpdateAccessoryPayload): Observable<AccessoryItem> {
    return this.http.patch<AccessoryItem>(`${this.api}/equipment/panel-accessories/${id}`, payload);
  }

  deletePanelAccessory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/panel-accessories/${id}`);
  }

  // output: inverter accessories ที่ยังไม่ถูกลบ สำหรับตาราง qty-only และหน้า Setting Products
  getInverterAccessories(): Observable<AccessoryItem[]> {
    return this.http.get<AccessoryItem[]>(`${this.api}/equipment/inverter-accessories`);
  }

  createInverterAccessory(payload: CreateAccessoryPayload): Observable<AccessoryItem> {
    return this.http.post<AccessoryItem>(`${this.api}/equipment/inverter-accessories`, payload);
  }

  updateInverterAccessory(id: number, payload: UpdateAccessoryPayload): Observable<AccessoryItem> {
    return this.http.patch<AccessoryItem>(`${this.api}/equipment/inverter-accessories/${id}`, payload);
  }

  deleteInverterAccessory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/inverter-accessories/${id}`);
  }

  // output: battery accessories ที่ยังไม่ถูกลบ สำหรับตาราง qty-only และหน้า Setting Products
  getBatteryAccessories(): Observable<AccessoryItem[]> {
    return this.http.get<AccessoryItem[]>(`${this.api}/equipment/battery-accessories`);
  }

  createBatteryAccessory(payload: CreateAccessoryPayload): Observable<AccessoryItem> {
    return this.http.post<AccessoryItem>(`${this.api}/equipment/battery-accessories`, payload);
  }

  updateBatteryAccessory(id: number, payload: UpdateAccessoryPayload): Observable<AccessoryItem> {
    return this.http.patch<AccessoryItem>(`${this.api}/equipment/battery-accessories/${id}`, payload);
  }

  deleteBatteryAccessory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/battery-accessories/${id}`);
  }

  // output: roof types ทั้งหมดสำหรับ dropdown เลือกก่อนดูรายการ solar racking
  getRoofTypes(): Observable<RoofTypeItem[]> {
    return this.http.get<RoofTypeItem[]>(`${this.api}/equipment/roof-types`);
  }

  createRoofType(payload: CreateRoofTypePayload): Observable<RoofTypeItem> {
    return this.http.post<RoofTypeItem>(`${this.api}/equipment/roof-types`, payload);
  }

  deleteRoofType(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/roof-types/${id}`);
  }

  // output: documentation type ทั้งหมด (ชื่อ + unit rate) สำหรับ dropdown Type ใน section 7 ของหน้า estimate และตารางหน้า Settings
  getDocumentationTypes(): Observable<DocumentationTypeItem[]> {
    return this.http.get<DocumentationTypeItem[]>(`${this.api}/equipment/documentation-types`);
  }

  createDocumentationType(payload: CreateDocumentationTypePayload): Observable<DocumentationTypeItem> {
    return this.http.post<DocumentationTypeItem>(`${this.api}/equipment/documentation-types`, payload);
  }

  updateDocumentationType(id: number, payload: UpdateDocumentationTypePayload): Observable<DocumentationTypeItem> {
    return this.http.patch<DocumentationTypeItem>(`${this.api}/equipment/documentation-types/${id}`, payload);
  }

  deleteDocumentationType(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/documentation-types/${id}`);
  }

  // output: solar racking ทั้งหมดจาก catalog (ทุก roof type) สำหรับ filter ตาม roof type ที่เลือก
  getSolarRacking(): Observable<SolarRackingItem[]> {
    return this.http.get<SolarRackingItem[]>(`${this.api}/equipment/solar-racking`);
  }

  createSolarRacking(payload: CreateRackingPayload): Observable<SolarRackingItem> {
    return this.http.post<SolarRackingItem>(`${this.api}/equipment/solar-racking`, payload);
  }

  updateSolarRacking(id: number, payload: UpdateRackingPayload): Observable<SolarRackingItem> {
    return this.http.patch<SolarRackingItem>(`${this.api}/equipment/solar-racking/${id}`, payload);
  }

  deleteSolarRacking(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/solar-racking/${id}`);
  }

  // output: cables ทั้งหมดจาก catalog สำหรับ Section 5 Solar BOS
  getCables(): Observable<BOSItem[]> {
    return this.http.get<BOSItem[]>(`${this.api}/equipment/cables`);
  }

  createCable(payload: CreateBOSItemPayload): Observable<BOSItem> {
    return this.http.post<BOSItem>(`${this.api}/equipment/cables`, payload);
  }

  updateCable(id: number, payload: UpdateBOSItemPayload): Observable<BOSItem> {
    return this.http.patch<BOSItem>(`${this.api}/equipment/cables/${id}`, payload);
  }

  deleteCable(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/cables/${id}`);
  }

  // output: switch gears ทั้งหมดจาก catalog สำหรับ Section 5 Solar BOS
  getSwitchGears(): Observable<BOSItem[]> {
    return this.http.get<BOSItem[]>(`${this.api}/equipment/switch-gears`);
  }

  createSwitchGear(payload: CreateBOSItemPayload): Observable<BOSItem> {
    return this.http.post<BOSItem>(`${this.api}/equipment/switch-gears`, payload);
  }

  updateSwitchGear(id: number, payload: UpdateBOSItemPayload): Observable<BOSItem> {
    return this.http.patch<BOSItem>(`${this.api}/equipment/switch-gears/${id}`, payload);
  }

  deleteSwitchGear(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/switch-gears/${id}`);
  }

  // output: solar equipment ทั้งหมดจาก catalog สำหรับ Section 5 Solar BOS
  getSolarEquipment(): Observable<BOSItem[]> {
    return this.http.get<BOSItem[]>(`${this.api}/equipment/solar-equipment`);
  }

  createSolarEquipment(payload: CreateBOSItemPayload): Observable<BOSItem> {
    return this.http.post<BOSItem>(`${this.api}/equipment/solar-equipment`, payload);
  }

  updateSolarEquipment(id: number, payload: UpdateBOSItemPayload): Observable<BOSItem> {
    return this.http.patch<BOSItem>(`${this.api}/equipment/solar-equipment/${id}`, payload);
  }

  deleteSolarEquipment(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/solar-equipment/${id}`);
  }

  // output: conduit & junction box ทั้งหมดจาก catalog สำหรับ Section 5 Solar BOS
  getConduitJunctionBoxes(): Observable<BOSItem[]> {
    return this.http.get<BOSItem[]>(`${this.api}/equipment/conduit-junction-boxes`);
  }

  createConduitJunctionBox(payload: CreateBOSItemPayload): Observable<BOSItem> {
    return this.http.post<BOSItem>(`${this.api}/equipment/conduit-junction-boxes`, payload);
  }

  updateConduitJunctionBox(id: number, payload: UpdateBOSItemPayload): Observable<BOSItem> {
    return this.http.patch<BOSItem>(`${this.api}/equipment/conduit-junction-boxes/${id}`, payload);
  }

  deleteConduitJunctionBox(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/conduit-junction-boxes/${id}`);
  }

  // output: BOS accessories ทั้งหมดจาก catalog สำหรับตาราง qty-only ท้าย Section 5
  getBosAccessories(): Observable<BOSItem[]> {
    return this.http.get<BOSItem[]>(`${this.api}/equipment/bos-accessories`);
  }

  createBosAccessory(payload: CreateBOSItemPayload): Observable<BOSItem> {
    return this.http.post<BOSItem>(`${this.api}/equipment/bos-accessories`, payload);
  }

  updateBosAccessory(id: number, payload: UpdateBOSItemPayload): Observable<BOSItem> {
    return this.http.patch<BOSItem>(`${this.api}/equipment/bos-accessories/${id}`, payload);
  }

  deleteBosAccessory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/equipment/bos-accessories/${id}`);
  }
}
