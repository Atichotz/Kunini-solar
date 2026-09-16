import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DialogModule } from 'primeng/dialog';

@Component({
  selector: 'app-new-customer-success-popup',
  imports: [DialogModule],
  templateUrl: './new-customer-success-popup.component.html',
  styleUrls: ['./new-customer-success-popup.component.scss']
})
export class NewCustomerSuccessPopupComponent {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Input() data: any = null;
  @Output() openDetail = new EventEmitter<any>();

  openDetailPopup() {
    this.openDetail.emit(this.data.customer);
    this.visibleChange.emit(false);
  }
}
