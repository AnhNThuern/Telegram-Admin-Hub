import { useGetCustomer, useGetCustomerOrders, useGetCustomerTransactions, useDisableCustomer, useAddCustomerBalance, getGetCustomerQueryKey, getGetCustomerTransactionsQueryKey, getGetCustomerOrdersQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Wallet, Ban, UserCheck, Calendar, ShoppingCart, CreditCard } from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";

export default function CustomerDetails({ params }: { params: { id: string } }) {
  const customerId = parseInt(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [ordersPage, setOrdersPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  
  const { data: customer, isLoading } = useGetCustomer(customerId, {
    query: { enabled: !!customerId, queryKey: getGetCustomerQueryKey(customerId) }
  });

  const { data: transactions } = useGetCustomerTransactions(customerId, {
    page: txPage,
    limit: 10
  }, {
    query: { enabled: !!customerId, queryKey: getGetCustomerTransactionsQueryKey(customerId, { page: txPage, limit: 10 }) }
  });

  const { data: orders } = useGetCustomerOrders(customerId, {
    page: ordersPage,
    limit: 10
  }, {
    query: { enabled: !!customerId, queryKey: getGetCustomerOrdersQueryKey(customerId, { page: ordersPage, limit: 10 }) }
  });

  const disableCustomer = useDisableCustomer();
  const addBalance = useAddCustomerBalance();

  const [isAddBalanceOpen, setIsAddBalanceOpen] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceNote, setBalanceNote] = useState("");

  const handleToggleStatus = () => {
    if (!customer) return;
    disableCustomer.mutate(
      { id: customerId },
      {
        onSuccess: () => {
          toast({ title: customer.isActive ? "Đã khóa khách hàng" : "Đã mở khóa khách hàng" });
          queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });
        }
      }
    );
  };

  const handleAddBalance = () => {
    if (!balanceAmount) return;
    addBalance.mutate(
      { id: customerId, data: { amount: balanceAmount, note: balanceNote } },
      {
        onSuccess: () => {
          toast({ title: "Đã cộng số dư" });
          setIsAddBalanceOpen(false);
          setBalanceAmount("");
          setBalanceNote("");
          queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });
          queryClient.invalidateQueries({ queryKey: getGetCustomerTransactionsQueryKey(customerId, { page: txPage, limit: 10 }) });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!customer) return <div className="text-center py-10">Không tìm thấy khách hàng</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/customers">
          <Button variant="ghost" size="icon" data-testid="btn-back-customers">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{customer.firstName} {customer.lastName}</h1>
          <p className="text-muted-foreground mt-1">
            {customer.username ? `@${customer.username} · ` : ""}Chat ID: <span className="font-mono">{customer.chatId}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={customer.isActive ? "outline" : "destructive"} className={customer.isActive ? "border-emerald-500 text-emerald-500" : ""}>
            {customer.isActive ? "Đang hoạt động" : "Đã khóa"}
          </Badge>
          {customer.isActive ? (
            <Button 
              variant="destructive"
              size="sm"
              onClick={handleToggleStatus}
              disabled={disableCustomer.isPending}
              data-testid="btn-toggle-customer-status"
            >
              {disableCustomer.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ban className="h-4 w-4 mr-2" />}
              Khóa tài khoản
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled data-testid="btn-toggle-customer-status">
              <Ban className="h-4 w-4 mr-2" />
              Đã khóa
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Số dư</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{formatVND(customer.balance)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal flex items-center gap-1">
              <ShoppingCart className="h-3 w-3" /> Tổng đơn hàng
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{customer.totalOrders}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal flex items-center gap-1">
              <CreditCard className="h-3 w-3" /> Tổng chi tiêu
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatVND(customer.totalSpent)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Hoạt động cuối
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">{customer.lastActiveAt ? formatDate(customer.lastActiveAt) : "Chưa có"}</div>
            <div className="text-xs text-muted-foreground mt-1">Tham gia {formatDate(customer.createdAt)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={isAddBalanceOpen} onOpenChange={setIsAddBalanceOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" data-testid="btn-add-balance">
              <Wallet className="h-4 w-4 mr-2" /> Cộng/Trừ số dư
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cộng/Trừ số dư</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Số tiền (VNĐ)</Label>
                <Input 
                  type="number" 
                  placeholder="VD: 50000 (dùng số âm để trừ tiền)" 
                  value={balanceAmount}
                  onChange={(e) => setBalanceAmount(e.target.value)}
                  data-testid="input-balance-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Ghi chú</Label>
                <Input 
                  placeholder="Lý do cộng/trừ tiền" 
                  value={balanceNote}
                  onChange={(e) => setBalanceNote(e.target.value)}
                />
              </div>
              <Button 
                onClick={handleAddBalance} 
                className="w-full" 
                disabled={addBalance.isPending || !balanceAmount}
              >
                {addBalance.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Xác nhận
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="orders" data-testid="tabs-history">
        <TabsList>
          <TabsTrigger value="orders" data-testid="tab-orders">
            Đơn hàng {orders?.total != null ? `(${orders.total})` : ""}
          </TabsTrigger>
          <TabsTrigger value="transactions" data-testid="tab-transactions">
            Giao dịch {transactions?.total != null ? `(${transactions.total})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã ĐH</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead className="text-right">Tổng tiền</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders?.data?.map((order) => (
                    <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/orders/${order.id}`} className="hover:text-primary transition-colors">
                          {order.orderCode}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          order.status === 'paid' || order.status === 'delivered' ? "bg-emerald-500/10 text-emerald-500" :
                          order.status === 'pending' ? "bg-yellow-500/10 text-yellow-500" :
                          "bg-destructive/10 text-destructive"
                        }`}>
                          {order.status === 'paid' ? 'Đã thanh toán' : order.status === 'delivered' ? 'Đã giao' : order.status === 'pending' ? 'Chờ TT' : 'Đã hủy'}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatVND(order.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                  {(!orders?.data || orders.data.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-16 text-center text-sm text-muted-foreground">
                        Không có đơn hàng nào
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex justify-between items-center mt-4">
            <Button variant="outline" size="sm" onClick={() => setOrdersPage(p => Math.max(1, p - 1))} disabled={ordersPage === 1}>Trang trước</Button>
            <span className="text-sm text-muted-foreground">Trang {ordersPage}</span>
            <Button variant="outline" size="sm" onClick={() => setOrdersPage(p => p + 1)} disabled={!orders || orders.data.length < 10}>Trang sau</Button>
          </div>
        </TabsContent>

        <TabsContent value="transactions" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã GD</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions?.data?.map((tx) => (
                    <TableRow key={tx.id} data-testid={`row-tx-${tx.id}`}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/transactions/${tx.id}`} className="hover:text-primary transition-colors">
                          {tx.transactionCode}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {tx.type === 'deposit' ? 'Nạp tiền' : 
                         tx.type === 'purchase' ? 'Mua hàng' : 
                         tx.type === 'refund' ? 'Hoàn tiền' :
                         tx.type === 'manual_credit' ? 'Cộng thủ công' : tx.type}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          tx.status === 'completed' ? "bg-emerald-500/10 text-emerald-500" :
                          tx.status === 'pending' ? "bg-yellow-500/10 text-yellow-500" :
                          "bg-destructive/10 text-destructive"
                        }`}>
                          {tx.status === 'completed' ? 'Hoàn thành' : tx.status === 'pending' ? 'Đang xử lý' : 'Thất bại'}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(tx.createdAt)}</TableCell>
                      <TableCell className={`text-right font-bold ${tx.amount.startsWith('-') ? 'text-destructive' : 'text-emerald-500'}`}>
                        {tx.amount.startsWith('-') ? '' : '+'}{formatVND(tx.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!transactions?.data || transactions.data.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={5} className="h-16 text-center text-sm text-muted-foreground">
                        Không có giao dịch nào
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex justify-between items-center mt-4">
            <Button variant="outline" size="sm" onClick={() => setTxPage(p => Math.max(1, p - 1))} disabled={txPage === 1}>Trang trước</Button>
            <span className="text-sm text-muted-foreground">Trang {txPage}</span>
            <Button variant="outline" size="sm" onClick={() => setTxPage(p => p + 1)} disabled={!transactions || transactions.data.length < 10}>Trang sau</Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
