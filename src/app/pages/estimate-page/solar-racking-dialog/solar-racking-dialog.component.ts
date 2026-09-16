import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-solar-racking-dialog',
  imports: [DialogModule, FormsModule, SelectModule],
  templateUrl: './solar-racking-dialog.component.html',
  styleUrl: './solar-racking-dialog.component.scss'
})
export class SolarRackingDialogComponent {
  @Input() visible = false;
  @Input() rackingOptions: SelectOption[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();

  selectedRacking: string | null = null;
}
