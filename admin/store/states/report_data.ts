import { create } from "zustand";

interface IReportDataStore {
  cashierTotal: number;
  incomes: {
    key: string;
    readonly: boolean;
    value: number;
  }[];
  expenses: {
    label: string;
    readonly: boolean;
    value: number;
  }[];
  withdraws: {
    label: string;
    value: number;
  }[];
  setIncomesItem: ({
    key,
    value,
    readonly,
  }: {
    key: string;
    value: number;
    readonly: boolean;
  }) => void;
  setReadOnlyIncomes: (items: { key: string; value: number }[]) => void;
  setReadOnlyExpenses: (items: { label: string; value: number }[]) => void;
  unshiftExpensesItem: ({
    label,
    value,
  }: {
    label: string;
    value: number;
  }) => void;
  addExpensesItem: ({
    label,
    value,
    readonly,
  }: {
    label: string;
    value: number;
    readonly: boolean;
  }) => void;
  updateExpensesItemByIndex: ({
    index,
    label,
    value,
  }: {
    index: number;
    label: string;
    value: number;
  }) => void;
  replaceExpensesItemByLabel: ({
    label,
    value,
  }: {
    label: string;
    value: number;
  }) => void;
  setWithdraws: (items: { label: string; value: number }[]) => void;
  removeExpensesByLabel: (label: string) => void;
  updateExpensesItemLabelByIndex: (index: number, label: string) => void;
  updateExpensesItemValueByIndex: (index: number, value: number) => void;
  removeExpensesItemByIndex: (index: number) => void;
  readonlyExpensesCount: () => number;
  setCashierTotal: (value: number) => void;
  totalIncome: () => number;
  totalExpenses: () => number;
  balance: () => number;
  editableExpenses: () => {
    label: string;
    readonly: boolean;
    value: number;
  }[];
  readonlyExpenses: () => {
    label: string;
    readonly: boolean;
    value: number;
  }[];
  editableIncomes: () => {
    key: string;
    readonly: boolean;
    value: number;
  }[];
  readonlyIncomes: () => {
    key: string;
    readonly: boolean;
    value: number;
  }[];
  clearExpenses: () => void;
  clearData: () => void;
}

export const useReportDataStore = create<IReportDataStore>((set, get) => ({
  cashierTotal: 0,
  incomes: [],
  expenses: [],
  withdraws: [],
  setIncomesItem: ({ key, value, readonly }) =>
    set((state) => {
      const incomes = [...state.incomes];
      const index = incomes.findIndex((item) => item.key === key);
      if (index !== -1) {
        incomes[index].value = value;
      } else {
        incomes.push({ key, value, readonly });
      }
      return { incomes };
    }),
  setReadOnlyIncomes: (items) =>
    set((state) => {
      const incomes = [...state.incomes];
      items.forEach((item) => {
        const index = incomes.findIndex((temp) => temp.key === item.key);
        if (index !== -1) {
          incomes[index].value = item.value;
        } else {
          incomes.push({ key: item.key, value: item.value, readonly: true });
        }
      });
      return { incomes };
    }),
  setReadOnlyExpenses: (items) =>
    set((state) => {
      const expenses = [...state.expenses];
      items.forEach((item) => {
        const index = expenses.findIndex((temp) => temp.label === item.label);
        console.log("index", index);
        if (index >= 0) {
          expenses[index].value = item.value;
        } else {
          expenses.push({
            label: item.label,
            value: item.value,
            readonly: true,
          });
        }
      });
      return { expenses };
    }),
  setCashierTotal: (value: number) => set({ cashierTotal: value }),
  unshiftExpensesItem: ({ label, value }) =>
    set((state) => {
      const expenses = [...state.expenses];
      expenses.unshift({ label, value, readonly: true });
      return { expenses };
    }),
  addExpensesItem: ({ label, value, readonly }) =>
    set((state) => {
      const expenses = [...state.expenses];
      expenses.push({ label, value, readonly });
      return { expenses };
    }),

  updateExpensesItemLabelByIndex: (index, label) =>
    set((state) => {
      const expenses = [...state.expenses];
      expenses[index].label = label;
      return { expenses };
    }),
  updateExpensesItemValueByIndex: (index, value) =>
    set((state) => {
      const expenses = [...state.expenses];
      expenses[index].value = value;
      return { expenses };
    }),
  updateExpensesItemByIndex: ({ index, label, value }) =>
    set((state) => {
      const expenses = [...state.expenses];
      expenses[index].label = label;
      expenses[index].value = value;
      return { expenses };
    }),
  replaceExpensesItemByLabel: ({ label, value }) =>
    set((state) => {
      const expenses = [...state.expenses];
      const itemIndex = expenses.findIndex((item) => item.label === label);
      console.log("itemIndex", itemIndex);
      if (itemIndex != -1) {
        expenses[itemIndex].value = value;
      } else {
        expenses.unshift({ label, value, readonly: true });
      }
      return { expenses };
    }),
  setWithdraws: (items) => set({ withdraws: items }),
  removeExpensesByLabel: (label) =>
    set((state) => {
      const expenses = [...state.expenses];
      const itemIndex = expenses.findIndex((item) => item.label === label);
      if (itemIndex !== -1) {
        expenses.splice(itemIndex, 1);
      }
      return { expenses };
    }),
  removeExpensesItemByIndex: (index) =>
    set((state) => {
      const expenses = [...state.expenses];
      expenses.splice(index, 1);
      return { expenses };
    }),
  totalIncome: () => {
    return get().incomes.reduce((sum, income) => sum + income.value, 0);
  },
  totalExpenses: () => {
    return (
      get().expenses.reduce((sum, expense) => sum + expense.value, 0) +
      get().withdraws.reduce((sum, withdraw) => sum + withdraw.value, 0)
    );
  },
  balance: () => {
    return get().cashierTotal - (get().totalIncome() + get().totalExpenses());
  },
  readonlyExpensesCount: () => {
    return get().expenses.filter((expense) => expense.readonly).length;
  },
  editableExpenses: () => {
    return get().expenses.filter((expense) => !expense.readonly);
  },
  readonlyExpenses: () => {
    return get().expenses.filter((expense) => expense.readonly);
  },
  editableIncomes: () => {
    return get().incomes.filter((income) => !income.readonly);
  },
  readonlyIncomes: () => {
    return get().incomes.filter((income) => income.readonly);
  },
  clearExpenses: () => {
    const expenses = [...get().expenses];
    set({ expenses: expenses.filter((expense) => expense.readonly) });
  },
  clearData: () => {
    set({
      cashierTotal: 0,
      incomes: [],
      expenses: [],
    });
  },
}));
