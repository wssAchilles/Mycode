import SocketService from './socketService';

let socketService: SocketService | null = null;

export const setSocketService = (service: SocketService): void => {
  socketService = service;
};

export const getSocketService = (): SocketService | null => socketService;

