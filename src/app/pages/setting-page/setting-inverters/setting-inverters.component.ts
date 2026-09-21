import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { finalize } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
import {
  EquipmentService,
  InverterItem,
  AccessoryItem,
  CreateInverterPayload,
  CreateAccessoryPayload,
} from '../../../services/equipment.service';
import { PermissionService } from '../../../services/permission.service';

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
  deleting?: boolean;
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
  deleting?: boolean;
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
  imports: [FormsModule, ToastModule, ConfirmDialogModule, NgClass],
  templateUrl: './setting-inverters.component.html',
  styleUrl: './setting-inverters.component.scss',
  providers: [MessageService, ConfirmationService],
})
export class SettingInvertersComponent implements OnInit {
  private readonly equipmentService = inject(EquipmentService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  readonly canManage = inject(PermissionService).canManageProducts;

  rows: InverterRow[] = [];
  accessoryRows: AccessoryRow[] = [];

  isLoadingAccessories = true;
  isLoadingRows = true;

  ngOnInit(): void {
    this.equipmentService.getInverters()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => (this.isLoadingRows = false)))
      .subscribe({
        next: (inverters) => (this.rows = inverters.map(toInverterRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'Failed to load inverters' }),
      });

    this.equipmentService.getInverterAccessories()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => (this.isLoadingAccessories = false)))
      .subscribe({
        next: (accessories) => (this.accessoryRows = accessories.map(toAccessoryRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'Failed to load accessories' }),
      });
  }

  addRow(): void {
    if (!this.canManage()) return;
    this.rows.push({ id: null, brand: '', phase: '', kw: null, description: '', costPrice: null, shipping: null, salePrice: null, notes: '', saving: false });
  }

  saveRow(row: InverterRow): void {
    if (!this.canManage()) return;
    if (!row.brand || !row.phase || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Please fill in Brand, Phase and Description before saving' });
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createInverter(this.buildPayload(row))
      : this.equipmentService.updateInverter(row.id, this.buildPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toInverterRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `${saved.brand} saved successfully`, life: 2000 });
      },
      error: () => {
        row.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'Failed to save. Please try again' });
      },
    });
  }

  removeRow(row: InverterRow): void {
    if (!this.canManage()) return;
    if (row.saving || row.deleting) return;
    if (row.id === null) {
      this.rows = this.rows.filter((r) => r !== row);
      return;
    }
    const id = row.id;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove ${row.brand} - ${row.description} from the list?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        row.deleting = true;
        this.equipmentService.deleteInverter(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            // filter ด้วย reference (ไม่ใช้ index) กันลบผิดแถวถ้า list เปลี่ยนระหว่างรอ confirm/response
            next: () => (this.rows = this.rows.filter((r) => r !== row)),
            error: () => {
              row.deleting = false;
              this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'Failed to delete. Please try again' });
            },
          });
      },
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
    if (!this.canManage()) return;
    this.accessoryRows.push({ id: null, brand: '', description: '', costPrice: null, shipping: null, salePrice: null, notes: '', saving: false });
  }

  saveAccessoryRow(row: AccessoryRow): void {
    if (!this.canManage()) return;
    if (!row.brand || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Please fill in Brand and Description before saving' });
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createInverterAccessory(this.buildAccessoryPayload(row))
      : this.equipmentService.updateInverterAccessory(row.id, this.buildAccessoryPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toAccessoryRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `${saved.brand} saved successfully`, life: 2000 });
      },
      error: () => {
        row.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'Failed to save. Please try again' });
      },
    });
  }

  removeAccessoryRow(row: AccessoryRow): void {
    if (!this.canManage()) return;
    if (row.saving || row.deleting) return;
    if (row.id === null) {
      this.accessoryRows = this.accessoryRows.filter((r) => r !== row);
      return;
    }
    const id = row.id;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove ${row.brand} - ${row.description} from the list?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        row.deleting = true;
        this.equipmentService.deleteInverterAccessory(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            // filter ด้วย reference (ไม่ใช้ index) กันลบผิดแถวถ้า list เปลี่ยนระหว่างรอ confirm/response
            next: () => (this.accessoryRows = this.accessoryRows.filter((r) => r !== row)),
            error: () => {
              row.deleting = false;
              this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'Failed to delete. Please try again' });
            },
          });
      },
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
