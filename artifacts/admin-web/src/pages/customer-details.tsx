import { useGetCustomer, useGetCustomerOrders, useGetCustomerTransactions, useDisableCustomer, useAddCustomerBalance, getGetCustomerQueryKey, getGetCustomerTransactionsQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowLeft, Wallet, Ban, UserCheck } from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";

export default function CustomerDetails({ params }: { params: { id: string } }) {
  const customerId = parseInt(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: customer, isLoading } = useGetCustomer(customerId, {
    query: { enabled: !!customerId, queryKey: getGetCustomerQueryKey(customerId) }
  });

  const { data: transactions } = useGetCustomerTransactions(customerId, {
    page: 1,
    limit: 10
  }, {
    query: { enabled: !!customerId }
  });

  const { data: orders } = useGetCustomerOrders(customerId, {
    page: 1,
    limit: 10
  }, {
    query: { enabled: !!customerId }
  });

  const disableCustomer = useDisableCustomer();
  const addBalance = useAddCustomerBalance();

  const [isAddBalanceOpen, setIsAddBalanceOpen] = useState(false);
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceNote, setBalanceNote] = useState("");

  const handleToggleStatus = () => {
    if (!customer) return;
    disableCustomer.mutate(
      { id: customerId, data: { isActive: !customer.isActive } },
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
          queryClient.invalidateQueries({ queryKey: getGetCustomerTransactionsQueryKey(customerId) });
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
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{customer.firstName} {customer.lastName}</h1>
          <p className="text-muted-foreground mt-1">Chat ID: <span className="font-mono">{customer.chatId}</span></p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button 
            variant={customer.isActive ? "destructive" : "outline"} 
            onClick={handleToggleStatus}
            disabled={disableCustomer.isPending}
          >
            {disableCustomer.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : 
             customer.isActive ? <Ban className="h-4 w-4 mr-2" /> : <UserCheck className="h-4 w-4 mr-2" />}
            {customer.isActive ? "Khóa tài khoản" : "Mở khóa tài khoản"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Tổng quan tài khoản</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Số dư hiện tại</p>
              <div className="text-3xl font-bold text-primary">{formatVND(customer.balance)}</div>
            </div>
            
            <Dialog open={isAddBalanceOpen} onOpenChange={setIsAddBalanceOpen}>
              <DialogTrigger asChild>
                <Button className="w-full" variant="outline">
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
                      placeholder="VD: 50000 (Dùng số âm để trừ tiền)" 
                      value={balanceAmount}
                      onChange={(e) => setBalanceAmount(e.target.value)}
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

            <div className="pt-4 border-t border-border/50 grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Tổng chi</p>
                <p className="font-semibold">{formatVND(customer.totalSpent)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tổng đơn</p>
                <p className="font-semibold">{customer.totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Giao dịch gần đây</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã GD</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions?.data?.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs">{tx.transactionCode}</TableCell>
                      <TableCell className="text-sm">
                        {tx.type === 'deposit' ? 'Nạp tiền' : 
                         tx.type === 'purchase' ? 'Mua hàng' : 
                         tx.type === 'manual_credit' ? 'Cộng thủ công' : tx.type}
                      </TableCell>
                      <TableCell className={`text-right font-bold ${tx.amount.startsWith('-') ? 'text-destructive' : 'text-emerald-500'}`}>
                        {tx.amount.startsWith('-') ? '' : '+'}{formatVND(tx.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!transactions?.data || transactions.data.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={3} className="h-16 text-center text-sm text-muted-foreground">
                        Không có giao dịch nào
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Đơn hàng gần đây</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã ĐH</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead className="text-right">Tổng tiền</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders?.data?.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">{order.orderCode}</TableCell>
                      <TableCell className="text-sm">{formatDate(order.createdAt)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatVND(order.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                  {(!orders?.data || orders.data.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={3} className="h-16 text-center text-sm text-muted-foreground">
                        Không có đơn hàng nào
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
