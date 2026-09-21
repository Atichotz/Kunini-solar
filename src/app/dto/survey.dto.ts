export interface SurveyPhoto {
  id: string;
  url: string;
  fileName: string;
  uploadedAt: string;
}

export interface SurveyNote {
  id: string;
  text: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyDetail {
  id: string;
  customerId: string;
  photos: SurveyPhoto[];
  notes: SurveyNote[];
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

// สรุปแถวเดียวสำหรับ Survey History list — ไม่พก photos/notes เต็มเพื่อลด payload
export interface SurveyHistoryItem {
  id: string;
  customerId: string;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  photoCount: number;
  noteCount: number;
}
