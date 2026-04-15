import { useEffect, useState } from 'react';
import { authService } from '../services/auth.service';
import { UserProfile } from '../types/auth';

export const useAuth = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const session = await authService.loadSession();
    setUser(session?.user || null);
    setLoading(false);
  };

  return { user, loading, checkAuth };
};
