// Shared shape for form server actions used with useActionState.
export interface ActionState {
  error?: string;
  success?: boolean;
  message?: string;
}

export const idle: ActionState = {};
