import { Component, Output, EventEmitter, Input, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { CustomerService } from '../../services/customer.service';
import type { StatusOption } from '../../dto/customer.dto';

type LocationOption = 'Pattaya' | 'Huahin' | 'Bangkok' | 'Up Country';
type CustomerTypeOption = 'Residential' | 'Commercial' | 'Upgrade';
type SystemTypeOption = 'On-Grid' | 'Off-Grid' | 'Hybrid';

@Component({
  selector: 'app-new-customer-page',
  imports: [FormsModule, SelectModule, DialogModule],
  templateUrl: './new-customer-page.component.html',
  styleUrls: ['./new-customer-page.component.scss']
})
export class NewCustomerPageComponent implements OnInit {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() saved = new EventEmitter<any>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly customerService = inject(CustomerService);

  selectedType = signal<'personal' | 'company'>('personal');
  selectedLocation = signal<LocationOption>('Pattaya');
  selectedCustomerType = signal<CustomerTypeOption>('Residential');
  selectedSystemType = signal<SystemTypeOption>('Hybrid');

  readonly locationOptions: LocationOption[] = ['Pattaya', 'Huahin', 'Bangkok', 'Up Country'];
  readonly customerTypeOptions: CustomerTypeOption[] = ['Residential', 'Commercial', 'Upgrade'];
  readonly systemTypeOptions: SystemTypeOption[] = ['On-Grid', 'Off-Grid', 'Hybrid'];

  statusList: StatusOption[] = [];

  // form fields
  displayName = '';
  customerNumber = '';
  selectedStatusId: number | null = null;
  firstname = '';
  lastname = '';
  tel = '';
  email = '';
  fullAddress = '';
  googleMapsLink = '';

  isSaving = false;
  errorMessage: string | null = null;
  touched = false;

  get isValid(): boolean {
    return (
      !!this.displayName.trim() &&
      !!this.firstname.trim() &&
      !!this.lastname.trim() &&
      !!this.tel.trim() &&
      !!this.email.trim() &&
      this.selectedStatusId !== null &&
      !!this.fullAddress.trim()
    );
  }

  ngOnInit(): void {
    this.customerService.getStatuses().subscribe({
      next: (statuses) => {
        this.statusList = statuses;
        if (statuses.length > 0) {
          this.selectedStatusId = statuses[0].id;
        }
      },
      error: (err) => console.error('[NewCustomer] load statuses failed', err),
    });
  }

  onSave(): void {
    if (this.isSaving) return;

    this.touched = true;
    if (!this.isValid) return;

    this.isSaving = true;
    this.errorMessage = null;

    this.customerService.create({
      display_name: this.displayName,
      customer_number: this.customerNumber.trim() || null,
      project_type: this.selectedType(),
      project_location_name: this.selectedLocation(),
      type_of_customer_name: this.selectedCustomerType(),
      type_of_system_name: this.selectedSystemType(),
      status_id: this.selectedStatusId,
      full_address: this.fullAddress || null,
      google_maps_link: this.googleMapsLink || null,
      contact: {
        firstname: this.firstname,
        lastname: this.lastname,
        tel: this.tel,
        email: this.email,
      },
    }).subscribe({
      next: (res) => {
        this.isSaving = false;
        this.saved.emit(res);
      },
      error: (err: HttpErrorResponse) => {
        this.isSaving = false;
        this.errorMessage = err.error?.message ?? 'Something went wrong. Please try again.';
      },
    });
  }

  onCancel(): void {
    this.visibleChange.emit(false);
    this.cancelled.emit();
  }
}
