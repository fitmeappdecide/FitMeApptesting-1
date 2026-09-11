import { create } from "zustand";
type State = { productUrl: string; setProductUrl: (value: string) => void; };
export const useStore = create<State>((set) => ({ productUrl: "", setProductUrl: (productUrl) => set({ productUrl }) }));
