export type TicketStatus = 'todo' | 'to_schedule' | 'in_progress' | 'done';
export type TicketRole = 'ceo' | 'purchasing' | 'admin' | 'technician';

// ผู้ใช้ใน allowed_users — role ตรงนี้คือแหล่งอ้างอิงเดียวของฟีเจอร์ Ticket (ไม่ใช่ role ใน UserProfile)
export interface TicketAssignee {
  id: string;
  name: string;
  role: TicketRole;
}

export interface TicketCard {
  id: string;
  title: string;
  description: string | null;
  isDone: boolean;
  status: TicketStatus;
  customerId: string | null;
  customerName: string | null;
  startDate: string | null;
  daysAllotted: number | null;
  closeDate: string | null;
  assignees: TicketAssignee[];
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketCommentAttachment {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  author: TicketAssignee;
  body: string;
  // allowed_users.id ของคนที่ถูก @mention — ใช้ highlight ฝั่ง UI เท่านั้น ไม่มี notification
  mentionedUserIds: string[];
  attachments: TicketCommentAttachment[];
  createdAt: string;
}

// input ตอนเพิ่ม comment — files ส่งเป็น multipart แยกจาก body/mentionedUserIds
export interface AddTicketCommentPayload {
  body?: string;
  mentionedUserIds?: string[];
  files?: File[];
}

export interface CreateTicketPayload {
  title: string;
  description?: string;
  customer_id?: string;
  start_date?: string;
  days_allotted?: number;
  assignee_ids: string[];
}

// undefined = ไม่แตะ field นั้น, null = ล้างค่า — ตรงกับ UpdateTicketDto ฝั่ง backend
// assignee_ids แทนที่ผู้รับ ticket ทั้งชุด (ไม่รับ null — เคลียร์ผู้รับทั้งหมดไม่ได้ ต้องมีอย่างน้อย 1 คนเสมอ)
export interface UpdateTicketPayload {
  title?: string;
  description?: string | null;
  customer_id?: string | null;
  start_date?: string | null;
  days_allotted?: number | null;
  close_date?: string | null;
  status?: TicketStatus;
  assignee_ids?: string[];
}
