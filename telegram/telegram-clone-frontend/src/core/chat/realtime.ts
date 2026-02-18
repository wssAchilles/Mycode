export type SocketRealtimeEvent =
  | { type: 'message'; payload: any }
  | { type: 'presence'; payload: { userId: string; isOnline: boolean; lastSeen?: string } }
  | { type: 'readReceipt'; payload: { chatId: string; seq: number; readCount: number; readerId?: string } }
  | { type: 'groupUpdate'; payload: any };

