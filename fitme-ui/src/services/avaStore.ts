// fitme-ui/src/services/avaStore.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthenticatedUserId, getSessionEpoch, request } from './api';
import { DatabaseManager, AVARepository } from '../repositories';
import { AVAConversationSummary, AVAMessageItem, mapLocalConversationToSummary } from './avaService';

type AVAStoreState = {
  cachedUserId: string | null;
  conversations: AVAConversationSummary[];
  messagesByConversationId: Record<string, AVAMessageItem[]>;
  loading: boolean;
  refreshing: boolean;

  hydrateFromLocalConversations: (
    convs: AVAConversationSummary[],
    userId?: string,
    messagesByConv?: Record<string, AVAMessageItem[]>
  ) => void;
  setConversationMessages: (convId: string, messages: AVAMessageItem[]) => void;
  appendMessageToConversation: (convId: string, message: AVAMessageItem) => void;
  fetchConversations: (forceRefresh?: boolean) => Promise<void>;
  addOrUpdateConversation: (conv: AVAConversationSummary) => void;
  removeConversation: (convId: string) => void;
  renameConversationInStore: (convId: string, newTitle: string) => void;
  clearAll: () => void;
  resetLocalState: () => void;
};

let inFlightFetchConvs: Promise<void> | null = null;
let inFlightTargetUserId: string | null = null;

