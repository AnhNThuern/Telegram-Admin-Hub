import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";

import { AppLayout } from "@/components/layout/app-layout";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Categories from "@/pages/categories";
import Products from "@/pages/products";
import ProductStocks from "@/pages/product-stocks";
import Orders from "@/pages/orders";
import OrderDetails from "@/pages/order-details";
import Transactions from "@/pages/transactions";
import Customers from "@/pages/customers";
import CustomerDetails from "@/pages/customer-details";
import Promotions from "@/pages/promotions";
import SettingsBot from "@/pages/settings-bot";
import SettingsPayments from "@/pages/settings-payments";
import BotLogs from "@/pages/bot-logs";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component, ...rest }: any) {
  return (
    <Route {...rest}>
      {params => (
        <AppLayout>
          <Component params={params} />
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
      <ProtectedRoute path="/orders/:id" component={OrderDetails} />
      <ProtectedRoute path="/transactions" component={Transactions} />
      <ProtectedRoute path="/customers" component={Customers} />
      <ProtectedRoute path="/customers/:id" component={CustomerDetails} />
      <ProtectedRoute path="/promotions" component={Promotions} />
      <ProtectedRoute path="/settings/bot" component={SettingsBot} />
      <ProtectedRoute path="/settings/payments" component={SettingsPayments} />
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
