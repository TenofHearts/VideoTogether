import { z } from 'zod';

export const serviceHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('videoshare-server'),
  timestamp: z.string().datetime(),
  uptimeSeconds: z.number().nonnegative()
});

export const systemStatusSchema = z.object({
  apiBaseUrl: z.string().url(),
  webUrl: z.string().url(),
  tauri: z.literal('ready')
});
