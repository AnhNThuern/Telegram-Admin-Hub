import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";

function is401(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number };
  return e.status === 401;
}

import { AppLayout } from "@/components/layout/app-layout";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Categories from "@/pages/categories";
import Products from "@/pages/products";
import ProductStocks from "@/pages/product-stocks";
import Orders from "@/pages/orders";
import OrderDetails from "@/pages/order-details";
import RestockQueue from "@/pages/restock-queue";
import Transactions from "@/pages/transactions";
import Customers from "@/pages/customers";
import CustomerDetails from "@/pages/customer-details";
import Promotions from "@/pages/promotions";
import SettingsBot from "@/pages/settings-bot";
import SettingsPayments from "@/pages/settings-payments";
import SettingsRetry from "@/pages/settings-retry";
import SettingsI18n from "@/pages/settings-i18n";
import BotLogs from "@/pages/bot-logs";
import TransactionDetails from "@/pages/transaction-details";

function redirectToLogin() {
  queryClient.clear();
  window.location.replace(
    (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/login"
  );
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error) {
      if (is401(error)) redirectToLogin();
    },
  }),
  mutationCache: new MutationCache({
    onError(error) {
      if (is401(error)) redirectToLogin();
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !is401(error) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
});

type PageProps = { params: Record<string, string> };
type PageComponent = React.ComponentType<PageProps>;

function ProtectedRoute({ component: Component, path }: { component: PageComponent; path: string }) {
  return (
    <Route path={path}>
      {params => (
        <AppLayout>
          <Component params={params as Record<string, string>} />
        </AppLayout>
      )}
    </Route>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <ProtectedRoute path="/categories" component={Categories} />
      <ProtectedRoute path="/products" component={Products} />
      <ProtectedRoute path="/products/:id/stocks" component={ProductStocks} />
      <ProtectedRoute path="/orders" component={Orders} />
      <ProtectedRoute path="/restock-queue" component={RestockQueue} />
      <ProtectedRoute path="/orders/:id" component={OrderDetails} />
      <ProtectedRoute path="/transactions" component={Transactions} />
      <ProtectedRoute path="/transactions/:id" component={TransactionDetails} />
      <ProtectedRoute path="/customers" component={Customers} />
      <ProtectedRoute path="/customers/:id" component={CustomerDetails} />
      <ProtectedRoute path="/promotions" component={Promotions} />
      <ProtectedRoute path="/settings/bot" component={SettingsBot} />
      <ProtectedRoute path="/settings/payments" component={SettingsPayments} />
      <ProtectedRoute path="/settings/retry" component={SettingsRetry} />
      <ProtectedRoute path="/settings/i18n" component={SettingsI18n} />
      <ProtectedRoute path="/bot-logs" component={BotLogs} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    // Force dark mode
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
