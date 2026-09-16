import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import {
  EquipmentService,
  InverterItem,
  AccessoryItem,
  CreateInverterPayload,
  CreateAccessoryPayload,
} from '../../../services/equipment.service';

interface InverterRow {
  id: number | null;
  brand: string;
  phase: string;
  kw: number | null;
  description: string;
  costPrice: number | null;
  shipping: number | null;
  salePrice: number | null;
  notes: string;
  saving: boolean;
}

interface AccessoryRow {
  id: number | null;
  brand: string;
  description: string;
  costPrice: number | null;
  shipping: number | null;
  salePrice: number | null;
  notes: string;
  saving: boolean;
}

function toInverterRow(i: InverterItem): InverterRow {
  return {
    id: i.id,
    brand: i.brand,
    phase: i.phase,
    kw: i.kw,
    description: i.description,
    costPrice: i.costPrice,
    shipping: i.shipping,
    salePrice: i.salePrice,
    notes: i.notes,
    saving: false,
  };
}

function toAccessoryRow(a: AccessoryItem): AccessoryRow {
  return {
    id: a.id,
    brand: a.brand,
    description: a.description,
    costPrice: a.costPrice,
    shipping: a.shipping,
    salePrice: a.salePrice,
    notes: a.notes,
    saving: false,
  };
}

@Component({
  selector: 'app-setting-inverters',
  imports: [FormsModule, ToastModule, NgClass],
  templateUrl: './setting-inverters.component.html',
  styleUrl: './setting-inverters.component.scss',
  providers: [MessageService],
})
export class SettingInvertersComponent implements OnInit {
  private readonly equipmentService = inject(EquipmentService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  rows: InverterRow[] = [];
  accessoryRows: AccessoryRow[] = [];

  ngOnInit(): void {
    this.equipmentService.getInverters()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (inverters) => (this.rows = inverters.map(toInverterRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'โหลดข้อมูล Inverters ไม่สำเร็จ' }),
      });

    this.equipmentService.getInverterAccessories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accessories) => (this.accessoryRows = accessories.map(toAccessoryRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'โหลดข้อมูล Accessories ไม่สำเร็จ' }),
      });
  }

  addRow(): void {
    this.rows.push({ id: null, brand: '', phase: '', kw: null, description: '', costPrice: null, shipping: null, salePrice: null, notes: '', saving: false });
  }

  saveRow(row: InverterRow): void {
    if (!row.brand || !row.phase || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'กรุณากรอก Brand, Phase และ Description ก่อนบันทึก' });
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createInverter(this.buildPayload(row))
      : this.equipmentService.updateInverter(row.id, this.buildPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toInverterRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `บันทึก ${saved.brand} เรียบร้อย`, life: 2000 });
      },
      error: () => {
        row.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' });
      },
    });
  }

  removeRow(index: number): void {
    const row = this.rows[index];
    if (row.id === null) {
      this.rows.splice(index, 1);
      return;
    }
    if (!window.confirm(`ลบ ${row.brand} - ${row.description} ออกจากรายการ?`)) return;

    this.equipmentService.deleteInverter(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.rows.splice(index, 1),
        error: () => this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง' }),
      });
  }

  private buildPayload(row: InverterRow): CreateInverterPayload {
    const payload: CreateInverterPayload = { brand: row.brand, phase: row.phase, description: row.description };
    if (row.kw !== null) payload.kw = row.kw;
    if (row.costPrice !== null) payload.costPrice = row.costPrice;
    if (row.shipping !== null) payload.shipping = row.shipping;
    if (row.salePrice !== null) payload.salePrice = row.salePrice;
    if (row.notes) payload.notes = row.notes;
    return payload;
  }

  addAccessoryRow(): void {
    this.accessoryRows.push({ id: null, brand: '', description: '', costPrice: null, shipping: null, salePrice: null, notes: '', saving: false });
  }

  saveAccessoryRow(row: AccessoryRow): void {
    if (!row.brand || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'กรุณากรอก Brand และ Description ก่อนบันทึก' });
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createInverterAccessory(this.buildAccessoryPayload(row))
      : this.equipmentService.updateInverterAccessory(row.id, this.buildAccessoryPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toAccessoryRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `บันทึก ${saved.brand} เรียบร้อย`, life: 2000 });
      },
      error: () => {
        row.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' });
      },
    });
  }

  removeAccessoryRow(index: number): void {
    const row = this.accessoryRows[index];
    if (row.id === null) {
      this.accessoryRows.splice(index, 1);
      return;
    }
    if (!window.confirm(`ลบ ${row.brand} - ${row.description} ออกจากรายการ?`)) return;

    this.equipmentService.deleteInverterAccessory(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.accessoryRows.splice(index, 1),
        error: () => this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง' }),
      });
  }

  private buildAccessoryPayload(row: AccessoryRow): CreateAccessoryPayload {
    const payload: CreateAccessoryPayload = { brand: row.brand, description: row.description };
    if (row.costPrice !== null) payload.costPrice = row.costPrice;
    if (row.shipping !== null) payload.shipping = row.shipping;
    if (row.salePrice !== null) payload.salePrice = row.salePrice;
    if (row.notes) payload.notes = row.notes;
    return payload;
  }
}
