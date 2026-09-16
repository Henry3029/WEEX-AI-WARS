// src/store/engineStore.ts

export const systemLogsStore: Array<{
  id: string;
  engine: string;
  type: string;
  message: string;
  timestamp: string;
}> = [];

export const engineStatesStore: Record<string, any> = {};