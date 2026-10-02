import { Routes } from '@angular/router';
import { EstimatePageComponent } from './pages/estimate-page/estimate-page.component';
import { BatteryGuideComponent } from './pages/battery-guide/battery-guide.component';
import { CalculatorsPageComponent } from './pages/calculators-page/calculators-page.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { StaffMainLayoutComponent } from './staff-main-layout/staff-main-layout.component';
import { WorkflowPageComponent } from './pages/workflow-page/workflow-page.component';
import { CustomerDetailPageComponent } from './pages/customer-detail-page/customer-detail-page.component';
import { EstimateHistoryPageComponent } from './pages/estimate-history-page/estimate-history-page.component';
import { AuthCallbackComponent } from './pages/auth-callback/auth-callback.component';
import { authGuard } from './guards/auth.guard';
import { NewCustomerSuccessPopupComponent } from './popups/new-customer-success-popup/new-customer-success-popup.component';
import { SettingPageComponent } from './pages/setting-page/setting-page.component';
import { PdfBosPreviewComponent } from './pages/pdf-bos-preview/pdf-bos-preview.component';
import { SowPageComponent } from './pages/sow-page/sow-page.component';
import { ReportPageComponent } from './pages/report-page/report-page.component';
import { SiteSurveyReportPageComponent } from './pages/site-survey-report-page/site-survey-report-page.component';
import { SiteSurveyPdfPreviewComponent } from './pages/site-survey-pdf-preview/site-survey-pdf-preview.component';
import { SowPdfPreviewComponent } from './pages/sow-pdf-preview/sow-pdf-preview.component';
import { CallOutServiceReportPageComponent } from './pages/call-out-service-report-page/call-out-service-report-page.component';
import { CallOutServicePdfPreviewComponent } from './pages/call-out-service-pdf-preview/call-out-service-pdf-preview.component';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginPageComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  {
    path: '',
    component: StaffMainLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: 'workflow', component: WorkflowPageComponent },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'estimate', component: EstimatePageComponent },
      { path: 'sow', component: SowPageComponent },
      { path: 'sow-pdf', component: SowPdfPreviewComponent },
      { path: 'report', component: ReportPageComponent },
      { path: 'survey-report', component: SiteSurveyReportPageComponent },
      { path: 'survey-report-pdf', component: SiteSurveyPdfPreviewComponent },
      { path: 'call-out-service-report', component: CallOutServiceReportPageComponent },
      { path: 'call-out-service-report-pdf', component: CallOutServicePdfPreviewComponent },
      { path: 'pdf-bos-preview', component: PdfBosPreviewComponent },
      { path: 'battery-guide', component: BatteryGuideComponent },
      { path: 'calculators', component: CalculatorsPageComponent },
      { path: 'detail/:id', component: CustomerDetailPageComponent },
      { path: 'detail/:id/estimate/:estimateId', component: EstimateHistoryPageComponent },
      { path: 'setting', component: SettingPageComponent },
    ],
  },
];
