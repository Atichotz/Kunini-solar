import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SolarInstallationDialogComponent } from './solar-installation-dialog.component';

describe('SolarInstallationDialogComponent', () => {
  let component: SolarInstallationDialogComponent;
  let fixture: ComponentFixture<SolarInstallationDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SolarInstallationDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SolarInstallationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
