import { useGetDashboardStats } from "@workspace/api-client-react";
import { formatVND } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Package,
  ShoppingCart,
  Users,
  CreditCard,
  ArrowUpRight,
  Loader2,
  Plus,
  Bot,
  Wallet,
} from "lucide-react";

export default function Dashboard() {
  const { data: stats, isLoading } = useGetDashboardStats();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tổng quan</h1>
          <p className="text-muted-foreground mt-1">Hoạt động kinh doanh hôm nay.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/products">
            <Button size="sm" variant="outline" data-testid="btn-quick-add-product">
              <Plus className="h-4 w-4 mr-2" />
              Thêm sản phẩm
            </Button>
          </Link>
          <Link href="/settings/bot">
            <Button size="sm" variant="outline" data-testid="btn-quick-bot-config">
              <Bot className="h-4 w-4 mr-2" />
              Cấu hình Bot
            </Button>
          </Link>
          <Link href="/settings/payments">
            <Button size="sm" variant="outline" data-testid="btn-quick-payment-config">
              <Wallet className="h-4 w-4 mr-2" />
              Thanh toán
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tổng doanh thu</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary" data-testid="text-total-revenue">
              {formatVND(stats.totalRevenue)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center">
              <ArrowUpRight className="h-3 w-3 mr-1 text-emerald-500" />
              Doanh thu lũy kế
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tổng đơn hàng</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-orders">
              {stats.totalOrders}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sản phẩm</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-products">
              {stats.totalProducts}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Khách hàng</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-customers">
              {stats.totalCustomers}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Đơn hàng gần đây</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.recentOrders?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Chưa có đơn hàng nào.</p>
              ) : (
                stats.recentOrders?.map((order) => (
                  <div key={order.id} className="flex items-center justify-between" data-testid={`row-recent-order-${order.id}`}>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">{order.orderCode}</span>
                      <span className="text-xs text-muted-foreground">{order.customerName || "Khách ẩn danh"}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-bold text-primary">{formatVND(order.totalAmount)}</span>
                      <span className="text-xs text-muted-foreground">{order.status}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Khách hàng mới</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.newCustomers?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Chưa có khách hàng nào.</p>
              ) : (
                stats.newCustomers?.map((customer) => (
                  <div key={customer.id} className="flex items-center justify-between" data-testid={`row-recent-customer-${customer.id}`}>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">
                        {customer.firstName} {customer.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">@{customer.username || customer.chatId}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
