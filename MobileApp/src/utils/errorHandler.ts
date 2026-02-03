// src/utils/errorHandler.ts
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const handleApiError = (error: any) => {
  if (error.response?.status === 401) {
    // Session expired
    authService.logout();
    return new AppError('Session expired', 'SESSION_EXPIRED', true);
  }
  // ... handle other errors
};