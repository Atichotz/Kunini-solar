export type TodoCategory = 'technician' | 'admin';
export type TodoStatus = 'todo' | 'in_progress' | 'done';

export interface TodoCard {
  id: string;
  title: string;
  description: string | null;
  isDone: boolean;
  status: TodoStatus;
  category: TodoCategory;
  dueDate: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoAssignee {
  id: string;
  name: string;
}

export interface CreateTodoPayload {
  title: string;
  category: TodoCategory;
  description?: string;
  due_date?: string;
  assigned_to?: string;
}