export const useAVAStore = create<AVAStoreState>()(
  persist(
    (set, get) => ({
      cachedUserId: null,
      conversations: [],
      messagesByConversationId: {},
      loading: false,
      refreshing: false,

      hydrateFromLocalConversations: (
        convs: AVAConversationSummary[],
        userId?: string,
        messagesByConv?: Record<string, AVAMessageItem[]>
      ) => {
        const activeUserId = userId || getAuthenticatedUserId();
        set((state) => ({
          cachedUserId: activeUserId,
          conversations: convs,
          messagesByConversationId: messagesByConv
            ? { ...state.messagesByConversationId, ...messagesByConv }
            : state.messagesByConversationId,
          loading: false,
          refreshing: false,
        }));
      },

      setConversationMessages: (convId: string, messages: AVAMessageItem[]) => {
        set((state) => ({
          messagesByConversationId: {
            ...state.messagesByConversationId,
            [convId]: messages,
          },
        }));
      },

      appendMessageToConversation: (convId: string, message: AVAMessageItem) => {
        set((state) => {
          const existing = state.messagesByConversationId[convId] || [];
          if (existing.some((m) => m.id === message.id)) {
            return {
              messagesByConversationId: {
                ...state.messagesByConversationId,
                [convId]: existing.map((m) => (m.id === message.id ? message : m)),
              },
            };
          }
          return {
            messagesByConversationId: {
              ...state.messagesByConversationId,
              [convId]: [...existing, message],
            },
          };
        });
      },

      fetchConversations: async (forceRefresh = false) => {
        const activeUserId = getAuthenticatedUserId();
        const currentEpoch = getSessionEpoch();

        if (!activeUserId) {
          return Promise.resolve();
        }

        // 1. Local SQLite Read First: Hydrate immediately if database is active (0ms UI latency)
        try {
          if (DatabaseManager.getActiveUserId() === activeUserId) {
            const rows = await AVARepository.getConversations();
            const mapped = rows.map(mapLocalConversationToSummary);
            const localMsgs = await AVARepository.getAllMessagesByConversation();
            const mappedMsgsByConv: Record<string, AVAMessageItem[]> = {};
            for (const [cId, msgList] of Object.entries(localMsgs)) {
              mappedMsgsByConv[cId] = msgList.map((m) => ({
                id: m.id,
                sender: m.sender,
                text: m.text_content,
                intent: m.intent || undefined,
                structured_payload: m.structured_payload,
                created_at: new Date(m.created_at).toISOString(),
              }));
            }
            if (get().cachedUserId !== activeUserId || mapped.length > 0) {
              get().hydrateFromLocalConversations(mapped, activeUserId, mappedMsgsByConv);
            }
          }
        } catch (sqliteErr) {
          console.log('[AVAStore] Local SQLite read notice:', sqliteErr);
        }

        // In-flight deduplication for the exact same user
        if (inFlightFetchConvs && inFlightTargetUserId === activeUserId && !forceRefresh) {
          return inFlightFetchConvs;
        }

        const isSameUser = get().cachedUserId === activeUserId;
        const hasExisting = isSameUser && get().conversations.length > 0;

        // Only show full loading spinner if cache is completely empty
        if (!hasExisting || !isSameUser) {
          set({ loading: true });
        }
        if (forceRefresh) {
          set({ refreshing: true });
        }

        inFlightTargetUserId = activeUserId;
        inFlightFetchConvs = (async () => {
          try {
            // Background remote fetch with 15s timeout and silentTimeout: true
            // If remote is slow or offline, local SQLite cache already provides instant conversations
            const remoteConvs = await request<AVAConversationSummary[]>('/api/v1/ava/conversations', {
              timeoutMs: 15000,
              silentTimeout: true,
            }).catch((err) => {
              console.log('[AVAStore] Remote conversation sync notice:', err?.message || err);
              return null;
            });

            // Guard: discard if session changed during network call
            if (
              getSessionEpoch() !== currentEpoch ||
              getAuthenticatedUserId() !== activeUserId ||
              DatabaseManager.getActiveUserId() !== activeUserId
            ) {
              return;
            }

            if (Array.isArray(remoteConvs)) {
              // Persist server conversations to local SQLite in high-performance batch
              try {
                for (const conv of remoteConvs) {
                  const createdAtMs = conv.created_at
                    ? !isNaN(Date.parse(conv.created_at))
                      ? Date.parse(conv.created_at)
                      : Date.now()
                    : Date.now();
                  const updatedAtMs = conv.updated_at
                    ? !isNaN(Date.parse(conv.updated_at))
                      ? Date.parse(conv.updated_at)
                      : Date.now()
                    : Date.now();

                  await AVARepository.createConversation(
                    conv.id,
                    conv.title || 'Fashion Styling Session',
                    createdAtMs,
                    updatedAtMs
                  );
                }
              } catch (dbSaveErr) {
                console.log('[AVAStore] SQLite save notice:', dbSaveErr);
              }

              set({
                cachedUserId: activeUserId,
                conversations: remoteConvs,
                loading: false,
                refreshing: false,
              });
            } else {
              set({ loading: false, refreshing: false });
            }
          } catch (err: any) {
            console.log('[AVAStore] Background conversation sync notice:', err?.message || err);
            set({ loading: false, refreshing: false });
          } finally {
            inFlightFetchConvs = null;
            inFlightTargetUserId = null;
          }
        })();

        return inFlightFetchConvs;
      },

      addOrUpdateConversation: (conv: AVAConversationSummary) => {
        set((state) => {
          const filtered = state.conversations.filter((c) => c.id !== conv.id);
          return { conversations: [conv, ...filtered] };
        });
      },

      removeConversation: (convId: string) => {
        set((state) => {
          const newMsgs = { ...state.messagesByConversationId };
          delete newMsgs[convId];
          return {
            conversations: state.conversations.filter((c) => c.id !== convId),
            messagesByConversationId: newMsgs,
          };
        });
      },

      renameConversationInStore: (convId: string, newTitle: string) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? { ...c, title: newTitle } : c
          ),
        }));
      },

      clearAll: () => {
        set({
          cachedUserId: null,
          conversations: [],
          messagesByConversationId: {},
          loading: false,
          refreshing: false,
        });
      },

      resetLocalState: () => {
        set({
          cachedUserId: null,
          conversations: [],
          messagesByConversationId: {},
          loading: false,
          refreshing: false,
        });
      },
    }),
    {
      name: 'fitme-ava-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cachedUserId: state.cachedUserId,
        conversations: state.conversations,
        messagesByConversationId: state.messagesByConversationId,
      }),
    }
  )
);
