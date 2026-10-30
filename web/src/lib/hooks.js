import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useOwners = () => useQuery({ queryKey: ['owners'], queryFn: () => api('/team/options'), staleTime: 60_000 });
export const useStages = () => useQuery({ queryKey: ['stages'], queryFn: () => api('/pipeline/stages'), staleTime: 60_000 });
export const useFieldDefs = (entity) =>
  useQuery({ queryKey: ['fields', entity ?? 'all'], queryFn: () => api('/fields', { params: { entity } }), staleTime: 60_000 });
