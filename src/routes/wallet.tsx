import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, CreditCard, Banknote, ChevronRight, History, Trash2, X } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/wallet")({
  head: () => ({ meta: [{ title: "Wallet — Vura" }] }),
  component: WalletPage,
});

type PaymentMethod = { id: string; type: "card" | "cash"; last4?: string; expiry?: string; isDefault?: boolean };

function WalletPage() {
  const user = useAuth();
  const isDriver = user?.role === "driver";

  const [methods, setMethods] = useState<PaymentMethod[]>([
    { id: "1", type: "card", last4: "4242", expiry: "09/28" },
    { id: "2", type: "cash", isDefault: true },
  ]);

  const [isAdding, setIsAdding] = useState(false);
  const [newCardNumber, setNewCardNumber] = useState("");
  const [newCardExpiry, setNewCardExpiry] = useState("");

  const addCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCardNumber.length >= 4) {
      setMethods([
        ...methods,
        {
          id: Date.now().toString(),
          type: "card",
          last4: newCardNumber.slice(-4),
          expiry: newCardExpiry || "12/30",
        },
      ]);
      setIsAdding(false);
      setNewCardNumber("");
      setNewCardExpiry("");
    }
  };

  const removeMethod = (id: string) => {
    setMethods(methods.filter((m) => m.id !== id));
  };

  const [isCashingOut, setIsCashingOut] = useState(false);
  const [savedBanks, setSavedBanks] = useState<{id: string, bankName: string, accountNumber: string}[]>([]);
  const [isAddingBank, setIsAddingBank] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  const handleCashoutNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (bankName && accountNumber) {
      const newBank = { id: Date.now().toString(), bankName, accountNumber };
      setSavedBanks([...savedBanks, newBank]);
      alert(`R 1,240.50 successfully withdrawn to ${bankName} account ending in ${accountNumber.slice(-4)}!`);
      setIsCashingOut(false);
      setIsAddingBank(false);
      setBankName("");
      setAccountNumber("");
    }
  };

  const handleCashoutSaved = (bank: {bankName: string, accountNumber: string}) => {
    alert(`R 1,240.50 successfully withdrawn to ${bank.bankName} account ending in ${bank.accountNumber.slice(-4)}!`);
    setIsCashingOut(false);
  };

  return (
    <PhoneShell hideTabs>
      <div className="hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link to="/account" className="absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="mt-12 text-2xl font-extrabold tracking-tight">{isDriver ? "Earnings & Wallet" : "Wallet"}</h1>
      </div>

      <div className="px-5 -mt-4 flex-1 flex flex-col pb-6 space-y-6 overflow-y-auto">
        <div className="rounded-2xl bg-surface border border-border shadow-sm p-5 border border-border">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">{isDriver ? "Available to cash out" : "Vura Cash"}</p>
          <p className="text-3xl font-extrabold tracking-tight">{isDriver ? "R 1,240.50" : "R 24.10"}</p>
          <div className="mt-4 flex gap-2">
            <button 
              onClick={() => {
                if (isDriver) setIsCashingOut(true);
              }}
              className="flex-1 flex items-center justify-center gap-2 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-2.5 text-sm font-bold text-foreground hover:bg-secondary/80 transition"
            >
              {isDriver ? <Banknote className="h-4 w-4" /> : <Plus className="h-4 w-4" />} 
              {isDriver ? "Cash out" : "Add funds"}
            </button>
            <button className="flex-1 flex items-center justify-center gap-2 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-2.5 text-sm font-bold text-foreground hover:bg-secondary/80 transition">
              <History className="h-4 w-4" /> Activity
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-extrabold text-foreground">Payment methods</h2>
          </div>
          <div className="rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden shadow-sm">
            {methods.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-4 group">
                <div className={`h-10 w-10 rounded-full grid place-items-center shrink-0 ${m.type === "card" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"}`}>
                  {m.type === "card" ? <CreditCard className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{m.type === "card" ? `•••• ${m.last4}` : "Cash"}</p>
                  <p className="text-xs text-muted-foreground">{m.type === "card" ? `Expires ${m.expiry}` : "Default for rides"}</p>
                </div>
                {m.type === "card" && (
                  <button onClick={() => removeMethod(m.id)} className="h-8 w-8 rounded-full bg-red-50 text-red-600 grid place-items-center hover:bg-red-100 transition">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setIsAdding(true)} className="mt-3 w-full flex items-center justify-center gap-2 rounded-md bg-secondary py-3.5 text-sm font-bold text-primary hover:bg-secondary/80 transition">
            <Plus className="h-4 w-4" /> Add payment method
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end">
          <div className="w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Add Card</h3>
              <button onClick={() => setIsAdding(false)} className="h-8 w-8 rounded-full bg-secondary grid place-items-center hover:bg-secondary/80 transition"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={addCard} className="space-y-4">
              <input
                required
                type="text"
                placeholder="Card Number (min 4 digits)"
                value={newCardNumber}
                onChange={(e) => setNewCardNumber(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
              />
              <div className="flex gap-4">
                <input
                  required
                  type="text"
                  placeholder="Expiry (MM/YY)"
                  value={newCardExpiry}
                  onChange={(e) => setNewCardExpiry(e.target.value)}
                  className="w-1/2 rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
                />
                <input
                  required
                  type="text"
                  placeholder="CVV (3 digits)"
                  maxLength={3}
                  className="w-1/2 rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
                />
              </div>
              <button type="submit" className="w-full rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition">
                Save Card
              </button>
            </form>
          </div>
        </div>
      )}

      {isCashingOut && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end">
          <div className="w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Cash Out Earnings</h3>
              <button onClick={() => setIsCashingOut(false)} className="h-8 w-8 rounded-full bg-secondary grid place-items-center hover:bg-secondary/80 transition"><X className="h-4 w-4" /></button>
            </div>
            {savedBanks.length > 0 && !isAddingBank ? (
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Saved Accounts</p>
                {savedBanks.map((bank) => (
                  <button 
                    key={bank.id} 
                    onClick={() => handleCashoutSaved(bank)}
                    className="w-full flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3.5 hover:bg-secondary/50 transition text-left"
                  >
                    <div>
                      <p className="text-sm font-bold">{bank.bankName}</p>
                      <p className="text-xs text-muted-foreground">•••• {bank.accountNumber.slice(-4)}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
                <button 
                  onClick={() => setIsAddingBank(true)} 
                  className="mt-2 w-full flex items-center justify-center gap-2 rounded-md bg-secondary py-3.5 text-sm font-bold text-primary hover:bg-secondary/80 transition"
                >
                  <Plus className="h-4 w-4" /> Add new bank account
                </button>
              </div>
            ) : (
              <form onSubmit={handleCashoutNew} className="space-y-4">
                {savedBanks.length > 0 && (
                  <button type="button" onClick={() => setIsAddingBank(false)} className="flex items-center gap-1 text-xs font-bold text-muted-foreground mb-2 hover:text-foreground">
                    <ArrowLeft className="h-3 w-3" /> Back to saved accounts
                  </button>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted-foreground ml-1">Bank Name</label>
                  <div className="relative">
                    <select
                      required
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full appearance-none rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
                    >
                      <option value="" disabled>Select your bank</option>
                      <option value="FNB">First National Bank (FNB)</option>
                      <option value="Standard Bank">Standard Bank</option>
                      <option value="ABSA">ABSA</option>
                      <option value="Nedbank">Nedbank</option>
                      <option value="Capitec">Capitec</option>
                      <option value="Discovery Bank">Discovery Bank</option>
                      <option value="TymeBank">TymeBank</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-muted-foreground ml-1">Account Number</label>
                  <input
                    required
                    type="text"
                    placeholder="Enter your account number"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none"
                  />
                </div>
                <button type="submit" className="w-full rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition mt-2">
                  Withdraw R 1,240.50
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </PhoneShell>
  );
}
