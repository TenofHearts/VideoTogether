export type ServiceHealth = {
  status: 'ok';
  service: 'videoshare-server';
  timestamp: string;
  uptimeSeconds: number;
};

export type DesktopStatus = {
  apiBaseUrl: string;
  webUrl: string;
  tauri: 'ready';
};
