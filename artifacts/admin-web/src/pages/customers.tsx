import { useListCustomers } from "@workspace/api-client-react";
import { useState } from "react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye } from "lucide-react";
import { Link } from "wouter";

type SortMode = "latest" | "top_spent" | "top_balance";

export default function Customers() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("latest");
  
  const { data: customerList, isLoading } = useListCustomers({
    page,
    limit: 10,
    search: search || undefined,
  });

  const sortedData = [...(customerList?.data ?? [])].sort((a, b) => {
    if (sort === "top_spent") return parseFloat(b.totalSpent) - parseFloat(a.totalSpent);
    if (sort === "top_balance") return parseFloat(b.balance) - parseFloat(a.balance);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Khách hàng</h1>
          <p className="text-muted-foreground mt-1">Quản lý người dùng Telegram.</p>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <Input 
          placeholder="Tìm kiếm theo tên, username, chat ID..." 
          className="max-w-sm" 
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          data-testid="input-search-customers"
        />
        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
          <SelectTrigger className="w-[180px]" data-testid="select-customers-sort">
            <SelectValue placeholder="Sắp xếp" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Mới nhất</SelectItem>
            <SelectItem value="top_spent">Chi tiêu nhiều nhất</SelectItem>
            <SelectItem value="top_balance">Số dư cao nhất</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>Chat ID</TableHead>
                  <TableHead>Số dư</TableHead>
                  <TableHead>Tổng chi</TableHead>
                  <TableHead>Tham gia</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((customer) => (
                  <TableRow key={customer.id} data-testid={`row-customer-${customer.id}`}>
                    <TableCell className="font-mono text-xs">{customer.id}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{customer.firstName} {customer.lastName}</span>
                        <span className="text-xs text-muted-foreground">{customer.username ? `@${customer.username}` : "Không có username"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{customer.chatId}</TableCell>
                    <TableCell className="font-bold text-primary">{formatVND(customer.balance)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatVND(customer.totalSpent)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(customer.createdAt)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        customer.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
                      }`}>
                        {customer.isActive ? "Hoạt động" : "Bị khóa"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/customers/${customer.id}`}>
                        <Button variant="ghost" size="icon" title="Xem hồ sơ" data-testid={`btn-view-customer-${customer.id}`}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      Không tìm thấy khách hàng nào.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between items-center mt-4">
        <Button 
          variant="outline" 
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
          data-testid="btn-prev-page"
        >
          Trang trước
        </Button>
        <span className="text-sm text-muted-foreground">Trang {page} {customerList?.total ? `• ${customerList.total} khách hàng` : ""}</span>
        <Button 
          variant="outline" 
          onClick={() => setPage(p => p + 1)}
          disabled={!customerList || customerList.data.length < 10}
          data-testid="btn-next-page"
        >
          Trang sau
        </Button>
      </div>
    </div>
  );
}
