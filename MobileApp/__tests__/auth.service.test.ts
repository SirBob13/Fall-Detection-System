import { authService } from '../src/services/auth.service';

describe('Auth Service', () => {
  beforeEach(() => {
    // Clear any stored data
    authService.clearSession();
  });

  test('should initialize correctly', () => {
    expect(authService).toBeDefined();
  });

  test('should save and load session', async () => {
    const mockSession = {
      user: {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
      },
      token: 'test-token',
      refresh_token: 'refresh-token',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    };

    await authService.saveSession(mockSession);
    const loadedSession = await authService.loadSession();

    expect(loadedSession).toEqual(mockSession);
  });

  test('should clear session', async () => {
    await authService.saveSession({
      user: { id: '1', email: 'test@example.com', name: 'Test' },
      token: 'token',
      refresh_token: 'refresh',
      expires_at: new Date().toISOString(),
    });

    await authService.clearSession();
    const session = await authService.loadSession();

    expect(session).toBeNull();
  });
});