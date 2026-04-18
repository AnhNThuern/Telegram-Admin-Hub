import { useGetMe } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  CreditCard, 
  Tags, 
  Settings, 
  Bot, 
  Activity,
  LogOut,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useLogout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/categories", label: "Danh mục", icon: Package },
  { href: "/products", label: "Sản phẩm", icon: ShoppingCart },
  { href: "/orders", label: "Đơn hàng", icon: ShoppingCart },
  { href: "/transactions", label: "Giao dịch", icon: CreditCard },
  { href: "/customers", label: "Khách hàng", icon: Users },
  { href: "/promotions", label: "Khuyến mãi", icon: Tags },
  { href: "/bot-logs", label: "Nhật ký Bot", icon: Activity },
];

const settingsItems = [
  { href: "/settings/bot", label: "Cấu hình Bot", icon: Bot },
  { href: "/settings/payments", label: "Thanh toán", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();
  const logout = useLogout();
  const [, setLocation] = useLocation();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setLocation("/login");
      }
    });
  };

  return (
    <aside className="w-64 border-r border-border bg-sidebar flex flex-col h-full shrink-0">
      <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
        <span className="font-bold text-primary tracking-tight">TeleCommerce</span>
        <span className="ml-2 text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded-sm">ADMIN</span>
      </div>

      <div className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="px-2 mb-2 text-xs font-semibold text-muted-foreground tracking-wider">QUẢN LÝ</div>
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-2 py-1.5 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
                data-testid={`nav-${item.href.replace("/", "")}`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col gap-1">
          <div className="px-2 mb-2 text-xs font-semibold text-muted-foreground tracking-wider">CÀI ĐẶT</div>
          {settingsItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-2 py-1.5 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
                data-testid={`nav-${item.href.replace(/\//g, "-")}`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="p-4 border-t border-border shrink-0">
        <Button 
          variant="ghost" 
          className="w-full justify-start text-muted-foreground hover:text-foreground" 
          onClick={handleLogout}
          data-testid="btn-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Đăng xuất
        </Button>
      </div>
    </aside>
  );
}
